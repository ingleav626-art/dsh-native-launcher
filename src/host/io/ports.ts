/**
 * 启动器侧的端口适配（P1 通知 v2）——P2-B7b TS 化（自 lib/host-ports.js 迁入，产物路径不变）。
 *
 * 职责单一：把**官方 ctx 与本体状态**翻译成模块的窄接口（定义见
 * src/modules/notification/host/ports.ts）。这是全项目唯一触碰官方服务形状的地方
 * ——官方契约一变，只改本文件；模块侧一行不动。
 *
 * 类型口径：官方值域（会话对象/通知载荷/投影值）在此一律 `any` + 运行时守卫——
 * 本文件是形状翻译点而非业务解读点，P4 收敛为官方 .d.ts 实证形状。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LogFn } from '../types.ts';
import { MAIN_SETTINGS_ENTRY, createFormsScope, getSettingsService, isFormsMechanism, subPathOf } from './settingsScope.ts';

/** 官方 ctx 的最小消费面（本文件专属；字段全可选，值域 any + 运行时校验）。 */
interface OfficialCtxMin {
  get(name: string): any
  on?(name: string, listener: (...args: any[]) => unknown): unknown
  sessionProjections?: {
    register(definition: any): unknown
    onChanged?(listener: (...args: any[]) => unknown): unknown
    snapshot?(session: any, keys: any): unknown
  }
  /** 双机制（0.1.7-rc.1 实证）：旧＝register 返回 scope；新＝SettingsForms（describe/update/replace/configure）。 */
  settings?: {
    register?(namespace: string, schema: any, options: { base?: any }): any
    describe?(options?: { redactSecrets?: boolean }): any[]
    update?(ns: string, patch: object, expectedRevision?: number): Promise<void>
    replace?(ns: string, section: object, expectedRevision?: number): Promise<void>
    configure?(presentation: { auto?: boolean }, owner?: unknown): unknown
    readonly writable?: boolean
  }
}

