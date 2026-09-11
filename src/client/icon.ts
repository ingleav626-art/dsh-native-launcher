/**
 * favicon 与 PWA manifest 注入：窗口/任务栏图标换成启动器图标，manifest 指向 host 的真实 http URL。
 *
 * 为什么必须替换 manifest：Chromium 的可安装性检查只认真实 URL（blob/data 均被拒），
 * 而浏览器只采信第一个 manifest——故先摘掉 dsh 自带的那个再挂我们的。
 */

import { clientWarn } from './log.ts'
import { RPC_PATH, type ClientContextLike } from './types.ts'

/** `icon.get` 的应答体（host 生成的内联 PNG data URL）。 */
interface IconPayload {
  readonly dataUrl?: string
}

export function injectIcon(ctx: ClientContextLike): void {
  const rpc = ctx.connection?.rpc;
  // 拿不到 RPC 就没有图标可取：静默返回（连接服务未就绪不该留下崩溃路径与噪声日志）
  if (rpc === undefined) return;
  try {
    rpc.call(RPC_PATH, 'icon.get', {}).then(function (result) {
      if (!result || !result.ok) return;
      const value = result.value as IconPayload | undefined;
      if (!value || !value.dataUrl) return;
      const head = document.head;
      if (!head) return;

      // 1) 替换已有 favicon，保证窗口/任务栏图标是我们的
      var links = head.querySelectorAll('link[rel~="icon"], link[rel~="shortcut"]');
      for (var i = 0; i < links.length; i++) links[i].remove();
      const iconLink = document.createElement('link');
      iconLink.rel = 'icon';
      iconLink.type = 'image/png';
      iconLink.href = value.dataUrl;
      head.appendChild(iconLink);

      // 2) PWA manifest：替换 dsh 自带的 /manifest.webmanifest（浏览器只认第一个 manifest）
      var existing = head.querySelectorAll('link[rel~="manifest"]');
      for (var i = 0; i < existing.length; i++) existing[i].remove();
      const manifestLink = document.createElement('link');
      manifestLink.rel = 'manifest';
      manifestLink.href = '/native-launcher/manifest.webmanifest';
      head.appendChild(manifestLink);
    }).catch(function (error: unknown) {
      clientWarn('icon.get 失败：' + String(error));
    });
  } catch (error) {
    clientWarn('favicon/manifest 注入失败：' + String(error));
  }
}
