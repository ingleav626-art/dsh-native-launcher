// 启动器侧的端口适配（P1 通知 v2）。
//
// 职责单一：把**官方 ctx 与本体状态**翻译成模块的窄接口（定义见
// src/modules/notification/host/ports.ts）。这是全项目唯一触碰官方服务形状的地方
// ——官方契约一变，只改本文件；模块侧一行不动。
//
// （P2 本体 TS 化时本文件并入 src/host/io/；届时类型从 unknown 收敛为官方 .d.ts 实证形状。）
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 投递端：`tray-notify.json` 的唯一写者（托盘 Timer 读走即删）。 */
export function createNotifyPort(launcherDir, log, isSuppressed) {
  const file = join(launcherDir, 'tray-notify.json');
  return {
    notify(notification) {
      // 托盘通知开关（trayNotify=false）→ 抑制投递。
      // 模块开关（modules.notifications=false）由容器 gating 处理（模块不加载即无投递），此处只管托盘开关。
      if (typeof isSuppressed === 'function' && isSuppressed()) {
        log(`[notify] suppressed by config (trayNotify=false): ${notification?.tag ?? ''}`);
        return;
      }
      const payload = {
        title: String(notification?.title ?? '任务完成').slice(0, 64),
        body: String(notification?.body ?? '').slice(0, 256),
        ts: Date.now(),
        // 常驻直到手动关闭（上游 requireInteraction 语义）：托盘据此用 scenario="reminder" 呈现
        persistent: notification?.persistent === true,
      };
      writeFileSync(file, JSON.stringify(payload));
      log(`[notify] queued: ${payload.title} (${notification?.tag ?? ''})${payload.persistent ? ' [persistent]' : ''}`);
    },
  };
}

/**
 * 官方会话对象 → 模块的窄身份（`{ id, origin, handle }`）。
 *
 * `origin` 来自 `session.header.origin`（顶层没有这个字段）；`handle` 是真 Session 本体，
 * 供官方 `sessionProjections.snapshot()` 使用——**这一层是唯一的形状翻译点**，
 * 变更流回调与 sessions 端口共用它，保证两条路给模块的身份形状一致。
 */
function toSessionIdentity(session) {
  return { id: String(session?.id ?? ''), origin: session?.header?.origin, handle: session };
}

/** 投影接缝：官方 ctx.sessionProjections 的窄面（register / onChanged / snapshot）。 */
export function createProjectionPort(ctx, log) {
  const seam = ctx?.sessionProjections;
  if (!seam || typeof seam.register !== 'function') {
    throw new Error('sessionProjections 服务不可用（inject 未声明或版本不兼容）');
  }
  return {
    register: definition => seam.register(definition),
    onChanged: listener => {
      if (typeof seam.onChanged !== 'function') {
        // 官方若无变更流：订阅降级为空实现（通知不弹，但本体照跑）
        log('[notification] sessionProjections.onChanged 不可用——变更流未订阅');
        return () => {};
      }
      // 官方回调给的是**真 Session 对象**：先归一化成模块的窄身份（origin 在 header 里，
      // 顶层没有），同时把真对象塞进 handle——模块侧下次拿它读快照/写投影
      return seam.onChanged((session, key, value, seq) => listener(toSessionIdentity(session), key, value, seq));
    },
    snapshot: (session, keys) => {
      if (typeof seam.snapshot !== 'function') return {};
      // 官方 snapshot 要真 Session（内部走 session.snapshotEvents()）：模块只透传 handle，
      // 兼容直接传官方对象的老调用（handle 缺席时原样下传）
      return seam.snapshot(session?.handle ?? session, keys) ?? {};
    },
  };
}

/**
 * 会话端口：官方 ctx.sessions 的窄面。
 * - `origin` 取自 `session.header.origin`（0.1.5-rc.2 实证：SessionHeader.origin?: 'subagent'）
 * - `title` 取自官方内置 `title` 投影（client 硬编码清单中存在的键，实证可达）；
 *   形状兼容 string / { title } 两态，读失败只损失规则匹配面，不影响投递
 *
 * 服务获取用 `ctx.get`：cordis 4 对**未在 inject 里声明**的服务直接抛
 * （"cannot get property \"sessions\" without inject"，2026-09-11 沙箱实测——伪造 ctx 的 E2E 测不出这条）。
 * `sessions` 只用于启动播种与标题回退，轮次通知走投影变更流，缺了它通知照发；
 * 故这里降级处理而不是让它把整个模块（乃至本体）拖下水——铁律 1。
 */
export function createSessionsPort(ctx, log) {
  let store;
  try {
    store = ctx.get('sessions');
  } catch (error) {
    log('[notification] sessions 服务不可达（启动播种跳过，不影响投递）：' + (error?.message ?? error));
    store = undefined;
  }
  const readTitle = session => {
    try {
      const values = ctx?.sessionProjections?.snapshot?.(session, ['title']);
      const raw = values?.title;
      if (typeof raw === 'string') return raw;
      if (raw && typeof raw === 'object' && typeof raw.title === 'string') return raw.title;
    } catch (error) {
      log(`[notification] title 投影读取失败（不影响投递）：${error?.message ?? error}`);
    }
    return undefined;
  };
  // 播种（list）不读 title：避免对每个会话各读一次投影；只在真正要通知时（get）才读
  // handle：真 Session 对象原样带给模块（官方 snapshot 要它），模块只透传不解读
  const toSummary = (session, withTitle) => ({
    ...toSessionIdentity(session),
    ...(withTitle ? { title: readTitle(session) } : {}),
  });
  return {
    list: () => {
      if (typeof store?.list !== 'function') {
        log('[notification] ctx.sessions.list 不可用——启动播种跳过');
        return [];
      }
      return store.list().map(session => toSummary(session, false));
    },
    get: id => {
      if (typeof store?.get !== 'function') return undefined;
      const session = store.get(id);
      return session === undefined || session === null ? undefined : toSummary(session, true);
    },
  };
}

/** 设置作用域工厂：官方 settings.register 的三件套窄面（get / update / watch）。 */
export function createSettingsScopeFactory(ctx, log) {
  return (namespace, schema, base) => {
    if (!ctx?.settings || typeof ctx.settings.register !== 'function') {
      throw new Error('settings 服务不可用');
    }
    const scope = ctx.settings.register(namespace, schema, { base });
    log(`[notification] settings 已注册 ns=${namespace}`);
    return {
      get: () => scope.get(),
      update: patch => scope.update(patch),
      watch: listener => scope.watch(listener),
    };
  };
}

/**
 * 组装全部端口。
 * @param ctx - host cordis 上下文（只在本文件被触摸）。
 * @param options.log/logWarn/logFail - 本体分级日志（logMsg / logWarn / logFail）。
 * @param options.launcherDir - 生成物目录（投递文件所在）。
 * @param options.isNotifySuppressed - 投递抑制判定（trayNotify=false 时为真）。
 */
export function createNotificationPorts(ctx, options) {
  const { launcherDir, log, logWarn, logFail, isNotifySuppressed } = options;
  return {
    logger: { info: log, warn: logWarn ?? log, fail: logFail ?? log },
    notify: createNotifyPort(launcherDir, log, isNotifySuppressed),
    projections: createProjectionPort(ctx, log),
    sessions: createSessionsPort(ctx, log),
    settingsScope: createSettingsScopeFactory(ctx, log),
  };
}
