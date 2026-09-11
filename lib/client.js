if (typeof window !== 'undefined' && typeof window.__ModuleLoader__ !== 'undefined') {
window.__ModuleLoader__.load({
  id: 'dsh-native-launcher',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require('react');

    var LABEL_STYLE = {
      fontSize: 12,
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-tertiary)',
      minWidth: 110,
      flex: 'none',
    };
    var VALUE_STYLE = {
      fontSize: 13,
      lineHeight: '20px',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      wordBreak: 'break-all',
    };
    var ROW_STYLE = { display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 0' };

    function Row(props) {
      return react.createElement(
        'div',
        { style: ROW_STYLE },
        react.createElement('div', { style: LABEL_STYLE }, props.label),
        react.createElement('div', { style: VALUE_STYLE }, props.children),
      );
    }

    function LauncherSection(props) {
      var rpc = props.rpc;
      var form = react.useState(null);
      var setForm = form[1];
      var meta = react.useState({ loading: true, error: null, shortcutExists: false, settingsAvailable: false });
      var setMeta = meta[1];
      var saving = react.useState(false);
      var setSaving = saving[1];
      var notice = react.useState(null);
      var setNotice = notice[1];
      var uninstallBusy = react.useState(false);
      var setUninstallBusy = uninstallBusy[1];
      var uninstallResult = react.useState(null);
      var setUninstallResult = uninstallResult[1];

      react.useEffect(() => {
        var alive = true;
        rpc.call('/native-launcher', 'config.get', {}).then((result) => {
          if (!alive) return;
          if (result && result.ok) {
            var v = result.value;
            setForm({
              launchCommand: String(v.launchCommand || ''),
              shortcutName: String(v.shortcutName || ''),
              port: Number(v.port) || 3080,
              autoOpen: v.autoOpen !== false,
              openMode: v.openMode || 'app',
              tray: v.tray !== false,
              traySurvivesDsh: v.traySurvivesDsh !== false,
              trayNotify: v.trayNotify !== false,
              closeToExit: v.closeToExit !== false,
              closeToExitDebounceSeconds: Number(v.closeToExitDebounceSeconds) || 20,
              closeToExitFinalConfirmSeconds: Number(v.closeToExitFinalConfirmSeconds) || 2,
              force: v.force === true,
              modulesNotifications: !(v.modules && v.modules.notifications === false),
            });
            setMeta({ loading: false, error: null, shortcutExists: !!v.shortcutExists, settingsAvailable: v.settingsAvailable !== false });
          } else {
            setMeta({ loading: false, error: (result && result.error && result.error.message) || 'config.get failed', shortcutExists: false, settingsAvailable: false });
          }
        }).catch((error) => {
          if (alive) setMeta({ loading: false, error: String(error && error.message ? error.message : error), shortcutExists: false, settingsAvailable: false });
        });
        return () => { alive = false; };
      }, [rpc]);

      function setValue(key, value) {
        setForm((prev) => Object.assign({}, prev, { [key]: value }));
      }

      function save() {
        if (!form[0]) return;
        setSaving(true);
        setNotice(null);
        var f = form[0];
        rpc.call('/native-launcher', 'config.set', { values: {
          launchCommand: f.launchCommand,
          shortcutName: f.shortcutName,
          port: f.port,
          autoOpen: f.autoOpen,
          openMode: f.openMode,
          tray: f.tray,
          traySurvivesDsh: f.traySurvivesDsh,
          trayNotify: f.trayNotify,
          closeToExit: f.closeToExit,
          closeToExitDebounceSeconds: f.closeToExitDebounceSeconds,
          closeToExitFinalConfirmSeconds: f.closeToExitFinalConfirmSeconds,
          force: f.force,
          modules: { notifications: f.modulesNotifications },
        } }).then((result) => {
          setSaving(false);
          if (result && result.ok) setNotice({ kind: 'ok', text: (result.value && result.value.message) || 'saved' });
          else setNotice({ kind: 'err', text: (result && result.error && result.error.message) || 'save failed' });
        }).catch((error) => {
          setSaving(false);
          setNotice({ kind: 'err', text: String(error && error.message ? error.message : error) });
        });
      }

      var uninstallBusy = react.useState(false);
      var setUninstallBusy = uninstallBusy[1];
      var uninstallResult = react.useState(null);
      var setUninstallResult = uninstallResult[1];

      // 自绘卸载确认框：复用安装引导卡片（showCard）的骨架与样式，内嵌两个勾选，
      // 确认后回调 uninstall(opts)。原生 DOM 实现（document.body 挂载），不受 slot 区域限制。
      function showUninstallConfirm(onConfirm) {
        var overlay = document.createElement('div');
        overlay.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)');
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.parentNode.removeChild(overlay); });
        var card = document.createElement('div');
        card.setAttribute('style', 'display:flex;flex-direction:column;gap:14px;padding:24px;border-radius:14px;background:#ffffff;color:#1a1a1a;box-shadow:0 12px 48px rgba(0,0,0,.35);font:14px/1.5 system-ui,sans-serif;width:400px;max-width:calc(100vw - 48px);border:1px solid #e0e0e0');
        var top = document.createElement('div');
        top.setAttribute('style', 'display:flex;align-items:center;gap:12px');
        var img = document.createElement('img');
        img.src = '/native-launcher/icon.png'; img.alt = '';
        img.setAttribute('style', 'width:44px;height:44px;border-radius:10px;flex:none;background:#f0f0f0');
        var titles = document.createElement('div');
        titles.setAttribute('style', 'display:flex;flex-direction:column;gap:2px;min-width:0');
        var title = document.createElement('div'); title.textContent = '卸载 WebUI 启动器';
        title.setAttribute('style', 'font-size:15px;font-weight:600;color:#1a1a1a');
        var sub = document.createElement('div'); sub.textContent = '此操作将移除启动器的全部组件，且不可撤销。';
        sub.setAttribute('style', 'font-size:12px;color:#666');
        titles.appendChild(title); titles.appendChild(sub);
        top.appendChild(img); top.appendChild(titles);
        var list = document.createElement('ul');
        list.setAttribute('style', 'margin:0;padding-left:18px;font-size:13px;line-height:1.7;color:#333');
        ['停止系统托盘与 dsh 后端服务（约 6 秒后自动停止）', '删除桌面快捷方式', '清理全部生成文件与通知注册表项', '从 dsh profile 移除本插件条目'].forEach(function (t) {
          var li = document.createElement('li'); li.textContent = t; list.appendChild(li);
        });
        function checkRow(text) {
          var row = document.createElement('label');
          row.setAttribute('style', 'display:flex;align-items:center;gap:8px;font-size:13px;color:#1a1a1a;cursor:pointer');
          var cb = document.createElement('input');
          cb.type = 'checkbox'; cb.checked = false;
          cb.style.accentColor = '#e5484d';
          row.appendChild(cb); row.appendChild(document.createTextNode(text));
          row._cb = cb;
          return row;
        }
        var rowStop = checkRow('立即停止 dsh 服务（推荐，否则本次进程继续运行）');
        var rowClear = checkRow('同时清除保存的全部个性化配置（重装后回到默认值）');
        var rowBtn = document.createElement('div');
        rowBtn.setAttribute('style', 'display:flex;gap:10px;justify-content:flex-end');
        var cancel = document.createElement('button');
        cancel.textContent = '取消';
        cancel.setAttribute('style', 'background:none;border:1px solid #ccc;border-radius:8px;color:#444;cursor:pointer;font:inherit;padding:7px 16px');
        cancel.addEventListener('click', function () { overlay.parentNode.removeChild(overlay); });
        var confirmBtn = document.createElement('button');
        confirmBtn.textContent = '确认卸载';
        confirmBtn.setAttribute('style', 'background:#e5484d;color:#fff;border:none;border-radius:8px;cursor:pointer;font:inherit;font-weight:600;padding:7px 22px');
        confirmBtn.addEventListener('click', function () {
          var stop = rowStop._cb.checked, clear = rowClear._cb.checked;
          overlay.parentNode.removeChild(overlay);
          onConfirm({ stopAfter: stop, clearSettings: clear });
        });
        rowBtn.appendChild(cancel); rowBtn.appendChild(confirmBtn);
        card.appendChild(top); card.appendChild(list); card.appendChild(rowStop); card.appendChild(rowClear); card.appendChild(rowBtn);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
      }

      function uninstall(opts) {
        setUninstallBusy(true);
        setUninstallResult(null);
        rpc.call('/native-launcher', 'launcher.uninstall', { clearSettings: !!(opts && opts.clearSettings), stopAfter: !(opts && opts.stopAfter === false) }).then((result) => {
          setUninstallBusy(false);
          if (result && result.ok) setUninstallResult(result.value || { steps: [], manual: [] });
          else setNotice({ kind: 'err', text: (result && result.error && result.error.message) || 'uninstall failed' });
        }).catch((error) => {
          setUninstallBusy(false);
          setNotice({ kind: 'err', text: String(error && error.message ? error.message : error) });
        });
      }

      var inputStyle = {
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-interactive-bg-hover)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        width: 260,
      };

      function groupEl(titleText) {
        return react.createElement('div', { style: { marginTop: 14, marginBottom: 2, fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--dsw-alias-label-tertiary)', textTransform: 'uppercase' } }, titleText);
      }

      function rowEl(label, desc, control) {
        return react.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '7px 0' } }, [
          react.createElement('div', { key: 'l', style: { flex: '1 1 auto' } }, [
            react.createElement('div', { key: 'a', style: { fontSize: 13.5, color: 'var(--dsw-alias-label-primary)' } }, label),
            desc ? react.createElement('div', { key: 'b', style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginTop: 1 } }, desc) : null,
          ]),
          react.createElement('div', { key: 'c', style: { flex: '0 0 auto' } }, control),
        ]);
      }

      function toggleEl(key, disabled) {
        return react.createElement('input', {
          type: 'checkbox',
          checked: !!(form[0] && form[0][key]),
          disabled: !!disabled,
          onChange: (e) => setValue(key, e.target.checked),
          style: { width: 16, height: 16, accentColor: 'var(--dsw-alias-brand-primary)', cursor: 'pointer' },
        });
      }

      function numberEl(key, minValue, maxValue) {
        return react.createElement('input', {
          type: 'number',
          value: form[0] ? form[0][key] : '',
          min: minValue,
          max: maxValue,
          onChange: (e) => setValue(key, Math.max(minValue, Math.floor(Number(e.target.value) || 0))),
          style: Object.assign({}, inputStyle, { width: 90 }),
        });
      }

      var title = react.createElement('h3', { style: { margin: '0 0 12px', fontSize: 16, lineHeight: '24px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, 'WebUI 启动器');
      var intro = react.createElement(
        'p',
        { style: { margin: '0 0 8px', fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' } },
        '桌面快捷方式一键启动 dsh Web UI：静默启动、自动开浏览器、端口探测直连。改动保存后需重启 dsh 完全生效。',
      );

      var content;
      if (meta[0].loading) {
        content = react.createElement('p', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 } }, '加载配置中…');
      } else if (meta[0].error) {
        content = react.createElement('p', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13 } }, '配置读取失败：' + meta[0].error + '（插件 RPC 未注册？请重启后重试）');
      } else {
        var restartHint = react.createElement('div', { style: { marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '带 * 的项在下次启动时生效；其余即时语义项同样建议重启一次以重建脚本。');

        var saveButton = react.createElement(
          'button',
          { type: 'button', onClick: save, disabled: saving[0],
            style: { marginTop: 14, padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-label-inverted, #fff)', fontSize: 13, fontWeight: 500, cursor: saving[0] ? 'default' : 'pointer', opacity: saving[0] ? 0.6 : 1 } },
          saving[0] ? '保存中…' : '保存设置',
        );

        var openModeSelect = react.createElement('select', {
          value: form[0].openMode,
          onChange: (e) => setValue('openMode', e.target.value),
          style: Object.assign({}, inputStyle, { width: 180 }),
        },
          react.createElement('option', { value: 'app' }, 'App 独立窗口（推荐）'),
          react.createElement('option', { value: 'new-window' }, '浏览器独立窗口'),
          react.createElement('option', { value: 'default' }, '浏览器默认行为'),
        );

        content = react.createElement('div', null,
          groupEl('启动'),
          rowEl('启动命令', '桌面快捷方式执行的命令（需 PATH 里有 dsh）*',
            react.createElement('input', { type: 'text', value: form[0].launchCommand, onChange: (e) => setValue('launchCommand', e.target.value), style: inputStyle })),
          rowEl('端口', 'WebUI 端口，需与 webserver 配置一致*', numberEl('port', 1, 65535)),
          rowEl('快捷方式名称', '桌面快捷方式的显示名称*', react.createElement('input', { type: 'text', value: form[0].shortcutName, onChange: (e) => setValue('shortcutName', e.target.value), style: Object.assign({}, inputStyle, { width: 180 }) })),
          rowEl('强制覆盖快捷方式', '每次启动都重新生成快捷方式（默认幂等跳过）', toggleEl('force')),

          groupEl('浏览器窗口'),
          rowEl('自动打开浏览器', '快捷方式启动后自动打开 WebUI（PWA 应用窗口优先）', toggleEl('autoOpen')),
          rowEl('打开方式', null, openModeSelect),

          groupEl('托盘与通知'),
          rowEl('系统托盘', '托盘图标：打开 WebUI / 任务通知 / 退出', toggleEl('tray')),
          rowEl('托盘在 dsh 退出后保留', '关 = 托盘随 dsh 一起退出（保存后立即按新模式重启托盘）', toggleEl('traySurvivesDsh')),
          rowEl('任务托盘通知', '任务完成或需要关注时弹系统通知', toggleEl('trayNotify')),
          rowEl('启用通知模块', 'WebUI 内的任务通知投影通道（关闭仅影响通知模块本身）', toggleEl('modulesNotifications')),

          groupEl('关闭语义（关窗即退）'),
          rowEl('关窗自动退出', '所有窗口关闭且无任务运行时自动退出服务（仅快捷方式启动生效）', toggleEl('closeToExit')),
          rowEl('退出防抖秒数', '关窗后等待的秒数，期间重开页面会取消退出（最小 5）', numberEl('closeToExitDebounceSeconds', 5, 600)),
          rowEl('二次确认窗口秒数', '退出前的最后确认窗口，防误杀重开请求（最小 1）', numberEl('closeToExitFinalConfirmSeconds', 1, 60)),

          saveButton,
          restartHint,
        );
      }

      var button = react.createElement(
        'button',
        {
          type: 'button',
          disabled: meta[0].loading,
          onClick: () => {
            setNotice(null);
            rpc.call('/native-launcher', 'shortcut.recreate', {}).then((result) => {
              if (result && result.ok) setNotice({ kind: 'ok', text: (result.value && result.value.message) || 'shortcut recreated' });
              else setNotice({ kind: 'err', text: (result && result.error && result.error.message) || 'recreate failed' });
            }).catch((error) => setNotice({ kind: 'err', text: String(error && error.message ? error.message : error) }));
          },
          style: {
            marginTop: 18, padding: '8px 16px', borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-interactive-bg-hover)',
            color: 'var(--dsw-alias-label-primary)', fontSize: 13, cursor: 'pointer',
          },
        },
        '重新生成快捷方式（强制覆盖）',
      );

      var uninstallButton = react.createElement(
        'button',
        {
          type: 'button',
          disabled: uninstallBusy[0],
          onClick: function () { showUninstallConfirm(uninstall); },
          style: {
            marginTop: 10, padding: '8px 16px', borderRadius: 8,
            border: '1px solid var(--dsw-alias-state-error-primary)',
            background: 'transparent',
            color: 'var(--dsw-alias-state-error-primary)', fontSize: 13, cursor: uninstallBusy[0] ? 'default' : 'pointer', opacity: uninstallBusy[0] ? 0.6 : 1,
          },
        },
        uninstallBusy[0] ? '卸载中…' : '一键卸载启动器',
      );

      var uninstallEl = null;
      if (uninstallResult[0]) {
        var ur = uninstallResult[0];
        var stepEls = (ur.steps || []).map((s, i) => react.createElement('li', { key: i, style: { marginBottom: 2 } }, s));
        var manualEls = (ur.manual || []).map((s, i) => react.createElement('li', { key: i, style: { marginBottom: 2 } }, s));
        uninstallEl = react.createElement(
          'div',
          { style: { marginTop: 10, fontSize: 12, lineHeight: '19px', color: 'var(--dsw-alias-label-secondary)' } },
          react.createElement('div', { style: { fontWeight: 500 } }, '已完成：'),
          react.createElement('ul', { style: { margin: '4px 0 8px', paddingLeft: 20 } }, stepEls),
          manualEls.length ? react.createElement('div', { style: { fontWeight: 500, color: 'var(--dsw-alias-state-warning-primary)' } }, '需要你手动完成：') : null,
          manualEls.length ? react.createElement('ul', { style: { margin: '4px 0 0', paddingLeft: 20 } }, manualEls) : null,
        );
      }

      var noticeEl = null;
      if (notice[0]) {
        var color = notice[0].kind === 'ok' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)';
        noticeEl = react.createElement('p', { style: { marginTop: 10, fontSize: 12, lineHeight: '18px', color: color } }, notice[0].text);
      }

      return react.createElement('section', { style: { maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 4 } }, title, intro, content, button, uninstallButton, uninstallEl, noticeEl);
    }

    function apply(ctx) {
      // 关闭语义：online/offline 上报（页面加载登记 / 关闭时 keepalive 送达），
      // host 据此判断"无客户端在线"→ 任务检查 → 官方优雅退出
      try {
        var cid = null;
        try { cid = window.localStorage.getItem('dsh-native-launcher.clientId'); } catch (e) {}
        if (!cid) {
          cid = 'c-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
          try { window.localStorage.setItem('dsh-native-launcher.clientId', cid); } catch (e) {}
        }
        var base = window.location.origin;
        var report = function (path) {
          try {
            fetch(base + path + '?client=' + encodeURIComponent(cid), { keepalive: true }).catch(function () {});
          } catch (e) {}
        };
        report('/native-launcher/online');
        window.addEventListener('pagehide', function () { report('/native-launcher/offline'); });
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) report('/native-launcher/online');
        });
      } catch (e) {}

      // pending 传感器（方案 2）：question / plan-review 是 Host waterfall 派给 client 的
      // **活内存态**——不是会话日志事件、host 侧无观测面（REFACTOR_PLAN P1·X 实验 3 实证）。
      // 故 client 保留这个薄传感器：只观察 + 上报，决策与投递全在 host（托盘通道不变）。
      try {
        var pendingRpc = ctx.connection.rpc;
        var pendingSessions = ctx.get('sessions');
        var pendingUiSession = ctx.get('uiSession');
        var pendingObserved = new Map();   // sessionId -> kind（undefined = 无等待）
        var asPendingKind = function (value) {
          return value === 'approval' || value === 'question' || value === 'plan-review' ? value : undefined;
        };
        var reportPending = function (sessionId, kind, title, origin) {
          try {
            pendingRpc.call('/native-launcher', 'pending-report', {
              sessionId: sessionId, kind: kind, title: title, origin: origin,
            }).catch(function () {});
          } catch (e) {}
        };
        var scanPending = function () {
          try {
            var state = pendingSessions && pendingSessions.list ? pendingSessions.list.getSnapshot() : null;
            if (!state) return;
            var live = new Set(state.ids);
            for (var i = 0; i < state.ids.length; i++) {
              var id = state.ids[i];
              var summary = state.byId[id];
              if (!summary) continue;
              var snapshot = pendingUiSession && pendingUiSession.pendingInteractions
                ? pendingUiSession.pendingInteractions.getSnapshot() : null;
              var kind = asPendingKind(summary.pendingInteraction)
                || asPendingKind(snapshot ? (snapshot.get(id) || {}).kind : undefined);
              if (pendingObserved.get(id) === kind) continue;   // 无变化不上报，省 RPC
              pendingObserved.set(id, kind);
              reportPending(id, kind, summary.displayTitle || summary.title, summary.origin);
            }
            pendingObserved.forEach(function (_kind, key) { if (!live.has(key)) pendingObserved.delete(key); });
          } catch (e) {}
        };
        if (pendingSessions && pendingSessions.list && typeof pendingSessions.list.subscribe === 'function') {
          pendingSessions.list.subscribe(scanPending);
        }
        if (pendingUiSession && pendingUiSession.pendingInteractions
          && typeof pendingUiSession.pendingInteractions.subscribe === 'function') {
          pendingUiSession.pendingInteractions.subscribe(scanPending);
        }
        scanPending();   // 首扫：host 侧首见即播种（不补历史通知）
      } catch (e) {}

      // 加固：注册失败只记日志，绝不拖累设置页/GUI 初始化
      try {
        // 组件是 register 的第二个参数（yasa 等正确写法）；inject 提供 RPC
        // alpha.2+ 的设置段注册走 slots.inject 生成器（槽位账本就绪后才挂卡），且 label
        // 必须是函数（官方 "插件" 段同款写法）；rc.2 无 slots.inject，保持直接注册 + 字符串 label。
        var sectionComponent = { inject: function () { return { rpc: ctx.connection.rpc }; } };
        if (typeof ctx.slots.inject === 'function') {
          ctx.slots.inject('settings.section', function* () {
            yield ctx.slots.register(
              {
                name: 'settings.section',
                id: 'native-launcher',
                order: 30,
                label: function () { return 'WebUI 启动器'; },
                inject: sectionComponent.inject,
              },
              LauncherSection,
            );
          });
        } else {
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'native-launcher',
              order: 30,
              label: 'WebUI 启动器',
              inject: sectionComponent.inject,
            },
            LauncherSection,
          );
        }
      } catch (error) {
}

      // 注入自定义 favicon + 真实 URL 的 PWA manifest：
      //   favicon → --app 独立窗口的任务栏图标
      //   manifest → host 提供的 /native-launcher/manifest.webmanifest（真实 http URL，
      //              Chromium 可安装性检查只认这个；blob/data URL 均被拒）
      try {
        ctx.connection.rpc
          .call('/native-launcher', 'icon.get', {})
          .then(function (result) {
            if (!result || !result.ok || !result.value || !result.value.dataUrl) return;
            var head = document.head;
            if (!head) return;

            // 1) 替换已有 favicon，保证窗口/任务栏图标是我们的
            var links = head.querySelectorAll('link[rel~="icon"], link[rel~="shortcut"]');
            for (var i = 0; i < links.length; i++) links[i].remove();
            var iconLink = document.createElement('link');
            iconLink.rel = 'icon';
            iconLink.type = 'image/png';
            iconLink.href = result.value.dataUrl;
            head.appendChild(iconLink);

            // 2) PWA manifest：替换 dsh 自带的 /manifest.webmanifest（浏览器只认第一个 manifest）
            var existing = head.querySelectorAll('link[rel~="manifest"]');
            for (var i = 0; i < existing.length; i++) existing[i].remove();
            var manifestLink = document.createElement('link');
            manifestLink.rel = 'manifest';
            manifestLink.href = '/native-launcher/manifest.webmanifest';
            head.appendChild(manifestLink);
          })
          .catch(function (error) {
});
      } catch (error) {
}

      // 安装引导：站点可安装时（beforeinstallprompt）自动弹出自绘模态框（接近浏览器原生安装框的观感），
      // 点击"安装"才弹浏览器的原生安装框——浏览器硬限制：prompt() 必须用户手势，无法完全自动弹原生框。
      try {
        var promptState = { deferred: null, shown: false, card: null };

        function removeCard() {
          if (promptState.card && promptState.card.parentNode) promptState.card.parentNode.removeChild(promptState.card);
          promptState.card = null;
          promptState.shown = false;
        }

        function showCard() {
          if (promptState.shown || !promptState.deferred || !document.body) return;
          promptState.shown = true;
          var overlay = document.createElement('div');
          overlay.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)');
          overlay.addEventListener('click', function (e) {
            if (e.target === overlay) removeCard();
          });
          var card = document.createElement('div');
          card.setAttribute(
            'style',
            'display:flex;flex-direction:column;gap:16px;padding:24px;border-radius:14px;' +
              'background:#ffffff;color:#1a1a1a;' +
              'box-shadow:0 12px 48px rgba(0,0,0,.35);font:14px/1.5 system-ui,sans-serif;width:340px;max-width:calc(100vw - 48px);' +
              'border:1px solid #e0e0e0',
          );
          var top = document.createElement('div');
          top.setAttribute('style', 'display:flex;align-items:center;gap:12px');
          var img = document.createElement('img');
          img.src = '/native-launcher/icon.png';
          img.alt = '';
          img.setAttribute('style', 'width:44px;height:44px;border-radius:10px;flex:none;background:#f0f0f0');
          var titles = document.createElement('div');
          titles.setAttribute('style', 'display:flex;flex-direction:column;gap:2px;min-width:0');
          var title = document.createElement('div');
          title.textContent = '安装 DSH WebUI';
          title.setAttribute('style', 'font-size:15px;font-weight:600;color:#1a1a1a');
          var sub = document.createElement('div');
          sub.textContent = '安装为桌面应用：独立窗口、任务栏图标、可固定到任务栏。';
          sub.setAttribute('style', 'font-size:12px;color:#666');
          titles.appendChild(title);
          titles.appendChild(sub);
          top.appendChild(img);
          top.appendChild(titles);
          var row = document.createElement('div');
          row.setAttribute('style', 'display:flex;gap:10px;justify-content:flex-end;align-items:center');
          var later = document.createElement('button');
          later.textContent = '稍后';
          later.setAttribute('style', 'background:none;border:1px solid #ccc;border-radius:8px;color:#444;cursor:pointer;font:inherit;padding:7px 16px');
          later.addEventListener('click', removeCard);
          var install = document.createElement('button');
          install.textContent = '安装';
          install.setAttribute(
            'style',
            'background:#4c8dff;color:#fff;border:none;border-radius:8px;' +
              'cursor:pointer;font:inherit;font-weight:600;padding:7px 22px',
          );
          var hint = document.createElement('div');
          hint.textContent = '如果未弹出安装窗口（浏览器限制），请用 Edge 菜单 ⋯ → 更多工具 → 应用 → 将此站点安装为应用。';
          hint.setAttribute('style', 'display:none;font-size:12px;color:#8a5a00;background:#fff7e0;border:1px solid #f0d9a0;border-radius:8px;padding:8px 10px;line-height:1.5');
          install.addEventListener('click', function () {
            var promptEvent = promptState.deferred;
            if (!promptEvent) return;
            promptState.deferred = null;
            // 浏览器安全限制：prompt() 必须用户手势且受 Edge 安装抑制期影响——
            // 若被抑制（此前多次展示/忽略过），prompt() 会被静默丢弃，这里做超时兜底提示
            var settled = false;
            var timer = setTimeout(function () {
              if (settled) return;
              settled = true;
              hint.style.display = 'block';
            }, 2500);
            promptEvent.prompt();
            promptEvent.userChoice
              .then(function () {
                clearTimeout(timer);
                if (!settled) {
                  settled = true;
                  removeCard();
                }
              })
              .catch(function () {
                clearTimeout(timer);
                if (!settled) {
                  settled = true;
                  removeCard();
                }
              });
          });
          row.appendChild(later);
          row.appendChild(install);
          card.appendChild(top);
          card.appendChild(row);
          card.appendChild(hint);
          overlay.appendChild(card);
          document.body.appendChild(overlay);
          promptState.card = overlay;
        }

        window.addEventListener('beforeinstallprompt', function (event) {
          event.preventDefault();
          promptState.deferred = event;
          showCard();
        });
        window.addEventListener('appinstalled', removeCard);
      } catch (error) {
}
    }

    exports.apply = apply;
    exports.inject = ['slots', 'connection', 'sessions', 'locale'];
    return module.exports;
  },
});
}