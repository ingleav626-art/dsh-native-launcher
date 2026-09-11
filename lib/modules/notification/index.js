// src/modules/registry.ts
var CORE_API_VERSION = 2;

// src/modules/notification/manifest.ts
var manifest = {
  // id 取复数，与既有用户配置项 `modules.notifications`（launcher settings schema）保持一致——
  // 改 id 会让老用户的开关失效。目录/包名用单数 notification（拆包后为 dsh-native-notification）。
  id: "notifications",
  apiVersion: CORE_API_VERSION,
  defaultEnabled: true,
  description: "任务完成 / 等待交互的通知决策，经启动器投递端弹托盘 Toast"
};

// src/modules/notification/host/fold.ts
var EMPTY_PROJECTION = Object.freeze({
  turn: 0,
  reason: "",
  body: "",
  tools: Object.freeze([])
});
function boundText(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + "…";
}
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function readTurn(event) {
  return asFiniteNumber(asRecord(event.data)?.turn);
}
function accumulateText(content) {
  let text = "";
  for (const block of content) {
    const record = asRecord(block);
    if (record?.type === "text" && typeof record.text === "string") text += record.text;
  }
  return text;
}
function applyProjectionEvent(state, event, maxChars) {
  switch (event.type) {
    case "turn/start": {
      const turn = readTurn(event);
      if (turn === void 0) return state;
      return { ...state, openTurn: { turn, text: "", tools: [] } };
    }
    case "assistant/message": {
      const open = state.openTurn;
      if (open === null) return state;
      const turn = readTurn(event);
      if (turn === void 0 || open.turn !== turn) return state;
      const content = asRecord(asRecord(event.data)?.message)?.content;
      if (!Array.isArray(content)) return state;
      let text = open.text + accumulateText(content);
      if (text.length > maxChars) text = boundText(text, maxChars);
      if (text === open.text) return state;
      return { ...state, openTurn: { ...open, text } };
    }
    case "tool/call": {
      const open = state.openTurn;
      if (open === null) return state;
      const turn = readTurn(event);
      const name = asRecord(event.data)?.name;
      if (turn === void 0 || open.turn !== turn || typeof name !== "string") return state;
      if (open.tools.includes(name)) return state;
      return { ...state, openTurn: { ...open, tools: [...open.tools, name] } };
    }
    case "turn/end": {
      const open = state.openTurn;
      if (open === null) return state;
      const turn = readTurn(event);
      const kind = asRecord(asRecord(event.data)?.reason)?.kind;
      if (turn === void 0 || open.turn !== turn || typeof kind !== "string") return state;
      return {
        openTurn: null,
        last: { turn, reason: kind, body: open.text.trim(), tools: open.tools }
      };
    }
    default:
      return state;
  }
}
function parseStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError(`${label} 必须是字符串数组`);
  }
  return value;
}
function parseProjectionValue(value) {
  const record = asRecord(value);
  if (record === void 0) throw new TypeError("投影值必须是对象");
  const turn = asFiniteNumber(record.turn);
  if (turn === void 0 || !Number.isInteger(turn) || turn < 0) throw new TypeError("turn 必须是非负整数");
  if (typeof record.reason !== "string") throw new TypeError("reason 必须是字符串");
  if (typeof record.body !== "string") throw new TypeError("body 必须是字符串");
  return { turn, reason: record.reason, body: record.body, tools: parseStringArray(record.tools, "tools") };
}
function parseProjectionState(value) {
  const record = asRecord(value);
  if (record === void 0) throw new TypeError("投影状态必须是对象");
  const rawOpen = record.openTurn;
  let openTurn = null;
  if (rawOpen !== null && rawOpen !== void 0) {
    const open = asRecord(rawOpen);
    if (open === void 0) throw new TypeError("openTurn 必须是对象或 null");
    const turn = asFiniteNumber(open.turn);
    if (turn === void 0 || !Number.isInteger(turn) || turn < 0) throw new TypeError("openTurn.turn 必须是非负整数");
    if (typeof open.text !== "string") throw new TypeError("openTurn.text 必须是字符串");
    openTurn = { turn, text: open.text, tools: parseStringArray(open.tools, "openTurn.tools") };
  }
  const rawLast = record.last;
  const last = rawLast === null || rawLast === void 0 ? null : parseProjectionValue(rawLast);
  return { openTurn, last };
}
function notificationProjection(config) {
  return {
    key: "notification",
    stateSchema: { parse: parseProjectionState },
    init: () => ({ openTurn: null, last: null }),
    apply: (state, event) => applyProjectionEvent(state, event, config.maxBodyChars),
    wire: {
      viewSchema: { parse: parseProjectionValue },
      view: (state) => state.last ?? EMPTY_PROJECTION
    },
    stateVersion: 1
  };
}

