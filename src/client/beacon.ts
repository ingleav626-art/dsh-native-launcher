/**
 * 在线心跳（presence 传感器）：页面加载/回前台登记 online、关窗以 keepalive 上报 offline。
 *
 * 这是「关窗即退」的唯一信号源——host 据此判断"无客户端在线"→ 任务检查 → 官方优雅退出。
 */

import { clientWarn } from './log.ts'

export function startBeacon(): void {
  try {
    // 读取失败（隐私模式禁 localStorage）与未播种同路：都落到下面的新 id 分支
    let cid = '';
    try { cid = window.localStorage.getItem('dsh-native-launcher.clientId') || ''; } catch (error) { clientWarn('clientId 读取失败（localStorage 不可用）：' + String(error)); }
    if (!cid) {
      cid = 'c-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try { window.localStorage.setItem('dsh-native-launcher.clientId', cid); } catch (error) { clientWarn('clientId 持久化失败（localStorage 不可用）：' + String(error)); }
    }
    const base = window.location.origin;
    const report = function (path: string) {
      try {
        fetch(base + path + '?client=' + encodeURIComponent(cid), { keepalive: true }).catch(function () {});
      } catch (error) { clientWarn('online/offline 上报不可用：' + String(error)); }
    };
    report('/native-launcher/online');
    window.addEventListener('pagehide', function () { report('/native-launcher/offline'); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) report('/native-launcher/online');
    });
  } catch (error) {
    clientWarn('在线心跳启动失败：' + String(error));
  }
}
