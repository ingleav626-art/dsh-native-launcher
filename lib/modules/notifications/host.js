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

/**
 * 当前 DSH 的 session-projection 注册契约把 host state 与 client view 分开：
 * `stateSchema`/`stateVersion` 用于 host fold/cache，`wire.viewSchema`/`wire.view`
 * 才会进入 snapshot。旧版 dsh-notification 只提供顶层 `schema` + `view`，所以
 * 直接注册后 projection 只在 host 存在，client 会稳定读到 undefined。
 *
 * 这里是适配层，不改 vendor 文件：为旧定义补一个无损 stateSchema（状态本身
 * 只含 JSON 数据），并把旧 view/schema 映射到 wire。对象返回新定义，避免污染
 * vendor 的原始定义或改变其 apply/init/view 算法。
 */
function adaptLegacyProjection(definition, log) {
  if (!definition || typeof definition !== 'object') {
    log('projection register rejected: vendor returned non-object definition');
    return definition;
  }
  const hasWire = definition.wire !== undefined;
  const hasLegacyView = typeof definition.view === 'function' && definition.schema !== undefined;
  if (hasWire || !hasLegacyView) {
    log(`projection definition passthrough: key=${String(definition.key)} wire=${hasWire ? 'yes' : 'no'} legacyView=${hasLegacyView ? 'yes' : 'no'}`);
    return definition;
  }
  // The legacy `schema` validates the wire view (`last`), not this internal
  // checkpoint state. Keep the state contract strict without importing a second
  // schema library into the launcher: the registry only requires `.parse()`.
  const stateSchema = {
    parse(value) {
      const fail = (reason) => {
        throw new Error(`projection ${String(definition.key)} state invalid: ${reason}`);
      };
      if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('expected object');
      const rootKeys = Object.keys(value).sort().join(',');
      if (rootKeys !== 'last,openTurn') fail('expected exactly openTurn and last');
      const openTurn = value.openTurn;
      if (openTurn !== null) {
        if (typeof openTurn !== 'object' || Array.isArray(openTurn)) fail('openTurn expected object or null');
        const openKeys = Object.keys(openTurn).sort().join(',');
        if (openKeys !== 'text,tools,turn') fail('openTurn shape mismatch');
        if (!Number.isSafeInteger(openTurn.turn) || openTurn.turn < 0) fail('openTurn.turn expected non-negative integer');
        if (typeof openTurn.text !== 'string') fail('openTurn.text expected string');
        if (!Array.isArray(openTurn.tools) || openTurn.tools.some((tool) => typeof tool !== 'string')) fail('openTurn.tools expected string[]');
      }
      const last = value.last;
      if (last !== null) {
        try {
          definition.schema.parse(last);
        } catch (error) {
          fail(`last view invalid: ${error?.message ?? error}`);
        }
      }
      return value;
    },
  };
  const adapted = {
    ...definition,
    stateSchema,
    wire: {
      viewSchema: definition.schema,
      view: definition.view,
    },
  };
  log(`projection adapted: key=${String(definition.key)} legacySchema=yes stateSchema=strict-internal wire=yes`);
  return adapted;
}

export function apply(ctx, core) {
  // 上游签名：apply(ctx, { maxBodyChars })——翻译我们的 core 为上游选项。
  // 用 extend 只替换本模块看到的 sessionProjections 服务，生命周期与原 fiber
  // 保持一致；ctx 的其它服务、事件和 effect 均原样继承。
  const log = typeof core?.log === 'function' ? core.log : () => {};
  if (core && typeof core === 'object') core.notificationProjectionRegistered = false;
  const registry = ctx.get('sessionProjections');
  if (!registry || typeof registry.register !== 'function') {
    log('projection adapter skipped: sessionProjections service unavailable');
    return;
  }
  let registrations = 0;
  const adaptedRegistry = Object.create(registry);
  adaptedRegistry.register = (definition) => {
    const adapted = adaptLegacyProjection(definition, log);
    try {
      const dispose = registry.register(adapted);
      registrations += 1;
      if (core && typeof core === 'object') core.notificationProjectionRegistered = true;
      log(`projection register succeeded: key=${String(adapted?.key)} registrations=${registrations}`);
      return dispose;
    } catch (error) {
      log(`projection register failed: key=${String(adapted?.key)} error=${error?.message ?? error}`);
      throw error;
    }
  };
  const adaptedCtx = ctx.extend({ sessionProjections: adaptedRegistry });
  log('projection adapter active: legacy schema/view will be exposed through wire');
  try {
    const result = upstreamApply(adaptedCtx, { maxBodyChars: 400 });
    log(`projection adapter upstream apply returned: registrations=${registrations}`);
    return result;
  } catch (error) {
    log(`projection adapter upstream apply failed: registrations=${registrations} error=${error?.message ?? error}`);
    throw error;
  }
}