// src/modules/notification/shared/labels.ts
function notificationTag(sessionId, turn) {
  return `dsh-notification-${sessionId}-${turn}`;
}
function pendingNotificationTag(sessionId, sequence) {
  return `dsh-notification-pending-${sessionId}-${sequence}`;
}
function titleFor(reason) {
  switch (reason) {
    case "completed":
      return "任务完成";
    case "error":
      return "任务出错";
    case "aborted":
      return "任务已中止";
    case "blocked":
      return "任务被阻塞";
    case "max-tokens":
      return "达到 token 上限";
  }
}
function pendingTitleFor(kind) {
  switch (kind) {
    case "approval":
      return "等待你的批准";
    case "question":
      return "等待你的回答";
    case "plan-review":
      return "等待计划评审";
  }
}
function bodyText(body, emptyBody) {
  const trimmed = body.trim();
  return trimmed === "" ? emptyBody : trimmed;
}

// src/modules/notification/host/notifier.ts
function createNotifier(deps, options = {}) {
  const maxRemembered = options.maxRemembered ?? 500;
  const emptyBody = options.emptyBody ?? "（无正文）";
  const remembered = /* @__PURE__ */ new Map();
  const remember = (tag, sessionId) => {
    if (remembered.has(tag)) return false;
    remembered.set(tag, sessionId);
    if (remembered.size > maxRemembered) {
      const oldest = remembered.keys().next();
      if (!oldest.done) remembered.delete(oldest.value);
    }
    return true;
  };
  const send = (notification) => {
    try {
      deps.notify.notify(notification);
    } catch (error) {
      deps.logger.fail(`[notify] 投递失败 tag=${notification.tag}：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return {
    deliverCompletion(sessionId, plan) {
      if (!remember(plan.tag, sessionId)) return false;
      send({ title: titleFor(plan.reason), body: bodyText(plan.body, emptyBody), tag: plan.tag });
      deps.logger.info(`[notify] 完成通知 reason=${plan.reason} tag=${plan.tag}`);
      return true;
    },
    deliverPending(sessionId, plan) {
      if (!remember(plan.tag, sessionId)) return false;
      send({ title: pendingTitleFor(plan.kind), body: bodyText(plan.body, emptyBody), tag: plan.tag });
      deps.logger.info(`[notify] 等待通知 kind=${plan.kind} tag=${plan.tag}`);
      return true;
    },
    forgetSession(sessionId) {
      for (const [tag, owner] of remembered) {
        if (owner === sessionId) remembered.delete(tag);
      }
    },
    rememberedCount() {
      return remembered.size;
    }
  };
}

// src/modules/notification/host/filter.ts
function asReason(reason) {
  switch (reason) {
    case "completed":
    case "error":
    case "aborted":
    case "blocked":
    case "max-tokens":
      return reason;
    default:
      return void 0;
  }
}
function reasonEnabled(settings, reason) {
  switch (reason) {
    case "completed":
      return settings.notifyCompleted;
    case "error":
      return settings.notifyError;
    case "aborted":
      return settings.notifyAborted;
    case "blocked":
      return settings.notifyBlocked;
    case "max-tokens":
      return settings.notifyMaxTokens;
  }
}
function pendingReasonEnabled(settings, kind) {
  switch (kind) {
    case "approval":
      return settings.notifyApproval;
    case "question":
      return settings.notifyQuestion;
    case "plan-review":
      return settings.notifyPlanReview;
  }
}
function ruleSubject(title, body, tools) {
  const parts = [];
  if (title !== void 0 && title.trim() !== "") parts.push(title);
  if (body.trim() !== "") parts.push(body);
  if (tools.length > 0) parts.push(tools.join(" "));
  return parts.join("\n");
}
function ruleMatches(rule, subject) {
  if (rule.isRegex) {
    const flags = rule.caseSensitive ? "" : "i";
    return new RegExp(rule.pattern, flags).test(subject);
  }
  const haystack = rule.caseSensitive ? subject : subject.toLowerCase();
  const needle = rule.caseSensitive ? rule.pattern : rule.pattern.toLowerCase();
  return haystack.includes(needle);
}
function rulesAllow(settings, subject) {
  const active = settings.rules.filter((rule) => rule.enabled);
  const includes = active.filter((rule) => rule.mode === "include");
  const excludes = active.filter((rule) => rule.mode === "exclude");
  if (excludes.some((rule) => ruleMatches(rule, subject))) return false;
  if (includes.length > 0 && !includes.some((rule) => ruleMatches(rule, subject))) return false;
  return true;
}
function shouldNotify(settings, reason, subject) {
  if (!settings.enabled) return false;
  if (!reasonEnabled(settings, reason)) return false;
  return rulesAllow(settings, subject);
}

// src/modules/notification/host/planner.ts
function asPendingKind(value) {
  return value === "approval" || value === "question" || value === "plan-review" ? value : void 0;
}
function notificationFor(sessionId, origin, title, projection, settings) {
  if (origin === "subagent") return null;
  const reason = projection === void 0 || projection.turn === 0 ? "completed" : asReason(projection.reason);
  if (reason === void 0) return null;
  const subject = ruleSubject(title, projection?.body ?? "", projection?.tools ?? []);
  if (!shouldNotify(settings, reason, subject)) return null;
  return {
    reason,
    body: projection?.body ?? title ?? "",
    tag: notificationTag(sessionId, projection?.turn ?? 0)
  };
}
function pendingNotificationFor(sessionId, origin, title, kind, sequence, settings) {
  if (origin === "subagent") return null;
  if (!settings.enabled || !pendingReasonEnabled(settings, kind)) return null;
  if (!rulesAllow(settings, ruleSubject(title, "", []))) return null;
  return { kind, body: title?.trim() ?? "", tag: pendingNotificationTag(sessionId, sequence) };
}

// src/modules/notification/host/signals.ts
function projectionAdvance(prevTurn, projection) {
  const turn = projection?.turn ?? 0;
  if (prevTurn === void 0) return { nextTurn: turn, fresh: turn >= 1 };
  return { nextTurn: turn, fresh: turn > prevTurn };
}
function pendingAdvance(prev, kind) {
  if (prev === void 0) return { kind, fresh: false };
  return { kind, fresh: kind !== void 0 && kind !== prev.kind };
}

// src/modules/notification/host/pending.ts
function isPendingReport(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return typeof record.sessionId === "string" && record.sessionId !== "" && (record.kind === void 0 || typeof record.kind === "string");
}
function createPendingChannel(deps) {
  const observed = /* @__PURE__ */ new Map();
  const sequences = /* @__PURE__ */ new Map();
  return {
    report(report) {
      const id = report.sessionId;
      const { kind: nextKind, fresh } = pendingAdvance(observed.get(id), asPendingKind(report.kind));
      observed.set(id, { kind: nextKind });
      if (!fresh || nextKind === void 0) return;
      const sequence = (sequences.get(id) ?? 0) + 1;
      sequences.set(id, sequence);
      const plan = pendingNotificationFor(id, report.origin, report.title, nextKind, sequence, deps.settings());
      if (plan === null) {
        deps.logger.info(`[pending] ${nextKind} 被设置/规则抑制 (session=${id})`);
        return;
      }
      deps.notifier.deliverPending(id, plan);
    },
    forgetSession(id) {
      observed.delete(id);
      sequences.delete(id);
    }
  };
}

// src/modules/notification/shared/rules.ts
function ruleError(rule) {
  if (rule.pattern.trim() === "") return "settings.rules.invalid";
  if (rule.isRegex) {
    try {
      new RegExp(rule.pattern);
    } catch {
      return "settings.rules.invalidRegex";
    }
  }
  return void 0;
}
function firstRuleError(rules) {
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    if (rule === void 0) continue;
    const key = ruleError(rule);
    if (key !== void 0) return { index, key };
  }
  return void 0;
}

// src/modules/notification/host/settings.ts
import z from "@deepseek-ai/schemastery";
var SETTINGS_NAMESPACE = "dsh-native-notification";
function defaultNotificationSettings() {
  return {
    enabled: true,
    notifyCompleted: true,
    notifyError: true,
    notifyAborted: false,
    notifyBlocked: false,
    notifyMaxTokens: false,
    notifyApproval: true,
    notifyQuestion: true,
    notifyPlanReview: false,
    rules: [],
    requireInteraction: false,
    backgroundOnly: true
  };
}
var RULE_SCHEMA = z.object({
  id: z.string().default("").description("规则 id（创建时生成，编辑期间不变）"),
  enabled: z.boolean().default(true).description("启用该规则"),
  mode: z.union([
    z.const("include").description("命中才通知"),
    z.const("exclude").description("命中即抑制")
  ]).default("include").description("规则模式"),
  pattern: z.string().default("").description("关键字（或正则）"),
  isRegex: z.boolean().default(false).description("按正则解释 pattern"),
  caseSensitive: z.boolean().default(false).description("区分大小写")
});
var NOTIFICATION_SETTINGS_SCHEMA = z.object({
  enabled: z.boolean().default(true).description("任务通知总开关"),
  notifyCompleted: z.boolean().default(true).description("任务完成时通知"),
  notifyError: z.boolean().default(true).description("任务出错时通知"),
  notifyAborted: z.boolean().default(false).description("任务中止时通知"),
  notifyBlocked: z.boolean().default(false).description("任务被阻塞时通知"),
  notifyMaxTokens: z.boolean().default(false).description("达到 token 上限时通知"),
  notifyApproval: z.boolean().default(true).description("等待批准时通知"),
  notifyQuestion: z.boolean().default(true).description("等待回答时通知"),
  notifyPlanReview: z.boolean().default(false).description("等待计划评审时通知"),
  rules: z.array(RULE_SCHEMA).default([]).description("关键字规则：命中标题、回复正文或工具名"),
  requireInteraction: z.boolean().default(false).description("通知常驻直到手动处理（保留字段，对齐上游设置面）"),
  backgroundOnly: z.boolean().default(true).description("仅当 WebUI 不在前台时通知")
});
function createNotificationSettings(factory, base = {}) {
  return factory(SETTINGS_NAMESPACE, NOTIFICATION_SETTINGS_SCHEMA, {
    ...defaultNotificationSettings(),
    ...base
  });
}

// src/modules/notification/host/watch.ts
function asProjectionValue(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  const record = value;
  if (typeof record.turn !== "number" || typeof record.reason !== "string") return void 0;
  if (typeof record.body !== "string" || !Array.isArray(record.tools)) return void 0;
  return {
    turn: record.turn,
    reason: record.reason,
    body: record.body,
    tools: record.tools.filter((item) => typeof item === "string")
  };
}
function createWatcher(deps) {
  const observedTurn = /* @__PURE__ */ new Map();
  const staleLogged = /* @__PURE__ */ new Set();
  const readProjection = (id) => {
    const session = deps.sessions.get(id);
    if (session === void 0) return void 0;
    return asProjectionValue(deps.projections.snapshot(session, ["notification"]).notification);
  };
  const dropVanished = (liveIds) => {
    for (const id of [...observedTurn.keys()]) {
      if (liveIds.has(id)) continue;
      observedTurn.delete(id);
      for (const key of [...staleLogged]) {
        if (key.startsWith(`${id}|`)) staleLogged.delete(key);
      }
      deps.notifier.forgetSession(id);
    }
  };
  const seed = () => {
    const summaries = deps.sessions.list();
    for (const summary of summaries) {
      observedTurn.set(summary.id, projectionAdvance(void 0, readProjection(summary.id)).nextTurn);
    }
    dropVanished(new Set(summaries.map((summary) => summary.id)));
  };
  const onChanged = (session, key, value, seq) => {
    if (key !== "notification") return;
    const id = session.id;
    const projection = asProjectionValue(value);
    const { nextTurn, fresh } = projectionAdvance(observedTurn.get(id), projection);
    observedTurn.set(id, nextTurn);
    if (!fresh) {
      const turn = projection?.turn;
      if (turn !== void 0 && turn >= 1) {
        const staleKey = `${id}|${turn}`;
        if (!staleLogged.has(staleKey)) {
          staleLogged.add(staleKey);
          deps.logger.info(`[watch] turn ${turn} 未推进（重放或已处理），跳过投递 (session=${id}, seq=${seq})`);
        }
      }
      return;
    }
    const summary = deps.sessions.get(id);
    const plan = notificationFor(id, summary?.origin ?? session.origin, summary?.title, projection, deps.settings());
    if (plan === null) {
      deps.logger.info(`[watch] turn ${nextTurn} 被设置/规则抑制 (session=${id}, seq=${seq})`);
      return;
    }
    deps.notifier.deliverCompletion(id, plan);
  };
  return {
    start() {
      seed();
      return deps.projections.onChanged(onChanged);
    }
  };
}

// src/modules/notification/host/index.ts
var DEFAULT_MAX_BODY_CHARS = 400;
function createNotificationModule(deps) {
  const notifier = createNotifier({ notify: deps.notify, logger: deps.logger });
  let pending;
  let scope;
  return {
    id: manifest.id,
    apiVersion: manifest.apiVersion,
    settingsNamespace: SETTINGS_NAMESPACE,
    start() {
      const activeScope = createNotificationSettings(deps.settingsScope);
      scope = activeScope;
      const readSettings = () => activeScope.get();
      deps.projections.register(
        notificationProjection({ maxBodyChars: deps.config?.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS })
      );
      pending = createPendingChannel({ settings: readSettings, notifier, logger: deps.logger });
      const stopWatch = createWatcher({
        projections: deps.projections,
        sessions: deps.sessions,
        settings: readSettings,
        notifier,
        logger: deps.logger
      }).start();
      deps.logger.info(
        `[notification] 已装配：投影 notification + change feed 订阅 + pending 通道 (ns=${SETTINGS_NAMESPACE})`
      );
      return () => {
        stopWatch();
        pending = void 0;
      };
    },
    reportPending(raw) {
      if (pending === void 0) return false;
      if (!isPendingReport(raw)) {
        deps.logger.warn("[notification] 忽略形状非法的 pending 上报");
        return false;
      }
      pending.report(raw);
      return true;
    },
    getSettings() {
      return scope?.get();
    },
    async updateSettings(patch) {
      if (scope === void 0) return false;
      if (Array.isArray(patch.rules)) {
        const invalid = firstRuleError(patch.rules);
        if (invalid !== void 0) {
          deps.logger.warn(`[notification] 拒绝写入：第 ${invalid.index + 1} 条规则非法（${invalid.key}）`);
          return false;
        }
      }
      await scope.update(patch);
      deps.logger.info("[notification] 设置已更新（开关/规则即时生效，无需重启）");
      return true;
    },
    testNotify() {
      try {
        deps.notify.notify({
          title: "任务通知测试",
          body: "看到这条托盘通知，说明「模块 → 投递端 → 托盘 → 系统」整条链路已打通。",
          // tag 唯一：Windows 会静默吞掉短时间内同 tag 的后续通知（本项目血泪之一），
          // 测试通知必须每次都是新 tag，否则连点两次第二次看不到。
          tag: `dsh-notification-test-${Date.now()}`
        });
        deps.logger.info("[notification] 测试通知已交投递端（来源：设置卡片「发送测试通知」）");
        return true;
      } catch (error) {
        deps.logger.fail(`[notification] 测试通知投递失败：${String(error)}`);
        return false;
      }
    }
  };
}
export {
  createNotificationModule,
  manifest
};