/** 投递端：`tray-notify.json` 的唯一写者（托盘 Timer 读走即删）。 */
export function createNotifyPort(launcherDir: string, log: LogFn, isSuppressed?: () => boolean) {
  const file = join(launcherDir, 'tray-notify.json');
  return {
    notify(notification: any) {
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
function toSessionIdentity(session: any) {
  return { id: String(session?.id ?? ''), origin: session?.header?.origin, handle: session };
}

/** 投影接缝：官方 ctx.sessionProjections 的窄面（register / onChanged / snapshot）。 */
export function createProjectionPort(ctx: OfficialCtxMin, log: LogFn) {
  const seam = ctx?.sessionProjections;
  if (!seam || typeof seam.register !== 'function') {
    throw new Error('sessionProjections 服务不可用（inject 未声明或版本不兼容）');
  }
  return {
    register: (definition: any) => seam.register(definition),
    onChanged: (listener: (...args: any[]) => unknown) => {
      if (typeof seam.onChanged !== 'function') {
        // 官方若无变更流：订阅降级为空实现（通知不弹，但本体照跑）
        log('[notification] sessionProjections.onChanged 不可用——变更流未订阅');
        return () => {};
      }
      // 官方回调给的是**真 Session 对象**：先归一化成模块的窄身份（origin 在 header 里，
      // 顶层没有），同时把真对象塞进 handle——模块侧下次拿它读快照/写投影
      return seam.onChanged((session, key, value, seq) => listener(toSessionIdentity(session), key, value, seq));
    },
    snapshot: (session: any, keys: any) => {
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
export function createSessionsPort(ctx: OfficialCtxMin, log: LogFn) {
  let store: any;
  try {
    store = ctx.get('sessions');
  } catch (error) {
    log('[notification] sessions 服务不可达（启动播种跳过，不影响投递）：' + (error instanceof Error ? error.message : String(error)));
    store = undefined;
  }
  const readTitle = (session: any) => {
    try {
      const values: any = ctx?.sessionProjections?.snapshot?.(session, ['title']);
      const raw = values?.title;
      if (typeof raw === 'string') return raw;
      if (raw && typeof raw === 'object' && typeof raw.title === 'string') return raw.title;
    } catch (error) {
      log(`[notification] title 投影读取失败（不影响投递）：${error instanceof Error ? error.message : String(error)}`);
    }
    return undefined;
  };
  // 播种（list）不读 title：避免对每个会话各读一次投影；只在真正要通知时（get）才读
  // handle：真 Session 对象原样带给模块（官方 snapshot 要它），模块只透传不解读
  const toSummary = (session: any, withTitle: boolean) => ({
    ...toSessionIdentity(session),
    ...(withTitle ? { title: readTitle(session) } : {}),
  });
  return {
    list: () => {
      if (typeof store?.list !== 'function') {
        log('[notification] ctx.sessions.list 不可用——启动播种跳过');
        return [];
      }
      return store.list().map((session: any) => toSummary(session, false));
    },
    get: (id: string) => {
      if (typeof store?.get !== 'function') return undefined;
      const session = store.get(id);
      return session === undefined || session === null ? undefined : toSummary(session, true);
    },
  };
}

/**
 * 设置作用域工厂：官方 settings 的消费侧窄面（get / update / watch），双机制自适应。
 *
 * - 旧（≤0.1.6）：`settings.register(ns, schema, { base })` 直接注册；
 * - 新（0.1.7+）：官方只认 profile entry，模块自有的 ns（如 `dsh-native-notification`）
 *   映射到主 entry 的子段（见 settingsScope.SETTINGS_SUBPATH），读写经 describe/update。
 *
 * 未登记的 ns 在新机制下无对应条目 → 抛错，由模块容器隔离（铁律 1，不拖垮本体）。
 */
export function createSettingsScopeFactory(ctx: OfficialCtxMin, log: LogFn) {
  return (namespace: string, schema: any, base: any) => {
    const settings = getSettingsService(ctx);
    if (!settings) {
      throw new Error('settings 服务不可用');
    }
    if (isFormsMechanism(settings)) {
      const subPath = subPathOf(namespace);
      if (!subPath) {
        throw new Error(`settings ns "${namespace}" 在 0.1.7+ 无对应 profile entry`);
      }
      const scope = createFormsScope<any>({
        settings,
        ctx,
        ns: MAIN_SETTINGS_ENTRY,
        base,
        subPath,
        log,
      });
      log(`[notification] settings 已挂载（forms 机制）ns=${namespace} → entry=${MAIN_SETTINGS_ENTRY} 子段=[${subPath.join('.')}]`);
      return {
        get: () => scope.get(),
        update: (patch: any) => scope.update(patch),
        watch: (listener: (...args: any[]) => unknown) => scope.watch(listener as (next: any, prev: any) => void),
      };
    }
    if (typeof settings.register !== 'function') {
      throw new Error('settings 服务不可用');
    }
    const scope = settings.register(namespace, schema, { base });
    log(`[notification] settings 已注册 ns=${namespace}`);
    return {
      get: () => scope.get(),
      update: (patch: any) => scope.update(patch),
      watch: (listener: (...args: any[]) => unknown) => scope.watch(listener),
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
export function createNotificationPorts(ctx: OfficialCtxMin, options: {
  launcherDir: string
  log: LogFn
  logWarn?: LogFn
  logFail?: LogFn
  isNotifySuppressed?: () => boolean
}) {
  const { launcherDir, log, logWarn, logFail, isNotifySuppressed } = options;
  return {
    logger: { info: log, warn: logWarn ?? log, fail: logFail ?? log },
    notify: createNotifyPort(launcherDir, log, isNotifySuppressed),
    projections: createProjectionPort(ctx, log),
    sessions: createSessionsPort(ctx, log),
    settingsScope: createSettingsScopeFactory(ctx, log),
  };
}
