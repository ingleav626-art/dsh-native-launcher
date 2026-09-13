/**
 * 进程优先级（L2 副作用边界）：把 dsh 本体提到 AboveNormal。
 *
 * 为什么必须做（2026-09-13 真机实测：隐显对照 + 合成负载 + 原生算力）：
 * Windows 对「没有可见窗口」的进程在创建后约 3s 施加节流——交付算力降到 1/3、
 * 文件 IO 降到 1/5、原生 SHA256 降到 1/2，而 `GetProcessTimes` 仍按 1:1 记账
 * （看起来满负荷跑，实际算得少）。隐藏启动的 dsh 本体装载因此从 ~8s 拖到 24~32s，
 * 且该状态至少持续 17s（实测窗口）——运行期同样被压制，不只是启动慢。
 *
 * 解除开关 = 进程优先级类高于 Normal。**父进程的类不会被子进程继承**
 * （实测：父 PowerShell 设 AboveNormal，子 node 仍报 Normal），
 * 所以启动器替我们设没有用，只能在 dsh 自己的进程里提。AboveNormal 足够，无需 High。
 */
import { getPriority, setPriority, constants } from 'node:os';

export interface PriorityRaise {
  before: number | null;
  after: number | null;
  raised: boolean;
  /** 自提时刻（node 进程启动后的毫秒数）——用来判定是否早于系统的节流点（实测约 3s） */
  atUptimeMs: number;
}

/** 幂等：已在 AboveNormal 及以上就不动。任何失败都不抛——绝不能挡住插件加载。 */
export function raiseOwnPriority(): PriorityRaise {
  const atUptimeMs = Math.round(process.uptime() * 1000);
  const before = readPriority();
  if (before === null) return { before, after: before, raised: false, atUptimeMs };
  // Node 的约定：数值越小优先级越高（AboveNormal = -7，Normal = 0）
  if (before <= constants.priority.PRIORITY_ABOVE_NORMAL) return { before, after: before, raised: false, atUptimeMs };
  try {
    setPriority(0, constants.priority.PRIORITY_ABOVE_NORMAL);
  } catch {}
  const after = readPriority();
  return { before, after, raised: after !== before, atUptimeMs };
}

/** 优先级数值 → 可读名（日志用；未知值原样回显，不猜）。 */
export function priorityName(value: number | null): string {
  switch (value) {
    case constants.priority.PRIORITY_HIGHEST:
      return 'Highest';
    case constants.priority.PRIORITY_HIGH:
      return 'High';
    case constants.priority.PRIORITY_ABOVE_NORMAL:
      return 'AboveNormal';
    case constants.priority.PRIORITY_NORMAL:
      return 'Normal';
    case constants.priority.PRIORITY_BELOW_NORMAL:
      return 'BelowNormal';
    case constants.priority.PRIORITY_LOW:
      return 'Low';
    default:
      return value === null ? '(unavailable)' : String(value);
  }
}

function readPriority(): number | null {
  try {
    return getPriority(0);
  } catch {
    return null;
  }
}
