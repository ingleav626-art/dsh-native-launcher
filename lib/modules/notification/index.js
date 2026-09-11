// src/modules/registry.ts
var CORE_API_VERSION = 2;

// src/modules/notification/manifest.ts
var manifest = {
  // id 取复数，与既有用户配置项 `modules.notifications`（launcher settings schema）保持一致——
  // 改 id 会让老用户的开关失效。目录/包名用单数 notification（拆包后为 dsh-native-notification）。
  id: "notifications",
  apiVersion: CORE_API_VERSION,
  defaultEnabled: true,
  description: "\u4EFB\u52A1\u5B8C\u6210 / \u7B49\u5F85\u4EA4\u4E92\u7684\u901A\u77E5\u51B3\u7B56\uFF0C\u7ECF\u542F\u52A8\u5668\u6295\u9012\u7AEF\u5F39\u6258\u76D8 Toast"
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
  return text.slice(0, maxChars - 1) + "\u2026";
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
    throw new TypeError(`${label} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4`);
  }
  return value;
}
function parseProjectionValue(value) {
  const record = asRecord(value);
  if (record === void 0) throw new TypeError("\u6295\u5F71\u503C\u5FC5\u987B\u662F\u5BF9\u8C61");
  const turn = asFiniteNumber(record.turn);
  if (turn === void 0 || !Number.isInteger(turn) || turn < 0) throw new TypeError("turn \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570");
  if (typeof record.reason !== "string") throw new TypeError("reason \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
  if (typeof record.body !== "string") throw new TypeError("body \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
  return { turn, reason: record.reason, body: record.body, tools: parseStringArray(record.tools, "tools") };
}
function parseProjectionState(value) {
  const record = asRecord(value);
  if (record === void 0) throw new TypeError("\u6295\u5F71\u72B6\u6001\u5FC5\u987B\u662F\u5BF9\u8C61");
  const rawOpen = record.openTurn;
  let openTurn = null;
  if (rawOpen !== null && rawOpen !== void 0) {
    const open = asRecord(rawOpen);
    if (open === void 0) throw new TypeError("openTurn \u5FC5\u987B\u662F\u5BF9\u8C61\u6216 null");
    const turn = asFiniteNumber(open.turn);
    if (turn === void 0 || !Number.isInteger(turn) || turn < 0) throw new TypeError("openTurn.turn \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570");
    if (typeof open.text !== "string") throw new TypeError("openTurn.text \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
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
      return "\u4EFB\u52A1\u5B8C\u6210";
    case "error":
      return "\u4EFB\u52A1\u51FA\u9519";
    case "aborted":
      return "\u4EFB\u52A1\u5DF2\u4E2D\u6B62";
    case "blocked":
      return "\u4EFB\u52A1\u88AB\u963B\u585E";
    case "max-tokens":
      return "\u8FBE\u5230 token \u4E0A\u9650";
  }
}
function pendingTitleFor(kind) {
  switch (kind) {
    case "approval":
      return "\u7B49\u5F85\u4F60\u7684\u6279\u51C6";
    case "question":
      return "\u7B49\u5F85\u4F60\u7684\u56DE\u7B54";
    case "plan-review":
      return "\u7B49\u5F85\u8BA1\u5212\u8BC4\u5BA1";
  }
}
function bodyText(body, emptyBody) {
  const trimmed = body.trim();
  return trimmed === "" ? emptyBody : trimmed;
}

// src/modules/notification/host/notifier.ts
function createNotifier(deps, options = {}) {
  const maxRemembered = options.maxRemembered ?? 500;
  const emptyBody = options.emptyBody ?? "\uFF08\u65E0\u6B63\u6587\uFF09";
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
      deps.logger.fail(`[notify] \u6295\u9012\u5931\u8D25 tag=${notification.tag}\uFF1A${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return {
    deliverCompletion(sessionId, plan) {
      if (!remember(plan.tag, sessionId)) return false;
      send({ title: titleFor(plan.reason), body: bodyText(plan.body, emptyBody), tag: plan.tag });
      deps.logger.info(`[notify] \u5B8C\u6210\u901A\u77E5 reason=${plan.reason} tag=${plan.tag}`);
      return true;
    },
    deliverPending(sessionId, plan) {
      if (!remember(plan.tag, sessionId)) return false;
      send({ title: pendingTitleFor(plan.kind), body: bodyText(plan.body, emptyBody), tag: plan.tag });
      deps.logger.info(`[notify] \u7B49\u5F85\u901A\u77E5 kind=${plan.kind} tag=${plan.tag}`);
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
  return { nextTurn: turn, fresh: prevTurn !== void 0 && turn > prevTurn };
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
        deps.logger.info(`[pending] ${nextKind} \u88AB\u8BBE\u7F6E/\u89C4\u5219\u6291\u5236 (session=${id})`);
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
  id: z.string().default("").description("\u89C4\u5219 id\uFF08\u521B\u5EFA\u65F6\u751F\u6210\uFF0C\u7F16\u8F91\u671F\u95F4\u4E0D\u53D8\uFF09"),
  enabled: z.boolean().default(true).description("\u542F\u7528\u8BE5\u89C4\u5219"),
  mode: z.union([
    z.const("include").description("\u547D\u4E2D\u624D\u901A\u77E5"),
    z.const("exclude").description("\u547D\u4E2D\u5373\u6291\u5236")
  ]).default("include").description("\u89C4\u5219\u6A21\u5F0F"),
  pattern: z.string().default("").description("\u5173\u952E\u5B57\uFF08\u6216\u6B63\u5219\uFF09"),
  isRegex: z.boolean().default(false).description("\u6309\u6B63\u5219\u89E3\u91CA pattern"),
  caseSensitive: z.boolean().default(false).description("\u533A\u5206\u5927\u5C0F\u5199")
});
var NOTIFICATION_SETTINGS_SCHEMA = z.object({
  enabled: z.boolean().default(true).description("\u4EFB\u52A1\u901A\u77E5\u603B\u5F00\u5173"),
  notifyCompleted: z.boolean().default(true).description("\u4EFB\u52A1\u5B8C\u6210\u65F6\u901A\u77E5"),
  notifyError: z.boolean().default(true).description("\u4EFB\u52A1\u51FA\u9519\u65F6\u901A\u77E5"),
  notifyAborted: z.boolean().default(false).description("\u4EFB\u52A1\u4E2D\u6B62\u65F6\u901A\u77E5"),
  notifyBlocked: z.boolean().default(false).description("\u4EFB\u52A1\u88AB\u963B\u585E\u65F6\u901A\u77E5"),
  notifyMaxTokens: z.boolean().default(false).description("\u8FBE\u5230 token \u4E0A\u9650\u65F6\u901A\u77E5"),
  notifyApproval: z.boolean().default(true).description("\u7B49\u5F85\u6279\u51C6\u65F6\u901A\u77E5"),
  notifyQuestion: z.boolean().default(true).description("\u7B49\u5F85\u56DE\u7B54\u65F6\u901A\u77E5"),
  notifyPlanReview: z.boolean().default(false).description("\u7B49\u5F85\u8BA1\u5212\u8BC4\u5BA1\u65F6\u901A\u77E5"),
  rules: z.array(RULE_SCHEMA).default([]).description("\u5173\u952E\u5B57\u89C4\u5219\uFF1A\u547D\u4E2D\u6807\u9898\u3001\u56DE\u590D\u6B63\u6587\u6216\u5DE5\u5177\u540D"),
  requireInteraction: z.boolean().default(false).description("\u901A\u77E5\u5E38\u9A7B\u76F4\u5230\u624B\u52A8\u5904\u7406\uFF08\u4FDD\u7559\u5B57\u6BB5\uFF0C\u5BF9\u9F50\u4E0A\u6E38\u8BBE\u7F6E\u9762\uFF09"),
  backgroundOnly: z.boolean().default(true).description("\u4EC5\u5F53 WebUI \u4E0D\u5728\u524D\u53F0\u65F6\u901A\u77E5")
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
  const readProjection = (id) => {
    const session = deps.sessions.get(id);
    if (session === void 0) return void 0;
    return asProjectionValue(deps.projections.snapshot(session, ["notification"]).notification);
  };
  const dropVanished = (liveIds) => {
    for (const id of [...observedTurn.keys()]) {
      if (liveIds.has(id)) continue;
      observedTurn.delete(id);
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
    if (!fresh) return;
    const summary = deps.sessions.get(id);
    const plan = notificationFor(id, summary?.origin ?? session.origin, summary?.title, projection, deps.settings());
    if (plan === null) {
      deps.logger.info(`[watch] turn ${nextTurn} \u88AB\u8BBE\u7F6E/\u89C4\u5219\u6291\u5236 (session=${id}, seq=${seq})`);
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
  return {
    id: manifest.id,
    apiVersion: manifest.apiVersion,
    settingsNamespace: SETTINGS_NAMESPACE,
    start() {
      const scope = createNotificationSettings(deps.settingsScope);
      const readSettings = () => scope.get();
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
        `[notification] \u5DF2\u88C5\u914D\uFF1A\u6295\u5F71 notification + change feed \u8BA2\u9605 + pending \u901A\u9053 (ns=${SETTINGS_NAMESPACE})`
      );
      return () => {
        stopWatch();
        pending = void 0;
      };
    },
    reportPending(raw) {
      if (pending === void 0) return false;
      if (!isPendingReport(raw)) {
        deps.logger.warn("[notification] \u5FFD\u7565\u5F62\u72B6\u975E\u6CD5\u7684 pending \u4E0A\u62A5");
        return false;
      }
      pending.report(raw);
      return true;
    }
  };
}
export {
  createNotificationModule,
  manifest
};
