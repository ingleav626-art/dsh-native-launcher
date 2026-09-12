/**
 * 启动器设置卡片：读/存 host 配置、重建快捷方式、跳出卸载确认框。
 *
 * 经官方 `settings.section` 槽位渲染，注入面只有 rpc（`LauncherSectionProps`）；
 * 用 `createElement` 而非 JSX——与基线 `lib/client.js` 逐字可比，且免引 @types/react。
 */

import { createElement, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { RPC_PATH, type RpcFace, type RpcResult } from './types.ts'
import { showUninstallConfirm, type UninstallOptions } from './uninstall.ts'

const LABEL_STYLE = {
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--dsw-alias-label-tertiary)',
  minWidth: 110,
  flex: 'none',
};
const VALUE_STYLE = {
  fontSize: 13,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  wordBreak: 'break-all',
};
const ROW_STYLE = { display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 0' };

/** 官方槽位注入给卡片的全部 props。 */
export interface LauncherSectionProps { readonly rpc: RpcFace }

/** 表单态：字段与 host `config.get` 应答一一对应（基线把 `modules.notifications` 摊平成 modulesNotifications）。 */
interface LauncherForm {
  launchCommand: string
  shortcutName: string
  port: number
  autoOpen: boolean
  openMode: string
  tray: boolean
  traySurvivesDsh: boolean
  trayNotify: boolean
  closeToExit: boolean
  closeToExitDebounceSeconds: number
  closeToExitFinalConfirmSeconds: number
  force: boolean
  autoStartBoot: boolean
}

/** `setValue` 的可写键。 */
type FormKey = keyof LauncherForm
/** 开关字段：`toggleEl` 只收布尔键，取值才不必再收窄。 */
type ToggleKey = 'autoOpen' | 'tray' | 'traySurvivesDsh' | 'trayNotify' | 'closeToExit' | 'force' | 'autoStartBoot'
/** 数值字段：同上，`numberEl` 的 value 需要 number。 */
type NumberKey = 'port' | 'closeToExitDebounceSeconds' | 'closeToExitFinalConfirmSeconds'

/** 卡片元信息（加载态 / 读配置错误 / 快捷方式是否已存在 / 官方 settings 是否可用）。 */
interface SectionMeta {
  loading: boolean
  error: string | null
  shortcutExists: boolean
  settingsAvailable: boolean
}

/** 一次性操作提示（保存、重建快捷方式、卸载失败都走它）。 */
interface Notice {
  kind: 'ok' | 'err'
  text: string
}

/** `config.get` 的应答体（字段可选：未装配/旧版本 host 可能缺项，缺项走基线兜底默认）。 */
interface ConfigPayload {
  readonly launchCommand?: string
  readonly shortcutName?: string
  readonly port?: number | string
  readonly autoOpen?: boolean
  readonly openMode?: string
  readonly tray?: boolean
  readonly traySurvivesDsh?: boolean
  readonly trayNotify?: boolean
  readonly closeToExit?: boolean
  readonly closeToExitDebounceSeconds?: number | string
  readonly closeToExitFinalConfirmSeconds?: number | string
  readonly force?: boolean
  readonly autoStartBoot?: boolean
  readonly modules?: { readonly notifications?: boolean }
  readonly shortcutExists?: boolean
  readonly settingsAvailable?: boolean
}

/** `launcher.uninstall` 的应答体：已完成步骤 + 需人工完成项。 */
interface UninstallResult {
  readonly steps?: readonly string[]
  readonly manual?: readonly string[]
}

/** 取应答体的 `message`（host 的 `config.set` / `shortcut.recreate` 约定）；`value` 是 unknown，取值前先守卫。 */
function resultMessage(result: RpcResult<unknown>): string | undefined {
  const value = result.value;
  if (!value || typeof value !== 'object') return undefined;
  const message = (value as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

/** 把 catch 到的任意失败转成提示文本（基线写 `error && error.message ? error.message : error`；reason 是 unknown，故先守卫）。 */
function failText(error: unknown): string {
  const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : undefined;
  return String(message ? message : error);
}

interface RowProps {
  readonly label: string
  readonly children?: ReactNode
}

function Row(props: RowProps): ReactElement {
  return createElement(
    'div',
    { style: ROW_STYLE },
    createElement('div', { style: LABEL_STYLE }, props.label),
    createElement('div', { style: VALUE_STYLE }, props.children),
  );
}

export function LauncherSection(props: LauncherSectionProps): ReactElement {
  const rpc = props.rpc;
  const form = useState<LauncherForm | null>(null);
  const setForm = form[1];
  const meta = useState<SectionMeta>({ loading: true, error: null, shortcutExists: false, settingsAvailable: false });
  const setMeta = meta[1];
  const saving = useState(false);
  const setSaving = saving[1];
  const notice = useState<Notice | null>(null);
  const setNotice = notice[1];
  const uninstallBusy = useState(false);
  const setUninstallBusy = uninstallBusy[1];
  const uninstallResult = useState<UninstallResult | null>(null);
  const setUninstallResult = uninstallResult[1];

  useEffect(() => {
    let alive = true;
    rpc.call(RPC_PATH, 'config.get', {}).then((result) => {
      if (!alive) return;
      if (result && result.ok) {
        const v = result.value as ConfigPayload;
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
          autoStartBoot: v.autoStartBoot === true,
        });
        setMeta({ loading: false, error: null, shortcutExists: !!v.shortcutExists, settingsAvailable: v.settingsAvailable !== false });
      } else {
        setMeta({ loading: false, error: (result && result.error && result.error.message) || 'config.get failed', shortcutExists: false, settingsAvailable: false });
      }
    }).catch((error: unknown) => {
      if (alive) setMeta({ loading: false, error: failText(error), shortcutExists: false, settingsAvailable: false });
    });
    return () => { alive = false; };
  }, [rpc]);

  function setValue(key: FormKey, value: unknown) {
    setForm((prev) => Object.assign({}, prev, { [key]: value }));
  }

  function save() {
    if (!form[0]) return;
    setSaving(true);
    setNotice(null);
    const f = form[0];
    rpc.call(RPC_PATH, 'config.set', { values: {
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
      autoStartBoot: f.autoStartBoot,
    } }).then((result) => {
      setSaving(false);
      if (result && result.ok) setNotice({ kind: 'ok', text: resultMessage(result) || 'saved' });
      else setNotice({ kind: 'err', text: (result && result.error && result.error.message) || 'save failed' });
    }).catch((error: unknown) => {
      setSaving(false);
      setNotice({ kind: 'err', text: failText(error) });
    });
  }

  function uninstall(opts: UninstallOptions) {
    setUninstallBusy(true);
    setUninstallResult(null);
    rpc.call(RPC_PATH, 'launcher.uninstall', { clearSettings: !!(opts && opts.clearSettings), stopAfter: !(opts && opts.stopAfter === false) }).then((result) => {
      setUninstallBusy(false);
      if (result && result.ok) setUninstallResult((result.value as UninstallResult | null) || { steps: [], manual: [] });
      else setNotice({ kind: 'err', text: (result && result.error && result.error.message) || 'uninstall failed' });
    }).catch((error: unknown) => {
      setUninstallBusy(false);
      setNotice({ kind: 'err', text: failText(error) });
    });
  }

  const inputStyle = {
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-interactive-bg-hover)',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: 13,
    width: 260,
  };

  function groupEl(titleText: string) {
    return createElement('div', { style: { marginTop: 14, marginBottom: 2, fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--dsw-alias-label-tertiary)', textTransform: 'uppercase' } }, titleText);
  }

  function rowEl(label: string, desc: string | null, control: ReactNode) {
    return createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '7px 0' } }, [
      createElement('div', { key: 'l', style: { flex: '1 1 auto' } }, [
        createElement('div', { key: 'a', style: { fontSize: 13.5, color: 'var(--dsw-alias-label-primary)' } }, label),
        desc ? createElement('div', { key: 'b', style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginTop: 1 } }, desc) : null,
      ]),
      createElement('div', { key: 'c', style: { flex: '0 0 auto' } }, control),
    ]);
  }

  function toggleEl(key: ToggleKey, disabled?: boolean) {
    return createElement('input', {
      type: 'checkbox',
      checked: !!(form[0] && form[0][key]),
      disabled: !!disabled,
      onChange: (e) => setValue(key, e.target.checked),
      style: { width: 16, height: 16, accentColor: 'var(--dsw-alias-brand-primary)', cursor: 'pointer' },
    });
  }

  function numberEl(key: NumberKey, minValue: number, maxValue: number) {
    return createElement('input', {
      type: 'number',
      value: form[0] ? form[0][key] : '',
      min: minValue,
      max: maxValue,
      onChange: (e) => setValue(key, Math.max(minValue, Math.floor(Number(e.target.value) || 0))),
      style: Object.assign({}, inputStyle, { width: 90 }),
    });
  }

  const title = createElement('h3', { style: { margin: '0 0 12px', fontSize: 16, lineHeight: '24px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, 'WebUI 启动器');
  const intro = createElement(
    'p',
    { style: { margin: '0 0 8px', fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' } },
    '桌面快捷方式一键启动 dsh Web UI：静默启动、自动开浏览器、端口探测直连。改动保存后需重启 dsh 完全生效。',
  );

  let content: ReactElement;
  if (meta[0].loading) {
    content = createElement('p', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 } }, '加载配置中…');
  } else if (meta[0].error) {
    content = createElement('p', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13 } }, '配置读取失败：' + meta[0].error + '（插件 RPC 未注册？请重启后重试）');
  } else {
    // 不变式：非 loading 且无 error ⇒ 表单已装载（失败路径都写 error），故这里的 form[0]! 恒非空
    const restartHint = createElement('div', { style: { marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '带 * 的项在下次启动时生效；其余即时语义项同样建议重启一次以重建脚本。');

    const saveButton = createElement(
      'button',
      { type: 'button', onClick: save, disabled: saving[0],
        style: { marginTop: 14, padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-label-inverted, #fff)', fontSize: 13, fontWeight: 500, cursor: saving[0] ? 'default' : 'pointer', opacity: saving[0] ? 0.6 : 1 } },
      saving[0] ? '保存中…' : '保存设置',
    );

    const openModeSelect = createElement('select', {
      value: form[0]!.openMode,
      onChange: (e) => setValue('openMode', e.target.value),
      style: Object.assign({}, inputStyle, { width: 180 }),
    },
      createElement('option', { value: 'app' }, 'App 独立窗口（推荐）'),
      createElement('option', { value: 'new-window' }, '浏览器独立窗口'),
      createElement('option', { value: 'default' }, '浏览器默认行为'),
    );

    content = createElement('div', null,
      groupEl('启动'),
      rowEl('启动命令', '桌面快捷方式执行的命令（需 PATH 里有 dsh）*',
        createElement('input', { type: 'text', value: form[0]!.launchCommand, onChange: (e) => setValue('launchCommand', e.target.value), style: inputStyle })),
      rowEl('端口', 'WebUI 端口，需与 webserver 配置一致*', numberEl('port', 1, 65535)),
      rowEl('快捷方式名称', '桌面快捷方式的显示名称*', createElement('input', { type: 'text', value: form[0]!.shortcutName, onChange: (e) => setValue('shortcutName', e.target.value), style: Object.assign({}, inputStyle, { width: 180 }) })),
      rowEl('强制覆盖快捷方式', '每次启动都重新生成快捷方式（默认幂等跳过）', toggleEl('force')),

      groupEl('浏览器窗口'),
      rowEl('自动打开浏览器', '快捷方式启动后自动打开 WebUI（PWA 应用窗口优先）', toggleEl('autoOpen')),
      rowEl('打开方式', null, openModeSelect),

      groupEl('托盘与通知'),
      rowEl('系统托盘', '托盘图标：打开 WebUI / 任务通知 / 退出', toggleEl('tray')),
      rowEl('托盘在 dsh 退出后保留', '关 = 托盘随 dsh 一起退出（保存后立即按新模式重启托盘）', toggleEl('traySurvivesDsh')),
      rowEl('托盘弹系统通知', '总开关：关闭后托盘不再弹系统通知（通知时机与规则在下方通知卡片里管理）', toggleEl('trayNotify')),

      groupEl('关闭语义（关窗即退）'),
      rowEl('关窗自动退出', '所有窗口关闭且无任务运行时自动退出服务（仅快捷方式启动生效）', toggleEl('closeToExit')),
      rowEl('退出防抖秒数', '关窗后等待的秒数，期间重开页面会取消退出（最小 5）', numberEl('closeToExitDebounceSeconds', 5, 600)),
      rowEl('二次确认窗口秒数', '退出前的最后确认窗口，防误杀重开请求（最小 1）', numberEl('closeToExitFinalConfirmSeconds', 1, 60)),

      saveButton,
      restartHint,
    );
  }

  // 排错入口：所有日志都在生成物目录里（没有第二个目录），一键打开后整批拖给维护者即可。
  // 为什么放在设置页而不是托盘：这条链路全在 TS 侧（host 端点 + 卡片按钮），不必动
  // PowerShell 生成脚本与托盘版本自更新链，改动面最小。
  const logsButton = createElement(
    'button',
    {
      type: 'button',
      onClick: () => {
        setNotice(null);
        rpc.call(RPC_PATH, 'diagnostics.openLogs', {}).then((result) => {
          const opened = result && result.ok ? (result.value as { path?: string } | undefined)?.path : undefined;
          if (result && result.ok) {
            setNotice({ kind: 'ok', text: opened ? `已打开日志目录：${opened}（把整个 logs 文件夹发过来即可）` : '已打开日志目录（把整个 logs 文件夹发过来即可）' });
          } else {
            setNotice({ kind: 'err', text: (result && result.error && result.error.message) || '打开日志目录失败' });
          }
        }).catch((error: unknown) => setNotice({ kind: 'err', text: failText(error) }));
      },
      style: {
        marginTop: 10, padding: '8px 16px', borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-interactive-bg-hover)',
        color: 'var(--dsw-alias-label-primary)', fontSize: 13, cursor: 'pointer',
      },
    },
    '打开日志目录（排错用）',
  );

  const button = createElement(
    'button',
    {
      type: 'button',
      disabled: meta[0].loading,
      onClick: () => {
        setNotice(null);
        rpc.call(RPC_PATH, 'shortcut.recreate', {}).then((result) => {
          if (result && result.ok) setNotice({ kind: 'ok', text: resultMessage(result) || 'shortcut recreated' });
          else setNotice({ kind: 'err', text: (result && result.error && result.error.message) || 'recreate failed' });
        }).catch((error: unknown) => setNotice({ kind: 'err', text: failText(error) }));
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

  const uninstallButton = createElement(    'button',
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

  let uninstallEl: ReactElement | null = null;
  if (uninstallResult[0]) {
    const ur = uninstallResult[0];
    const stepEls = (ur.steps || []).map((s, i) => createElement('li', { key: i, style: { marginBottom: 2 } }, s));
    const manualEls = (ur.manual || []).map((s, i) => createElement('li', { key: i, style: { marginBottom: 2 } }, s));
    uninstallEl = createElement(
      'div',
      { style: { marginTop: 10, fontSize: 12, lineHeight: '19px', color: 'var(--dsw-alias-label-secondary)' } },
      createElement('div', { style: { fontWeight: 500 } }, '已完成：'),
      createElement('ul', { style: { margin: '4px 0 8px', paddingLeft: 20 } }, stepEls),
      manualEls.length ? createElement('div', { style: { fontWeight: 500, color: 'var(--dsw-alias-state-warning-primary)' } }, '需要你手动完成：') : null,
      manualEls.length ? createElement('ul', { style: { margin: '4px 0 0', paddingLeft: 20 } }, manualEls) : null,
    );
  }

  let noticeEl: ReactElement | null = null;
  if (notice[0]) {
    const color = notice[0].kind === 'ok' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)';
    noticeEl = createElement('p', { style: { marginTop: 10, fontSize: 12, lineHeight: '18px', color: color } }, notice[0].text);
  }

  return createElement('section', { style: { maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 4 } }, title, intro, content, button, logsButton, uninstallButton, uninstallEl, noticeEl);
}
