/**
 * 安装引导：站点可安装时（beforeinstallprompt）弹自绘模态框，引导把 WebUI 装成桌面应用。
 *
 * 浏览器硬限制：原生 `prompt()` 必须由用户手势触发，无法全自动——故先给自绘框，
 * 点「安装」才弹原生框；被 Edge 安装抑制期静默丢弃时用 2.5s 超时兜底给出手动路径。
 */

import { clientWarn } from './log.ts'

/** Chromium 的 beforeinstallprompt 事件（非标准，TS DOM lib 无声明，只声明我们触摸的成员）。 */
interface InstallPromptEvent extends Event {
  prompt(): void
  readonly userChoice: Promise<unknown>
}

/** 安装引导的模态框状态（deferred 由事件给，卡片由自绘）。 */
interface InstallPromptState {
  deferred: InstallPromptEvent | null
  shown: boolean
  card: HTMLDivElement | null
}

export function startInstallPrompt(): void {
  try {
    const promptState: InstallPromptState = { deferred: null, shown: false, card: null };

    function removeCard() {
      if (promptState.card && promptState.card.parentNode) promptState.card.parentNode.removeChild(promptState.card);
      promptState.card = null;
      promptState.shown = false;
    }

    function showCard() {
      if (promptState.shown || !promptState.deferred || !document.body) return;
      promptState.shown = true;
      const overlay = document.createElement('div');
      overlay.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)');
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) removeCard();
      });
      const card = document.createElement('div');
      card.setAttribute(
        'style',
        'display:flex;flex-direction:column;gap:16px;padding:24px;border-radius:14px;' +
          'background:#ffffff;color:#1a1a1a;' +
          'box-shadow:0 12px 48px rgba(0,0,0,.35);font:14px/1.5 system-ui,sans-serif;width:340px;max-width:calc(100vw - 48px);' +
          'border:1px solid #e0e0e0',
      );
      const top = document.createElement('div');
      top.setAttribute('style', 'display:flex;align-items:center;gap:12px');
      const img = document.createElement('img');
      img.src = '/native-launcher/icon.png';
      img.alt = '';
      img.setAttribute('style', 'width:44px;height:44px;border-radius:10px;flex:none;background:#f0f0f0');
      const titles = document.createElement('div');
      titles.setAttribute('style', 'display:flex;flex-direction:column;gap:2px;min-width:0');
      const title = document.createElement('div');
      title.textContent = '安装 DSH WebUI';
      title.setAttribute('style', 'font-size:15px;font-weight:600;color:#1a1a1a');
      const sub = document.createElement('div');
      sub.textContent = '安装为桌面应用：独立窗口、任务栏图标、可固定到任务栏。';
      sub.setAttribute('style', 'font-size:12px;color:#666');
      titles.appendChild(title);
      titles.appendChild(sub);
      top.appendChild(img);
      top.appendChild(titles);
      const row = document.createElement('div');
      row.setAttribute('style', 'display:flex;gap:10px;justify-content:flex-end;align-items:center');
      const later = document.createElement('button');
      later.textContent = '稍后';
      later.setAttribute('style', 'background:none;border:1px solid #ccc;border-radius:8px;color:#444;cursor:pointer;font:inherit;padding:7px 16px');
      later.addEventListener('click', removeCard);
      const install = document.createElement('button');
      install.textContent = '安装';
      install.setAttribute(
        'style',
        'background:#4c8dff;color:#fff;border:none;border-radius:8px;' +
          'cursor:pointer;font:inherit;font-weight:600;padding:7px 22px',
      );
      const hint = document.createElement('div');
      hint.textContent = '如果未弹出安装窗口（浏览器限制），请用 Edge 菜单 ⋯ → 更多工具 → 应用 → 将此站点安装为应用。';
      hint.setAttribute('style', 'display:none;font-size:12px;color:#8a5a00;background:#fff7e0;border:1px solid #f0d9a0;border-radius:8px;padding:8px 10px;line-height:1.5');
      install.addEventListener('click', function () {
        const promptEvent = promptState.deferred;
        if (!promptEvent) return;
        promptState.deferred = null;
        // 浏览器安全限制：prompt() 必须用户手势且受 Edge 安装抑制期影响——
        // 若被抑制（此前多次展示/忽略过），prompt() 会被静默丢弃，这里做超时兜底提示
        let settled = false;
        const timer = setTimeout(function () {
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
      promptState.deferred = event as InstallPromptEvent;
      showCard();
    });
    window.addEventListener('appinstalled', removeCard);
  } catch (error) {
    clientWarn('安装引导启动失败：' + String(error));
  }
}
