/**
 * 卸载确认框：自绘模态框（document.body 挂载）+ 两个勾选，确认后把选项回调给调用方。
 *
 * 为什么不用 React：它挂在 slot 区域之外（overlay 要覆盖整页），且沿用基线的原生 DOM 实现。
 */

/** 卸载选项（对齐 host `launcher.uninstall` 的入参）。 */
export interface UninstallOptions { readonly stopAfter: boolean; readonly clearSettings: boolean }

/** 勾选行：给 label 元素外挂 checkbox 引用（沿用基线写法，省一个包装对象的分配）。 */
interface CheckRowElement extends HTMLLabelElement {
  _cb: HTMLInputElement
}

// 自绘卸载确认框：复用安装引导卡片（showCard）的骨架与样式，内嵌两个勾选，
// 确认后回调 uninstall(opts)。原生 DOM 实现（document.body 挂载），不受 slot 区域限制。
export function showUninstallConfirm(onConfirm: (options: UninstallOptions) => void): void {
  const overlay = document.createElement('div');
  overlay.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)');
  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.parentNode!.removeChild(overlay); });
  const card = document.createElement('div');
  card.setAttribute('style', 'display:flex;flex-direction:column;gap:14px;padding:24px;border-radius:14px;background:#ffffff;color:#1a1a1a;box-shadow:0 12px 48px rgba(0,0,0,.35);font:14px/1.5 system-ui,sans-serif;width:400px;max-width:calc(100vw - 48px);border:1px solid #e0e0e0');
  const top = document.createElement('div');
  top.setAttribute('style', 'display:flex;align-items:center;gap:12px');
  const img = document.createElement('img');
  img.src = '/native-launcher/icon.png'; img.alt = '';
  img.setAttribute('style', 'width:44px;height:44px;border-radius:10px;flex:none;background:#f0f0f0');
  const titles = document.createElement('div');
  titles.setAttribute('style', 'display:flex;flex-direction:column;gap:2px;min-width:0');
  const title = document.createElement('div'); title.textContent = '卸载 WebUI 启动器';
  title.setAttribute('style', 'font-size:15px;font-weight:600;color:#1a1a1a');
  const sub = document.createElement('div'); sub.textContent = '此操作将移除启动器的全部组件，且不可撤销。';
  sub.setAttribute('style', 'font-size:12px;color:#666');
  titles.appendChild(title); titles.appendChild(sub);
  top.appendChild(img); top.appendChild(titles);
  const list = document.createElement('ul');
  list.setAttribute('style', 'margin:0;padding-left:18px;font-size:13px;line-height:1.7;color:#333');
  ['停止系统托盘与 dsh 后端服务（约 6 秒后自动停止）', '删除桌面快捷方式', '清理全部生成文件与通知注册表项', '从 dsh profile 移除本插件条目'].forEach(function (t) {
    const li = document.createElement('li'); li.textContent = t; list.appendChild(li);
  });
  function checkRow(text: string): CheckRowElement {
    const row = document.createElement('label') as CheckRowElement;
    row.setAttribute('style', 'display:flex;align-items:center;gap:8px;font-size:13px;color:#1a1a1a;cursor:pointer');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = false;
    cb.style.accentColor = '#e5484d';
    row.appendChild(cb); row.appendChild(document.createTextNode(text));
    row._cb = cb;
    return row;
  }
  const rowStop = checkRow('立即停止 dsh 服务（推荐，否则本次进程继续运行）');
  const rowClear = checkRow('同时清除保存的全部个性化配置（重装后回到默认值）');
  const rowBtn = document.createElement('div');
  rowBtn.setAttribute('style', 'display:flex;gap:10px;justify-content:flex-end');
  const cancel = document.createElement('button');
  cancel.textContent = '取消';
  cancel.setAttribute('style', 'background:none;border:1px solid #ccc;border-radius:8px;color:#444;cursor:pointer;font:inherit;padding:7px 16px');
  cancel.addEventListener('click', function () { overlay.parentNode!.removeChild(overlay); });
  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '确认卸载';
  confirmBtn.setAttribute('style', 'background:#e5484d;color:#fff;border:none;border-radius:8px;cursor:pointer;font:inherit;font-weight:600;padding:7px 22px');
  confirmBtn.addEventListener('click', function () {
    const stop = rowStop._cb.checked, clear = rowClear._cb.checked;
    overlay.parentNode!.removeChild(overlay);
    onConfirm({ stopAfter: stop, clearSettings: clear });
  });
  rowBtn.appendChild(cancel); rowBtn.appendChild(confirmBtn);
  card.appendChild(top); card.appendChild(list); card.appendChild(rowStop); card.appendChild(rowClear); card.appendChild(rowBtn);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
