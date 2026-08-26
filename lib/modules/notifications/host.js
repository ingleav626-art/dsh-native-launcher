// notifications 模块 adapter（vendored，上游见 VENDOR.json）。
// 职责：声明模块元数据 + 包装上游入口。上游更新时替换 vendor/ 后先试零改动直连。
//
// 边界（dev-notes 一·七）：本开关只控制 notification host 投影（index.js 4.5）；
// 4.6 托盘通知兜底属于启动器本体（与 close-to-exit 共享链路），不受此模块开关影响。

import { apply as upstreamApply } from './vendor/notification-host.js';

export const id = 'notifications';
export const apiVersion = 1;
export const defaultEnabled = true;

// vendored 登记摘要（完整信息见同目录 VENDOR.json）
export const source = 'vendored';

export function apply(ctx, core) {
  // 上游签名：apply(ctx, { maxBodyChars })——翻译我们的 core 为上游选项
  return upstreamApply(ctx, { maxBodyChars: 400 });
}
