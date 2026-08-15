// dsh-native-launcher — Client half
// 在设置页侧边栏注册 "WebUI 启动器" 增强设置 section：
//   - 显示当前启动器配置（启动命令 / 快捷方式名 / 端口 / 自动开浏览器）
//   - "重新生成快捷方式"按钮（强制覆盖，force: true）
// 手写 __ModuleLoader__ 格式，零构建步骤。
// 服务端 import 本文件（bundle client 元数据收集）时不执行浏览器代码，
// 否则 window / require 在 Node ESM 环境未定义导致 loader 加载失败。
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

    // ── 任务通知设置（localStorage 持久化；host 端 turn/end 检测见 lib/index.js）──
    var NOTIFY_KEY = 'native-launcher.notify';
    var REASON_LABELS = { completed: '正常完成', error: '出错', aborted: '被中止', blocked: '被阻塞（等待批准/回答）', maxTokens: '达到 Token 上限' };
    var REASON_KEYS = ['completed', 'error', 'aborted', 'blocked', 'maxTokens'];

    function defaultNotifySettings() {
      return { enabled: true, completed: true, error: true, aborted: false, blocked: true, maxTokens: false, outOfViewOnly: true };
    }
    function loadNotifySettings() {
      try {
        var raw = localStorage.getItem(NOTIFY_KEY);
        if (!raw) return defaultNotifySettings();
        return Object.assign(defaultNotifySettings(), JSON.parse(raw));
      } catch (e) {
        return defaultNotifySettings();
      }
    }
    function saveNotifySettings(settings) {
      try {
        localStorage.setItem(NOTIFY_KEY, JSON.stringify(settings));
      } catch (e) {}
    }
    function reasonEnabled(settings, reason) {
      if (reason === 'max-tokens') reason = 'maxTokens';
      return settings[reason] === undefined ? false : settings[reason];
    }
    function reasonTitle(kind) {
      return 'DSH 任务' + (REASON_LABELS[kind] || '完成');
    }
    function reasonBody(kind, sessionId) {
      if (kind === 'blocked') return '会话 ' + sessionId + ' 需要你处理（批准或回答）';
      return '会话 ' + sessionId + ' ' + (REASON_LABELS[kind] || '已完成');
    }
    function enableNotifyPermission(setNotice) {
      if (typeof Notification === 'undefined') {
        setNotice({ kind: 'err', text: '当前浏览器不支持系统通知' });
        return;
      }
      Notification.requestPermission().then(function (perm) {
        if (perm === 'granted') {
          setNotice({ kind: 'ok', text: '通知权限已授予：任务完成时页面内提醒；页面关闭时由托盘气泡提醒' });
          try {
            new Notification('DSH 任务通知已启用', { body: '任务完成时你会收到提醒', icon: '/native-launcher/icon.png' });
          } catch (e) {}
        } else {
          setNotice({ kind: 'err', text: '通知权限未授予：请在浏览器站点设置中允许通知' });
        }
      });
    }

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
      var state = react.useState({ loading: true, config: null, error: null });
      var config = state[0];
      var setConfig = state[1];
      var busy = react.useState(false);
      var setBusy = busy[1];
      var notice = react.useState(null);
      var setNotice = notice[1];

      react.useEffect(() => {
        var alive = true;
        rpc
          .call('/native-launcher', 'config.get', {})
          .then((result) => {
            if (!alive) return;
            if (result && result.ok) setConfig({ loading: false, config: result.value, error: null });
            else setConfig({ loading: false, config: null, error: (result && result.error && result.error.message) || 'config.get failed' });
          })
          .catch((error) => {
            if (alive) setConfig({ loading: false, config: null, error: String(error && error.message ? error.message : error) });
          });
        return () => {
          alive = false;
        };
      }, [rpc]);

      function recreate() {
        setBusy(true);
        setNotice(null);
        rpc
          .call('/native-launcher', 'shortcut.recreate', {})
          .then((result) => {
            setBusy(false);
            if (result && result.ok) setNotice({ kind: 'ok', text: result.value.message || 'shortcut recreated' });
            else setNotice({ kind: 'err', text: (result && result.error && result.error.message) || 'recreate failed' });
          })
          .catch((error) => {
            setBusy(false);
            setNotice({ kind: 'err', text: String(error && error.message ? error.message : error) });
          });
      }

      // 通知设置：总开关 + 结果类型开关（localStorage 持久化，决策见模块级函数）
      var notifyState = react.useState(function () {
        return loadNotifySettings();
      });
      var notifySettings = notifyState[0];
      var setNotifySettings = notifyState[1];

      function toggleNotify(key, checked) {
        var next = Object.assign({}, notifySettings);
        next[key] = checked;
        setNotifySettings(next);
        saveNotifySettings(next);
      }

      function checkbox(label, key) {
        return react.createElement(
          'label',
          { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--dsw-alias-label-primary)' } },
          react.createElement('input', {
            type: 'checkbox',
            checked: notifySettings[key] === true,
            onChange: function (e) {
              toggleNotify(key, e.target.checked);
            },
            style: { cursor: 'pointer' },
          }),
          label,
        );
      }

      var title = react.createElement('h3', { style: { margin: '0 0 12px', fontSize: 16, lineHeight: '24px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, 'WebUI 启动器（增强设置）');
      var intro = react.createElement(
        'p',
        { style: { margin: '0 0 16px', fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-tertiary)' } },
        '桌面快捷方式一键启动 dsh Web UI：静默启动、自动开浏览器、端口探测直连。生成物位于用户目录 ~/.dsh-webui-launcher/。',
      );

      var body;
      if (config.loading) {
        body = react.createElement('p', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, '加载配置中…');
      } else if (config.error) {
        body = react.createElement(
          'p',
          { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13 } },
          '配置读取失败：' + config.error + '（插件 RPC 未注册？请确认插件已挂载并重启）',
        );
      } else {
        var c = config.config;
        body = react.createElement(
          'div',
          null,
          react.createElement(Row, { label: '启动命令' }, String(c.launchCommand)),
          react.createElement(Row, { label: '快捷方式名' }, String(c.shortcutName)),
          react.createElement(Row, { label: '端口' }, String(c.port)),
          react.createElement(Row, { label: '自动开浏览器' }, c.autoOpen ? '开' : '关'),
          react.createElement(Row, { label: '快捷方式状态' }, c.shortcutExists ? '已存在（幂等跳过，不覆盖）' : '不存在（下次启动生成）'),
          react.createElement(Row, { label: '启动脚本' }, String(c.vbsPath)),
        );
      }

      var notifyBlock = react.createElement(
        'div',
        { style: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 } },
        react.createElement(
          'div',
          { style: { fontSize: 13, fontWeight: 600, margin: '10px 0 2px', color: 'var(--dsw-alias-label-primary)' } },
          '任务通知（页面内 + 托盘气泡）',
        ),
        checkbox('启用通知', 'enabled'),
        checkbox(REASON_LABELS.completed, 'completed'),
        checkbox(REASON_LABELS.error, 'error'),
        checkbox(REASON_LABELS.aborted, 'aborted'),
        checkbox(REASON_LABELS.blocked, 'blocked'),
        checkbox(REASON_LABELS.maxTokens, 'maxTokens'),
        react.createElement(
          'button',
          {
            type: 'button',
            onClick: function () {
              enableNotifyPermission(setNotice);
            },
            style: {
              alignSelf: 'flex-start',
              marginTop: 6,
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-interactive-bg-hover)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 13,
              cursor: 'pointer',
            },
          },
          '授予通知权限',
        ),
      );

      var button = react.createElement(
        'button',
        {
          type: 'button',
          disabled: busy[0],
          onClick: recreate,
          style: {
            marginTop: 16,
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-interactive-bg-hover)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 13,
            cursor: busy[0] ? 'default' : 'pointer',
            opacity: busy[0] ? 0.6 : 1,
          },
        },
        busy[0] ? '处理中…' : '重新生成快捷方式（强制覆盖）',
      );

      var noticeEl = null;
      if (notice[0]) {
        var color = notice[0].kind === 'ok' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)';
        noticeEl = react.createElement('p', { style: { marginTop: 10, fontSize: 12, lineHeight: '18px', color: color } }, notice[0].text);
      }

      return react.createElement('section', { style: { maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 4 } }, title, intro, body, notifyBlock, button, noticeEl);
    }

    function apply(ctx) {
      // 加固：注册失败只记日志，绝不拖累设置页/GUI 初始化
      try {
        // 组件是 register 的第二个参数（yasa 等正确写法）；inject 提供 RPC
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'native-launcher',
            order: 30,
            label: 'WebUI 启动器',
            inject: () => ({ rpc: ctx.connection.rpc }),
          },
          LauncherSection,
        );
      } catch (error) {
        console.error('[native-launcher] settings section registration failed:', error);
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
            console.error('[native-launcher] favicon inject failed:', error);
          });
      } catch (error) {
        console.error('[native-launcher] icon inject failed:', error);
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
        console.error('[native-launcher] install prompt setup failed:', error);
      }

      // ── 任务通知轮询（决策设置见模块级：REASON_LABELS/loadNotifySettings 等）──
      // host 在 session/event turn/end 时写入 notify.json；页面关了由托盘气泡兜底。
      try {
        var notifyCursor = 0;
        var notifySeen = false;
        // 主动索要通知权限（原生权限窗口）：页面加载后延迟请求，未授权时自动弹出
        if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
          setTimeout(function () {
            try {
              Notification.requestPermission().then(function (perm) {
                if (perm === 'granted') {
                  try {
                    new Notification('DSH 任务通知已启用', { body: '任务完成时你会收到提醒；页面关闭时由托盘气泡提醒', icon: '/native-launcher/icon.png' });
                  } catch (e) {}
                }
              });
            } catch (e) {}
          }, 2000);
        }
        var notifyTimer = setInterval(function () {
          ctx.connection.rpc
            .call('/native-launcher', 'notify.last', {})
            .then(function (result) {
              if (!result || !result.ok || !result.value) return;
              var at = Number(result.value.at) || 0;
              if (!notifySeen) {
                notifySeen = true;
                notifyCursor = at;
                return;
              }
              if (at > notifyCursor) {
                notifyCursor = at;
                var settings = loadNotifySettings();
                if (!settings.enabled) return;
                var kind = result.value.kind || 'completed';
                if (!reasonEnabled(settings, kind)) return;
                // 仅页面隐藏时通知：你正看着页面时回合完成不打扰（阻塞类始终通知——等批准不能错过）
                if (settings.outOfViewOnly && kind !== 'blocked' && typeof document !== 'undefined' && !document.hidden) return;
                if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                  new Notification(reasonTitle(kind), {
                    body: reasonBody(kind, result.value.sessionId || '?'),
                    icon: '/native-launcher/icon.png',
                  });
                }
              }
            })
            .catch(function () {});
        }, 3000);
      } catch (error) {
        console.error('[native-launcher] notify poll setup failed:', error);
      }
    }

    exports.apply = apply;
    exports.inject = ['slots', 'connection'];
    return module.exports;
  },
});
}
