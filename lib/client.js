if (typeof window !== 'undefined' && typeof window.__ModuleLoader__ !== 'undefined') {
window.__ModuleLoader__.load({
  id: 'dsh-native-launcher',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/log.ts
var reported = /* @__PURE__ */ new Set();
var sender;
function configureClientLog(next) {
  sender = next;
}
function clientLog(kind, data = {}) {
  const key = kind + "|" + String(data.message ?? JSON.stringify(data));
  if (reported.has(key)) return;
  reported.add(key);
  const payload = { kind, t: Date.now(), ...data };
  try {
    sender?.(payload);
  } catch {
  }
}
function clientInfo(message) {
  clientLog("info", { message });
}
function clientWarn(message) {
  clientLog("warn", { message });
}

// src/client/beacon.ts
function startBeacon() {
  try {
    let cid = "";
    try {
      cid = window.localStorage.getItem("dsh-native-launcher.clientId") || "";
    } catch (error) {
      clientWarn("clientId 读取失败（localStorage 不可用）：" + String(error));
    }
    if (!cid) {
      cid = "c-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      try {
        window.localStorage.setItem("dsh-native-launcher.clientId", cid);
      } catch (error) {
        clientWarn("clientId 持久化失败（localStorage 不可用）：" + String(error));
      }
    }
    const base = window.location.origin;
    const report = function(path) {
      try {
        fetch(base + path + "?client=" + encodeURIComponent(cid), { keepalive: true }).catch(function() {
        });
      } catch (error) {
        clientWarn("online/offline 上报不可用：" + String(error));
      }
    };
    report("/native-launcher/online");
    window.addEventListener("pagehide", function() {
      report("/native-launcher/offline");
    });
    document.addEventListener("visibilitychange", function() {
      if (!document.hidden) report("/native-launcher/online");
    });
  } catch (error) {
    clientWarn("在线心跳启动失败：" + String(error));
  }
}

// src/client/types.ts
var RPC_PATH = "/native-launcher";

// src/client/icon.ts
function injectIcon(ctx) {
  const rpc = ctx.connection?.rpc;
  if (rpc === void 0) return;
  try {
    rpc.call(RPC_PATH, "icon.get", {}).then(function(result) {
      if (!result || !result.ok) return;
      const value = result.value;
      if (!value || !value.dataUrl) return;
      const head = document.head;
      if (!head) return;
      var links = head.querySelectorAll('link[rel~="icon"], link[rel~="shortcut"]');
      for (var i = 0; i < links.length; i++) links[i].remove();
      const iconLink = document.createElement("link");
      iconLink.rel = "icon";
      iconLink.type = "image/png";
      iconLink.href = value.dataUrl;
      head.appendChild(iconLink);
      var existing = head.querySelectorAll('link[rel~="manifest"]');
      for (var i = 0; i < existing.length; i++) existing[i].remove();
      const manifestLink = document.createElement("link");
      manifestLink.rel = "manifest";
      manifestLink.href = "/native-launcher/manifest.webmanifest";
      head.appendChild(manifestLink);
    }).catch(function(error) {
      clientWarn("icon.get 失败：" + String(error));
    });
  } catch (error) {
    clientWarn("favicon/manifest 注入失败：" + String(error));
  }
}

// src/client/install-prompt.ts
function startInstallPrompt() {
  try {
    let removeCard2 = function() {
      if (promptState.card && promptState.card.parentNode) promptState.card.parentNode.removeChild(promptState.card);
      promptState.card = null;
      promptState.shown = false;
    }, showCard2 = function() {
      if (promptState.shown || !promptState.deferred || !document.body) return;
      promptState.shown = true;
      const overlay = document.createElement("div");
      overlay.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)");
      overlay.addEventListener("click", function(e) {
        if (e.target === overlay) removeCard2();
      });
      const card = document.createElement("div");
      card.setAttribute(
        "style",
        "display:flex;flex-direction:column;gap:16px;padding:24px;border-radius:14px;background:#ffffff;color:#1a1a1a;box-shadow:0 12px 48px rgba(0,0,0,.35);font:14px/1.5 system-ui,sans-serif;width:340px;max-width:calc(100vw - 48px);border:1px solid #e0e0e0"
      );
      const top = document.createElement("div");
      top.setAttribute("style", "display:flex;align-items:center;gap:12px");
      const img = document.createElement("img");
      img.src = "/native-launcher/icon.png";
      img.alt = "";
      img.setAttribute("style", "width:44px;height:44px;border-radius:10px;flex:none;background:#f0f0f0");
      const titles = document.createElement("div");
      titles.setAttribute("style", "display:flex;flex-direction:column;gap:2px;min-width:0");
      const title = document.createElement("div");
      title.textContent = "安装 DSH WebUI";
      title.setAttribute("style", "font-size:15px;font-weight:600;color:#1a1a1a");
      const sub = document.createElement("div");
      sub.textContent = "安装为桌面应用：独立窗口、任务栏图标、可固定到任务栏。";
      sub.setAttribute("style", "font-size:12px;color:#666");
      titles.appendChild(title);
      titles.appendChild(sub);
      top.appendChild(img);
      top.appendChild(titles);
      const row = document.createElement("div");
      row.setAttribute("style", "display:flex;gap:10px;justify-content:flex-end;align-items:center");
      const later = document.createElement("button");
      later.textContent = "稍后";
      later.setAttribute("style", "background:none;border:1px solid #ccc;border-radius:8px;color:#444;cursor:pointer;font:inherit;padding:7px 16px");
      later.addEventListener("click", removeCard2);
      const install = document.createElement("button");
      install.textContent = "安装";
      install.setAttribute(
        "style",
        "background:#4c8dff;color:#fff;border:none;border-radius:8px;cursor:pointer;font:inherit;font-weight:600;padding:7px 22px"
      );
      const hint = document.createElement("div");
      hint.textContent = "如果未弹出安装窗口（浏览器限制），请用 Edge 菜单 ⋯ → 更多工具 → 应用 → 将此站点安装为应用。";
      hint.setAttribute("style", "display:none;font-size:12px;color:#8a5a00;background:#fff7e0;border:1px solid #f0d9a0;border-radius:8px;padding:8px 10px;line-height:1.5");
      install.addEventListener("click", function() {
        const promptEvent = promptState.deferred;
        if (!promptEvent) return;
        promptState.deferred = null;
        let settled = false;
        const timer = setTimeout(function() {
          if (settled) return;
          settled = true;
          hint.style.display = "block";
        }, 2500);
        promptEvent.prompt();
        promptEvent.userChoice.then(function() {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            removeCard2();
          }
        }).catch(function() {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            removeCard2();
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
    };
    var removeCard = removeCard2, showCard = showCard2;
    const promptState = { deferred: null, shown: false, card: null };
    window.addEventListener("beforeinstallprompt", function(event) {
      event.preventDefault();
      promptState.deferred = event;
      showCard2();
    });
    window.addEventListener("appinstalled", removeCard2);
  } catch (error) {
    clientWarn("安装引导启动失败：" + String(error));
  }
}

// src/modules/registry.ts
var CORE_API_VERSION = 2;
function acceptsManifest(manifest2, coreVersion = CORE_API_VERSION) {
  return manifest2.apiVersion === coreVersion;
}

// src/modules/notification/manifest.ts
var manifest = {
  // id 取复数，与既有用户配置项 `modules.notifications`（launcher settings schema）保持一致——
  // 改 id 会让老用户的开关失效。目录/包名用单数 notification（拆包后为 dsh-native-notification）。
  id: "notifications",
  apiVersion: CORE_API_VERSION,
  defaultEnabled: true,
  description: "任务完成 / 等待交互的通知决策，经启动器投递端弹托盘 Toast"
};

// src/modules/notification/client/card.ts
var import_react = require("react");

// src/modules/notification/shared/rules.ts
function mintRuleId() {
  return crypto.randomUUID();
}
function emptyRule() {
  return { id: mintRuleId(), enabled: true, mode: "include", pattern: "", isRegex: false, caseSensitive: false };
}
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
function patchRule(rules, id, patch) {
  return rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule);
}
function removeRule(rules, id) {
  return rules.filter((rule) => rule.id !== id);
}

// src/modules/notification/client/copy.ts
var COPY = {
  "settings.title": "任务完成通知",
  "settings.subtitle": "当 dsh 完成一次任务时，通过系统托盘通知提醒你；可以用关键词规则精确控制哪些消息需要提醒。",
  "settings.enabled": "启用通知",
  "settings.enabledDesc": "关闭后不会弹出任何通知，规则与偏好设置仍会保留。",
  "settings.when.title": "通知时机",
  "settings.when.subtitle": "选择哪些结束状态触发通知。",
  "settings.when.completed": "正常完成",
  "settings.when.error": "出错",
  "settings.when.aborted": "被中止",
  "settings.when.blocked": "被阻塞",
  "settings.when.maxTokens": "达到 Token 上限",
  "settings.pending.title": "等待确认",
  "settings.pending.subtitle": "当 dsh 等待你审批、回答问题或评审计划时提醒。",
  "settings.pending.approval": "等待审批",
  "settings.pending.question": "等待回答问题",
  "settings.pending.planReview": "等待计划评审",
  "settings.rules.title": "关键词规则",
  "settings.rules.subtitle": "规则匹配该轮回复文本与调用过的工具名。包含规则：命中任一才通知；排除规则：命中即不通知。",
  "settings.rules.empty": "暂无规则，所有已启用的完成状态都会通知。",
  "settings.rules.add": "添加规则",
  "settings.rules.save": "保存规则",
  "settings.rules.mode.include": "包含",
  "settings.rules.mode.exclude": "排除",
  "settings.rules.patternPlaceholder": "关键词或正则表达式",
  "settings.rules.regex": "正则",
  "settings.rules.case": "区分大小写",
  "settings.rules.remove": "删除规则",
  "settings.rules.invalid": "规则模式不能为空",
  "settings.rules.invalidRegex": "无效的正则表达式",
  "settings.rules.unsaved": "规则有未保存的修改",
  "settings.rules.saveHint": "先填写规则模式，再点保存",
  "settings.test.title": "测试通知",
  "settings.test.desc": "点一下发一条真实的托盘通知：能弹出来，就说明「模块 → 投递端 → 托盘 → 系统」整条链路已打通。",
  "settings.test.send": "发送测试通知",
  "settings.test.sending": "发送中…",
  "settings.test.sent": "已交到托盘。若没看到：先确认托盘图标在（重启 dsh 会自动拉起），再检查系统「专注/勿扰」与上方「任务托盘通知」开关；细节见 logs 里的 [notify] 行。",
  "settings.test.failed": "投递失败：host 拒绝了这次请求（通知模块未启用？）——细节见 logs 里的 [notification] / [notify] 行。",
  "settings.advanced.title": "高级",
  "settings.advanced.requireInteraction": "需要手动关闭",
  "settings.advanced.requireInteractionDesc": "通知保持显示，直到你手动关闭（适合重要任务）。",
  "settings.advanced.backgroundOnly": "仅在任务不在眼前时通知",
  "settings.advanced.backgroundOnlyDesc": "当前会话正在眼前时不提醒；页面在后台，或你正在查看其他会话、其他工作区时仍会提醒。",
  "settings.loading": "载入通知设置…",
  "settings.loadFailed": "通知设置读取失败",
  "settings.moduleUnavailable": "通知模块未启用（请在上方「WebUI 启动器」卡片里开启「启用通知模块」）",
  "settings.saveFailed": "保存失败：host 拒绝了这次写入（规则非法或设置服务不可用）"
};

// src/modules/notification/client/card.ts
var OUTCOMES = [
  { field: "notifyCompleted", label: COPY["settings.when.completed"] },
  { field: "notifyError", label: COPY["settings.when.error"] },
  { field: "notifyAborted", label: COPY["settings.when.aborted"] },
  { field: "notifyBlocked", label: COPY["settings.when.blocked"] },
  { field: "notifyMaxTokens", label: COPY["settings.when.maxTokens"] }
];
var PENDING = [
  { field: "notifyApproval", label: COPY["settings.pending.approval"] },
  { field: "notifyQuestion", label: COPY["settings.pending.question"] },
  { field: "notifyPlanReview", label: COPY["settings.pending.planReview"] }
];
var CARD_BOOLEAN_FIELDS = [
  "enabled",
  ...OUTCOMES.map((entry) => entry.field),
  ...PENDING.map((entry) => entry.field),
  "requireInteraction",
  "backgroundOnly"
];
function notifyPatch(field, checked) {
  return { [field]: checked };
}
function Toggle(props) {
  return (0, import_react.createElement)(
    "label",
    { className: "dsh_notification_toggleRow" },
    (0, import_react.createElement)("input", {
      type: "checkbox",
      className: "dsh_notification_checkbox",
      defaultChecked: props.defaultChecked,
      onChange: (event) => {
        props.onChange(event.target.checked);
      }
    }),
    (0, import_react.createElement)(
      "span",
      { className: "dsh_notification_toggleText" },
      (0, import_react.createElement)("span", { className: "dsh_notification_toggleLabel" }, props.label),
      props.desc === void 0 ? null : (0, import_react.createElement)("span", { className: "dsh_notification_toggleDesc" }, props.desc)
    )
  );
}
function RuleRow(props) {
  const rule = props.rule;
  return (0, import_react.createElement)(
    "div",
    { className: "dsh_notification_ruleRow" },
    (0, import_react.createElement)(
      "select",
      {
        className: "dsh_notification_ruleSelect",
        value: rule.mode,
        "aria-label": COPY["settings.rules.mode.include"],
        onChange: (event) => {
          props.onPatch({ mode: event.target.value === "exclude" ? "exclude" : "include" });
        }
      },
      (0, import_react.createElement)("option", { value: "include" }, COPY["settings.rules.mode.include"]),
      (0, import_react.createElement)("option", { value: "exclude" }, COPY["settings.rules.mode.exclude"])
    ),
    (0, import_react.createElement)("input", {
      type: "text",
      className: "dsh_notification_ruleInput",
      placeholder: COPY["settings.rules.patternPlaceholder"],
      value: rule.pattern,
      autoFocus: props.autoFocus,
      onChange: (event) => {
        props.onPatch({ pattern: event.target.value });
      }
    }),
    (0, import_react.createElement)(
      "label",
      { className: "dsh_notification_ruleCheck" },
      (0, import_react.createElement)("input", {
        type: "checkbox",
        checked: rule.isRegex,
        onChange: (event) => {
          props.onPatch({ isRegex: event.target.checked });
        }
      }),
      COPY["settings.rules.regex"]
    ),
    (0, import_react.createElement)(
      "label",
      { className: "dsh_notification_ruleCheck" },
      (0, import_react.createElement)("input", {
        type: "checkbox",
        checked: rule.caseSensitive,
        onChange: (event) => {
          props.onPatch({ caseSensitive: event.target.checked });
        }
      }),
      COPY["settings.rules.case"]
    ),
    (0, import_react.createElement)(
      "button",
      {
        type: "button",
        className: "dsh_notification_ruleDelete",
        "aria-label": COPY["settings.rules.remove"],
        onClick: props.onRemove
      },
      (0, import_react.createElement)(
        "svg",
        { viewBox: "0 0 16 16", "aria-hidden": "true" },
        (0, import_react.createElement)("path", {
          fill: "currentColor",
          d: "M4.2 3.5h7.6l-.7 9.2a1 1 0 0 1-1 .8H5.9a1 1 0 0 1-1-.8l-.7-9.2Zm.9 1 .6 8h4.6l.6-8H5.1ZM6 1h4v1H6V1Zm-3 2h10v1H3V3Z",
          fillRule: "evenodd"
        })
      )
    ),
    props.errorKey === void 0 ? null : (0, import_react.createElement)("span", { className: "dsh_notification_error" }, COPY[props.errorKey])
  );
}
function heading() {
  return (0, import_react.createElement)(
    "div",
    { className: "dsh_notification_heading" },
    (0, import_react.createElement)("h2", { id: "dsh-notification-settings-title", className: "dsh_notification_title" }, COPY["settings.title"]),
    (0, import_react.createElement)("p", { className: "dsh_notification_subtitle" }, COPY["settings.subtitle"])
  );
}
function cardEl(title, desc, ...body) {
  return (0, import_react.createElement)(
    "div",
    { className: "dsh_notification_card" },
    title === null ? null : (0, import_react.createElement)(
      "div",
      null,
      (0, import_react.createElement)("div", { className: "dsh_notification_cardTitle" }, title),
      desc === null ? null : (0, import_react.createElement)("div", { className: "dsh_notification_cardDesc" }, desc)
    ),
    ...body
  );
}
function NotificationCard(props) {
  const face = props.face;
  const [settings, setSettings] = (0, import_react.useState)(null);
  const [loadError, setLoadError] = (0, import_react.useState)(null);
  const [draft, setDraft] = (0, import_react.useState)(null);
  const [focusedRuleId, setFocusedRuleId] = (0, import_react.useState)(null);
  const [notice, setNotice] = (0, import_react.useState)(null);
  const [testState, setTestState] = (0, import_react.useState)("idle");
  const sendTest = () => {
    setTestState("sending");
    face.test.send().then((ok) => {
      setTestState(ok ? "sent" : "failed");
    }).catch((error2) => {
      face.logger.warn(`[card] 测试通知请求失败：${String(error2)}`);
      setTestState("failed");
    });
  };
  const load = () => {
    face.settings.get().then((next) => {
      if (next === void 0) {
        face.logger.warn("[card] 通知模块不可用：设置读取被拒（modules.notifications=false 或未就绪）");
        setLoadError(COPY["settings.moduleUnavailable"]);
        return;
      }
      face.logger.info("[card] 通知设置已载入（卡片渲染成功）");
      setLoadError(null);
      setSettings(next);
    }).catch((error2) => {
      face.logger.warn(`[card] 设置读取失败：${String(error2)}`);
      setLoadError(`${COPY["settings.loadFailed"]}：${String(error2)}`);
    });
  };
  (0, import_react.useEffect)(() => {
    load();
  }, []);
  const apply2 = (patch) => {
    setSettings((prev) => prev === null ? prev : { ...prev, ...patch });
    setNotice(null);
    face.settings.set(patch).then((accepted) => {
      if (accepted) return;
      face.logger.warn("[card] 开关写入被 host 拒绝（设置服务不可用）");
      setNotice(COPY["settings.saveFailed"]);
      load();
    }).catch((error2) => {
      setNotice(`${COPY["settings.saveFailed"]}：${String(error2)}`);
      load();
    });
  };
  const durable = settings?.rules ?? [];
  const rules = draft ?? durable;
  const dirty = draft !== null;
  const error = firstRuleError(rules);
  const edit = (updater) => {
    setDraft(updater(draft ?? durable));
  };
  const addRule = () => {
    const rule = emptyRule();
    edit((list) => [...list, rule]);
    setFocusedRuleId(rule.id);
  };
  const saveRules = () => {
    if (draft === null) return;
    setNotice(null);
    face.settings.set({ rules: draft }).then((accepted) => {
      if (accepted) {
        setDraft(null);
        setFocusedRuleId(null);
        return;
      }
      face.logger.warn("[card] 规则写入被 host 拒绝（规则非法或设置服务不可用）");
      setNotice(COPY["settings.saveFailed"]);
    }).catch((error0) => {
      setNotice(`${COPY["settings.saveFailed"]}：${String(error0)}`);
    });
  };
  if (settings === null) {
    return (0, import_react.createElement)(
      "section",
      { className: "dsh_notification_section" },
      heading(),
      cardEl(
        null,
        null,
        (0, import_react.createElement)(
          "div",
          { className: loadError === null ? "dsh_notification_empty" : "dsh_notification_error" },
          loadError ?? COPY["settings.loading"]
        )
      )
    );
  }
  return (0, import_react.createElement)(
    "section",
    { className: "dsh_notification_section", "aria-labelledby": "dsh-notification-settings-title" },
    heading(),
    cardEl(
      null,
      null,
      (0, import_react.createElement)(Toggle, {
        defaultChecked: settings.enabled,
        label: COPY["settings.enabled"],
        desc: COPY["settings.enabledDesc"],
        onChange: (checked) => {
          apply2({ enabled: checked });
        }
      })
    ),
    // 测试通知（旧卡片有，重写时误删后按用户要求加回）：一键验证投递链路，排错第一站
    cardEl(
      COPY["settings.test.title"],
      COPY["settings.test.desc"],
      (0, import_react.createElement)(
        "div",
        { className: "dsh_notification_rulesFooter" },
        (0, import_react.createElement)(
          "button",
          {
            type: "button",
            className: "dsh_notification_button dsh_notification_buttonPrimary",
            disabled: testState === "sending",
            onClick: sendTest
          },
          testState === "sending" ? COPY["settings.test.sending"] : COPY["settings.test.send"]
        ),
        testState === "sent" ? (0, import_react.createElement)("span", { className: "dsh_notification_hint" }, COPY["settings.test.sent"]) : testState === "failed" ? (0, import_react.createElement)("span", { className: "dsh_notification_error" }, COPY["settings.test.failed"]) : null
      )
    ),
    cardEl(
      COPY["settings.pending.title"],
      COPY["settings.pending.subtitle"],
      (0, import_react.createElement)(
        "div",
        { className: "dsh_notification_grid" },
        PENDING.map((entry) => (0, import_react.createElement)(Toggle, {
          key: entry.field,
          defaultChecked: settings[entry.field],
          label: entry.label,
          onChange: (checked) => {
            apply2(notifyPatch(entry.field, checked));
          }
        }))
      )
    ),
    cardEl(
      COPY["settings.when.title"],
      COPY["settings.when.subtitle"],
      (0, import_react.createElement)(
        "div",
        { className: "dsh_notification_grid" },
        OUTCOMES.map((entry) => (0, import_react.createElement)(Toggle, {
          key: entry.field,
          defaultChecked: settings[entry.field],
          label: entry.label,
          onChange: (checked) => {
            apply2(notifyPatch(entry.field, checked));
          }
        }))
      )
    ),
    cardEl(
      COPY["settings.rules.title"],
      COPY["settings.rules.subtitle"],
      rules.length === 0 ? (0, import_react.createElement)("div", { className: "dsh_notification_empty" }, COPY["settings.rules.empty"]) : (0, import_react.createElement)(
        "div",
        { className: "dsh_notification_rules" },
        rules.map((rule, index) => (0, import_react.createElement)(RuleRow, {
          key: rule.id,
          rule,
          autoFocus: rule.id === focusedRuleId,
          errorKey: error !== void 0 && error.index === index ? error.key : void 0,
          onPatch: (patch) => {
            edit((list) => patchRule(list, rule.id, patch));
          },
          onRemove: () => {
            edit((list) => removeRule(list, rule.id));
          }
        }))
      ),
      (0, import_react.createElement)(
        "div",
        { className: "dsh_notification_rulesFooter" },
        (0, import_react.createElement)(
          "button",
          {
            type: "button",
            className: "dsh_notification_button dsh_notification_buttonGhost",
            onClick: addRule
          },
          COPY["settings.rules.add"]
        ),
        (0, import_react.createElement)(
          "button",
          {
            type: "button",
            className: "dsh_notification_button dsh_notification_buttonPrimary",
            disabled: !dirty || error !== void 0,
            title: !dirty || error !== void 0 ? error !== void 0 ? COPY[error.key] : COPY["settings.rules.saveHint"] : void 0,
            onClick: saveRules
          },
          COPY["settings.rules.save"]
        ),
        error !== void 0 ? (0, import_react.createElement)("span", { className: "dsh_notification_error" }, COPY[error.key]) : dirty ? (0, import_react.createElement)("span", { className: "dsh_notification_unsavedHint" }, COPY["settings.rules.unsaved"]) : null
      )
    ),
    cardEl(
      COPY["settings.advanced.title"],
      null,
      (0, import_react.createElement)(Toggle, {
        defaultChecked: settings.requireInteraction,
        label: COPY["settings.advanced.requireInteraction"],
        desc: COPY["settings.advanced.requireInteractionDesc"],
        onChange: (checked) => {
          apply2({ requireInteraction: checked });
        }
      }),
      (0, import_react.createElement)(Toggle, {
        defaultChecked: settings.backgroundOnly,
        label: COPY["settings.advanced.backgroundOnly"],
        desc: COPY["settings.advanced.backgroundOnlyDesc"],
        onChange: (checked) => {
          apply2({ backgroundOnly: checked });
        }
      })
    ),
    notice === null ? null : (0, import_react.createElement)("p", { className: "dsh_notification_error" }, notice)
  );
}

// src/modules/notification/client/pendingReporter.ts
function createPendingReporter(deps) {
  const observed = /* @__PURE__ */ new Map();
  let stopped = false;
  let announced = false;
  const scan = (items) => {
    if (stopped) return;
    const live = /* @__PURE__ */ new Set();
    let reported2 = 0;
    for (const item of items) {
      live.add(item.sessionId);
      if (observed.has(item.sessionId) && observed.get(item.sessionId) === item.kind) continue;
      observed.set(item.sessionId, item.kind);
      reported2 += 1;
      deps.report.report(item);
    }
    for (const sessionId of [...observed.keys()]) {
      if (!live.has(sessionId)) observed.delete(sessionId);
    }
    if (!announced) {
      announced = true;
      deps.logger.info(`[pending] 传感器已启动：首扫 ${items.length} 个会话、播种上报 ${reported2} 次`);
    }
  };
  return {
    start() {
      try {
        deps.feed.subscribe(scan);
      } catch (error) {
        deps.logger.warn(`[pending] 等待态订阅失败（等待类通知将不弹）：${String(error)}`);
      }
      return () => {
        stopped = true;
      };
    }
  };
}

// src/modules/notification/client/styles.ts
var STYLE_ID = "dsh-native-notification-style";
var cssText = `
.dsh_notification_section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.dsh_notification_heading {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dsh_notification_title {
  margin: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
}
.dsh_notification_subtitle {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}
.dsh_notification_card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}
.dsh_notification_cardTitle {
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
}
.dsh_notification_cardDesc {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}
.dsh_notification_grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 20px;
  min-width: 0;
}
.dsh_notification_toggleRow {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  cursor: pointer;
}
.dsh_notification_checkbox {
  flex: none;
  width: 16px;
  height: 16px;
  margin: 3px 0 0;
  accent-color: var(--dsw-alias-brand-primary);
  cursor: pointer;
}
.dsh_notification_toggleText {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.dsh_notification_toggleLabel {
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
}
.dsh_notification_toggleDesc {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}
.dsh_notification_button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 14px;
  border-radius: 14px;
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  cursor: pointer;
}
.dsh_notification_buttonPrimary {
  border: 0;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-inverted);
}
.dsh_notification_buttonPrimary:hover {
  background: var(--dsw-alias-button-primary-hover);
}
.dsh_notification_buttonPrimary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dsh_notification_buttonGhost {
  border: 1px solid var(--dsw-alias-border-l2);
  background: none;
  color: var(--dsw-alias-label-primary);
}
.dsh_notification_buttonGhost:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh_notification_rules {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.dsh_notification_ruleRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
}
.dsh_notification_ruleSelect {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.dsh_notification_ruleInput {
  flex: 1;
  min-width: 160px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}
.dsh_notification_ruleInput:focus {
  outline: none;
  border-color: var(--dsw-alias-brand-primary);
}
.dsh_notification_ruleCheck {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 18px;
  cursor: pointer;
}
.dsh_notification_ruleCheck input {
  margin: 0;
  accent-color: var(--dsw-alias-brand-primary);
  cursor: pointer;
}
.dsh_notification_ruleDelete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 14px;
  background: none;
  color: var(--dsw-alias-label-dimmed);
  cursor: pointer;
}
.dsh_notification_ruleDelete:hover {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}
.dsh_notification_ruleDelete svg {
  width: 14px;
  height: 14px;
}
.dsh_notification_error {
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}
.dsh_notification_hint {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.dsh_notification_empty {
  color: var(--dsw-alias-label-tertiary);
  font-size: 13px;
  line-height: 20px;
}
.dsh_notification_unsavedHint {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
.dsh_notification_rulesFooter {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
`;
function adoptStyles() {
  try {
    if (document.getElementById(STYLE_ID) !== null) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = cssText;
    document.head.appendChild(style);
  } catch {
  }
}

// src/modules/notification/client/index.ts
var SECTION_ID = "native-notification";
var SECTION_ORDER = 31;
var SECTION_LABEL = "任务通知";
function createNotificationClient(face) {
  return {
    id: manifest.id,
    apiVersion: manifest.apiVersion,
    start() {
      adoptStyles();
      face.section.register({
        id: SECTION_ID,
        order: SECTION_ORDER,
        label: SECTION_LABEL,
        component: NotificationCard,
        inject: () => ({ face })
      });
      const stopReporter = createPendingReporter({
        feed: face.pendingFeed,
        report: face.pendingReport,
        logger: face.logger
      }).start();
      face.logger.info("[notification] client 半区已装配：设置卡片 + pending 传感器");
      return () => {
        stopReporter();
      };
    }
  };
}

// src/client/slots.ts
function registerSettingsSection(ctx, spec, component) {
  try {
    const slots = ctx.slots;
    if (slots === void 0) {
      clientWarn(`[settings] 槽位服务不可用：卡片 ${spec.id} 未注册`);
      return;
    }
    if (typeof slots.inject === "function") {
      const label = spec.label;
      slots.inject("settings.section", function* () {
        yield slots.register(
          { name: "settings.section", id: spec.id, order: spec.order, label: () => label, inject: spec.inject },
          component
        );
      });
      return;
    }
    slots.register(
      { name: "settings.section", id: spec.id, order: spec.order, label: spec.label, inject: spec.inject },
      component
    );
  } catch (error) {
    clientWarn(`[settings] 卡片 ${spec.id} 注册失败（仅该卡片不可见）：${String(error)}`);
  }
}

// src/client/module-faces.ts
function asPendingKind(value) {
  return value === "approval" || value === "question" || value === "plan-review" ? value : void 0;
}
function asRecord(value) {
  return typeof value === "object" && value !== null ? value : void 0;
}
function asNotificationSettings(value) {
  const record = asRecord(value);
  if (record === void 0) return void 0;
  const booleans = [
    "enabled",
    "notifyCompleted",
    "notifyError",
    "notifyAborted",
    "notifyBlocked",
    "notifyMaxTokens",
    "notifyApproval",
    "notifyQuestion",
    "notifyPlanReview",
    "requireInteraction",
    "backgroundOnly"
  ];
  for (const key of booleans) {
    if (typeof record[key] !== "boolean") return void 0;
  }
  if (!Array.isArray(record.rules)) return void 0;
  return record;
}
async function readNotificationSettings(rpc) {
  const result = await rpc.call(RPC_PATH, "notification.get", {});
  if (result === void 0 || result.ok !== true) return void 0;
  return asNotificationSettings(result.value);
}
function createPendingFeed(ctx) {
  const sessions = ctx.get("sessions");
  const uiSession = ctx.get("uiSession");
  const listStore = sessions?.list;
  const pendingStore = uiSession?.pendingInteractions;
  const readItems = () => {
    const state = listStore?.getSnapshot();
    if (state === void 0 || state === null) return [];
    const interactions = pendingStore?.getSnapshot();
    const items = [];
    for (const id of state.ids) {
      const summary = state.byId[id];
      if (summary === void 0 || summary === null) continue;
      items.push({
        sessionId: id,
        kind: asPendingKind(summary.pendingInteraction) ?? asPendingKind(interactions?.get(id)?.kind),
        title: summary.displayTitle ?? summary.title,
        origin: summary.origin
      });
    }
    return items;
  };
  return {
    subscribe(listener) {
      const emit = () => {
        try {
          listener(readItems());
        } catch (error) {
          clientWarn(`[pending] 快照处理失败（本次跳过）：${String(error)}`);
        }
      };
      if (listStore !== void 0 && typeof listStore.subscribe === "function") listStore.subscribe(emit);
      if (pendingStore !== void 0 && typeof pendingStore.subscribe === "function") pendingStore.subscribe(emit);
      emit();
    }
  };
}
function createNotificationFace(ctx) {
  const rpc = ctx.connection?.rpc;
  const logger = { info: clientInfo, warn: clientWarn };
  return {
    settings: {
      get: async () => rpc === void 0 ? void 0 : readNotificationSettings(rpc),
      set: async (patch) => {
        if (rpc === void 0) return false;
        const result = await rpc.call(RPC_PATH, "notification.set", { patch });
        return result !== void 0 && result.ok === true;
      }
    },
    section: {
      register: (section) => {
        registerSettingsSection(
          ctx,
          { id: section.id, order: section.order, label: section.label, inject: section.inject },
          section.component
        );
      }
    },
    pendingFeed: createPendingFeed(ctx),
    test: {
      send: async () => {
        if (rpc === void 0) return false;
        const result = await rpc.call(RPC_PATH, "notification.test", {});
        return result !== void 0 && result.ok === true;
      }
    },
    pendingReport: {
      report: (observation) => {
        if (rpc === void 0) return;
        try {
          void rpc.call(RPC_PATH, "pending-report", observation).catch((error) => {
            clientWarn(`[pending] 上报失败（host 未收到本次等待态）：${String(error)}`);
          });
        } catch (error) {
          clientWarn(`[pending] 上报抛出：${String(error)}`);
        }
      }
    },
    logger
  };
}

// src/client/modules.ts
var BUILTIN_CLIENT_MODULES = [
  {
    manifest,
    create: (ctx) => createNotificationClient(createNotificationFace(ctx))
  }
];
function applyClientModules(ctx) {
  for (const mod of BUILTIN_CLIENT_MODULES) {
    if (!acceptsManifest(mod.manifest)) {
      clientWarn(
        `[modules] ${mod.manifest.id}: apiVersion ${mod.manifest.apiVersion} 与容器 v${CORE_API_VERSION} 不匹配，拒载`
      );
      continue;
    }
    try {
      mod.create(ctx).start();
      clientInfo(`[modules] ${mod.manifest.id}: client 半区已装配 (core=v${CORE_API_VERSION})`);
    } catch (error) {
      clientWarn(`[modules] ${mod.manifest.id}: client 半区装配失败，仅禁用该模块：${String(error)}`);
    }
  }
}

// src/client/presence.ts
function readPresence(ctx) {
  let visible = false;
  try {
    visible = document.hidden !== true && document.hasFocus() === true;
  } catch {
    visible = false;
  }
  let activeSessionId;
  try {
    const sessions = ctx.get("sessions");
    const current = sessions?.list?.getSnapshot()?.current;
    if (typeof current === "string" && current !== "") activeSessionId = current;
  } catch (error) {
    clientWarn(`[presence] 读取当前会话失败（仅影响 backgroundOnly 判定）：${String(error)}`);
  }
  return activeSessionId === void 0 ? { visible } : { visible, activeSessionId };
}
function startPresenceReporter(ctx, report) {
  let lastKey = "";
  const emit = () => {
    const state = readPresence(ctx);
    const key = `${state.visible}|${state.activeSessionId ?? ""}`;
    if (key === lastKey) return;
    lastKey = key;
    report(state);
  };
  try {
    emit();
    window.addEventListener("focus", emit);
    window.addEventListener("blur", emit);
    document.addEventListener("visibilitychange", emit);
    const sessions = ctx.get("sessions");
    if (sessions?.list !== void 0 && typeof sessions.list.subscribe === "function") {
      sessions.list.subscribe(emit);
    }
  } catch (error) {
    clientWarn(`[presence] 传感器启动失败（backgroundOnly 将退化为"总是通知"）：${String(error)}`);
  }
}
function createPresenceSender(rpc) {
  return (state) => {
    try {
      void rpc.call(RPC_PATH, "presence-report", state).catch(() => {
      });
    } catch {
    }
  };
}

// src/client/section.ts
var import_react2 = require("react");

// src/client/uninstall.ts
function showUninstallConfirm(onConfirm) {
  const overlay = document.createElement("div");
  overlay.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)");
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) overlay.parentNode.removeChild(overlay);
  });
  const card = document.createElement("div");
  card.setAttribute("style", "display:flex;flex-direction:column;gap:14px;padding:24px;border-radius:14px;background:#ffffff;color:#1a1a1a;box-shadow:0 12px 48px rgba(0,0,0,.35);font:14px/1.5 system-ui,sans-serif;width:400px;max-width:calc(100vw - 48px);border:1px solid #e0e0e0");
  const top = document.createElement("div");
  top.setAttribute("style", "display:flex;align-items:center;gap:12px");
  const img = document.createElement("img");
  img.src = "/native-launcher/icon.png";
  img.alt = "";
  img.setAttribute("style", "width:44px;height:44px;border-radius:10px;flex:none;background:#f0f0f0");
  const titles = document.createElement("div");
  titles.setAttribute("style", "display:flex;flex-direction:column;gap:2px;min-width:0");
  const title = document.createElement("div");
  title.textContent = "卸载 WebUI 启动器";
  title.setAttribute("style", "font-size:15px;font-weight:600;color:#1a1a1a");
  const sub = document.createElement("div");
  sub.textContent = "此操作将移除启动器的全部组件，且不可撤销。";
  sub.setAttribute("style", "font-size:12px;color:#666");
  titles.appendChild(title);
  titles.appendChild(sub);
  top.appendChild(img);
  top.appendChild(titles);
  const list = document.createElement("ul");
  list.setAttribute("style", "margin:0;padding-left:18px;font-size:13px;line-height:1.7;color:#333");
  ["停止系统托盘与 dsh 后端服务（约 6 秒后自动停止）", "删除桌面快捷方式", "清理全部生成文件与通知注册表项", "从 dsh profile 移除本插件条目"].forEach(function(t) {
    const li = document.createElement("li");
    li.textContent = t;
    list.appendChild(li);
  });
  function checkRow(text) {
    const row = document.createElement("label");
    row.setAttribute("style", "display:flex;align-items:center;gap:8px;font-size:13px;color:#1a1a1a;cursor:pointer");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = false;
    cb.style.accentColor = "#e5484d";
    row.appendChild(cb);
    row.appendChild(document.createTextNode(text));
    row._cb = cb;
    return row;
  }
  const rowStop = checkRow("立即停止 dsh 服务（推荐，否则本次进程继续运行）");
  const rowClear = checkRow("同时清除保存的全部个性化配置（重装后回到默认值）");
  const rowBtn = document.createElement("div");
  rowBtn.setAttribute("style", "display:flex;gap:10px;justify-content:flex-end");
  const cancel = document.createElement("button");
  cancel.textContent = "取消";
  cancel.setAttribute("style", "background:none;border:1px solid #ccc;border-radius:8px;color:#444;cursor:pointer;font:inherit;padding:7px 16px");
  cancel.addEventListener("click", function() {
    overlay.parentNode.removeChild(overlay);
  });
  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "确认卸载";
  confirmBtn.setAttribute("style", "background:#e5484d;color:#fff;border:none;border-radius:8px;cursor:pointer;font:inherit;font-weight:600;padding:7px 22px");
  confirmBtn.addEventListener("click", function() {
    const stop = rowStop._cb.checked, clear = rowClear._cb.checked;
    overlay.parentNode.removeChild(overlay);
    onConfirm({ stopAfter: stop, clearSettings: clear });
  });
  rowBtn.appendChild(cancel);
  rowBtn.appendChild(confirmBtn);
  card.appendChild(top);
  card.appendChild(list);
  card.appendChild(rowStop);
  card.appendChild(rowClear);
  card.appendChild(rowBtn);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// src/client/section.ts
function resultMessage(result) {
  const value = result.value;
  if (!value || typeof value !== "object") return void 0;
  const message = value.message;
  return typeof message === "string" ? message : void 0;
}
function failText(error) {
  const message = error && typeof error === "object" ? error.message : void 0;
  return String(message ? message : error);
}
function LauncherSection(props) {
  const rpc = props.rpc;
  const form = (0, import_react2.useState)(null);
  const setForm = form[1];
  const meta = (0, import_react2.useState)({ loading: true, error: null, shortcutExists: false, settingsAvailable: false });
  const setMeta = meta[1];
  const saving = (0, import_react2.useState)(false);
  const setSaving = saving[1];
  const notice = (0, import_react2.useState)(null);
  const setNotice = notice[1];
  const uninstallBusy = (0, import_react2.useState)(false);
  const setUninstallBusy = uninstallBusy[1];
  const uninstallResult = (0, import_react2.useState)(null);
  const setUninstallResult = uninstallResult[1];
  (0, import_react2.useEffect)(() => {
    let alive = true;
    rpc.call(RPC_PATH, "config.get", {}).then((result) => {
      if (!alive) return;
      if (result && result.ok) {
        const v = result.value;
        setForm({
          launchCommand: String(v.launchCommand || ""),
          shortcutName: String(v.shortcutName || ""),
          port: Number(v.port) || 3080,
          autoOpen: v.autoOpen !== false,
          openMode: v.openMode || "app",
          tray: v.tray !== false,
          traySurvivesDsh: v.traySurvivesDsh !== false,
          trayNotify: v.trayNotify !== false,
          closeToExit: v.closeToExit !== false,
          closeToExitDebounceSeconds: Number(v.closeToExitDebounceSeconds) || 20,
          closeToExitFinalConfirmSeconds: Number(v.closeToExitFinalConfirmSeconds) || 2,
          force: v.force === true,
          modulesNotifications: !(v.modules && v.modules.notifications === false)
        });
        setMeta({ loading: false, error: null, shortcutExists: !!v.shortcutExists, settingsAvailable: v.settingsAvailable !== false });
      } else {
        setMeta({ loading: false, error: result && result.error && result.error.message || "config.get failed", shortcutExists: false, settingsAvailable: false });
      }
    }).catch((error) => {
      if (alive) setMeta({ loading: false, error: failText(error), shortcutExists: false, settingsAvailable: false });
    });
    return () => {
      alive = false;
    };
  }, [rpc]);
  function setValue(key, value) {
    setForm((prev) => Object.assign({}, prev, { [key]: value }));
  }
  function save() {
    if (!form[0]) return;
    setSaving(true);
    setNotice(null);
    const f = form[0];
    rpc.call(RPC_PATH, "config.set", { values: {
      launchCommand: f.launchCommand,
      shortcutName: f.shortcutName,
      port: f.port,
      autoOpen: f.autoOpen,
      openMode: f.openMode,
      tray: f.tray,
      traySurvivesDsh: f.traySurvivesDsh,
      trayNotify: f.trayNotify,
      closeToExit: f.closeToExit,
      closeToExitDebounceSeconds: f.closeToExitDebounceSeconds,
      closeToExitFinalConfirmSeconds: f.closeToExitFinalConfirmSeconds,
      force: f.force,
      modules: { notifications: f.modulesNotifications }
    } }).then((result) => {
      setSaving(false);
      if (result && result.ok) setNotice({ kind: "ok", text: resultMessage(result) || "saved" });
      else setNotice({ kind: "err", text: result && result.error && result.error.message || "save failed" });
    }).catch((error) => {
      setSaving(false);
      setNotice({ kind: "err", text: failText(error) });
    });
  }
  function uninstall(opts) {
    setUninstallBusy(true);
    setUninstallResult(null);
    rpc.call(RPC_PATH, "launcher.uninstall", { clearSettings: !!(opts && opts.clearSettings), stopAfter: !(opts && opts.stopAfter === false) }).then((result) => {
      setUninstallBusy(false);
      if (result && result.ok) setUninstallResult(result.value || { steps: [], manual: [] });
      else setNotice({ kind: "err", text: result && result.error && result.error.message || "uninstall failed" });
    }).catch((error) => {
      setUninstallBusy(false);
      setNotice({ kind: "err", text: failText(error) });
    });
  }
  const inputStyle = {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid var(--dsw-alias-border-l2)",
    background: "var(--dsw-alias-interactive-bg-hover)",
    color: "var(--dsw-alias-label-primary)",
    fontSize: 13,
    width: 260
  };
  function groupEl(titleText) {
    return (0, import_react2.createElement)("div", { style: { marginTop: 14, marginBottom: 2, fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", color: "var(--dsw-alias-label-tertiary)", textTransform: "uppercase" } }, titleText);
  }
  function rowEl(label, desc, control) {
    return (0, import_react2.createElement)("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "7px 0" } }, [
      (0, import_react2.createElement)("div", { key: "l", style: { flex: "1 1 auto" } }, [
        (0, import_react2.createElement)("div", { key: "a", style: { fontSize: 13.5, color: "var(--dsw-alias-label-primary)" } }, label),
        desc ? (0, import_react2.createElement)("div", { key: "b", style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", marginTop: 1 } }, desc) : null
      ]),
      (0, import_react2.createElement)("div", { key: "c", style: { flex: "0 0 auto" } }, control)
    ]);
  }
  function toggleEl(key, disabled) {
    return (0, import_react2.createElement)("input", {
      type: "checkbox",
      checked: !!(form[0] && form[0][key]),
      disabled: !!disabled,
      onChange: (e) => setValue(key, e.target.checked),
      style: { width: 16, height: 16, accentColor: "var(--dsw-alias-brand-primary)", cursor: "pointer" }
    });
  }
  function numberEl(key, minValue, maxValue) {
    return (0, import_react2.createElement)("input", {
      type: "number",
      value: form[0] ? form[0][key] : "",
      min: minValue,
      max: maxValue,
      onChange: (e) => setValue(key, Math.max(minValue, Math.floor(Number(e.target.value) || 0))),
      style: Object.assign({}, inputStyle, { width: 90 })
    });
  }
  const title = (0, import_react2.createElement)("h3", { style: { margin: "0 0 12px", fontSize: 16, lineHeight: "24px", fontWeight: 500, color: "var(--dsw-alias-label-primary)" } }, "WebUI 启动器");
  const intro = (0, import_react2.createElement)(
    "p",
    { style: { margin: "0 0 8px", fontSize: 13, lineHeight: "20px", color: "var(--dsw-alias-label-tertiary)" } },
    "桌面快捷方式一键启动 dsh Web UI：静默启动、自动开浏览器、端口探测直连。改动保存后需重启 dsh 完全生效。"
  );
  let content;
  if (meta[0].loading) {
    content = (0, import_react2.createElement)("p", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 13 } }, "加载配置中…");
  } else if (meta[0].error) {
    content = (0, import_react2.createElement)("p", { style: { color: "var(--dsw-alias-state-error-primary)", fontSize: 13 } }, "配置读取失败：" + meta[0].error + "（插件 RPC 未注册？请重启后重试）");
  } else {
    const restartHint = (0, import_react2.createElement)("div", { style: { marginTop: 10, fontSize: 12, color: "var(--dsw-alias-label-tertiary)" } }, "带 * 的项在下次启动时生效；其余即时语义项同样建议重启一次以重建脚本。");
    const saveButton = (0, import_react2.createElement)(
      "button",
      {
        type: "button",
        onClick: save,
        disabled: saving[0],
        style: { marginTop: 14, padding: "8px 18px", borderRadius: 8, border: "none", background: "var(--dsw-alias-brand-primary)", color: "var(--dsw-alias-label-inverted, #fff)", fontSize: 13, fontWeight: 500, cursor: saving[0] ? "default" : "pointer", opacity: saving[0] ? 0.6 : 1 }
      },
      saving[0] ? "保存中…" : "保存设置"
    );
    const openModeSelect = (0, import_react2.createElement)(
      "select",
      {
        value: form[0].openMode,
        onChange: (e) => setValue("openMode", e.target.value),
        style: Object.assign({}, inputStyle, { width: 180 })
      },
      (0, import_react2.createElement)("option", { value: "app" }, "App 独立窗口（推荐）"),
      (0, import_react2.createElement)("option", { value: "new-window" }, "浏览器独立窗口"),
      (0, import_react2.createElement)("option", { value: "default" }, "浏览器默认行为")
    );
    content = (0, import_react2.createElement)(
      "div",
      null,
      groupEl("启动"),
      rowEl(
        "启动命令",
        "桌面快捷方式执行的命令（需 PATH 里有 dsh）*",
        (0, import_react2.createElement)("input", { type: "text", value: form[0].launchCommand, onChange: (e) => setValue("launchCommand", e.target.value), style: inputStyle })
      ),
      rowEl("端口", "WebUI 端口，需与 webserver 配置一致*", numberEl("port", 1, 65535)),
      rowEl("快捷方式名称", "桌面快捷方式的显示名称*", (0, import_react2.createElement)("input", { type: "text", value: form[0].shortcutName, onChange: (e) => setValue("shortcutName", e.target.value), style: Object.assign({}, inputStyle, { width: 180 }) })),
      rowEl("强制覆盖快捷方式", "每次启动都重新生成快捷方式（默认幂等跳过）", toggleEl("force")),
      groupEl("浏览器窗口"),
      rowEl("自动打开浏览器", "快捷方式启动后自动打开 WebUI（PWA 应用窗口优先）", toggleEl("autoOpen")),
      rowEl("打开方式", null, openModeSelect),
      groupEl("托盘与通知"),
      rowEl("系统托盘", "托盘图标：打开 WebUI / 任务通知 / 退出", toggleEl("tray")),
      rowEl("托盘在 dsh 退出后保留", "关 = 托盘随 dsh 一起退出（保存后立即按新模式重启托盘）", toggleEl("traySurvivesDsh")),
      rowEl("任务托盘通知", "任务完成或需要关注时弹系统通知", toggleEl("trayNotify")),
      rowEl("启用通知模块", "WebUI 内的任务通知投影通道（关闭仅影响通知模块本身）", toggleEl("modulesNotifications")),
      groupEl("关闭语义（关窗即退）"),
      rowEl("关窗自动退出", "所有窗口关闭且无任务运行时自动退出服务（仅快捷方式启动生效）", toggleEl("closeToExit")),
      rowEl("退出防抖秒数", "关窗后等待的秒数，期间重开页面会取消退出（最小 5）", numberEl("closeToExitDebounceSeconds", 5, 600)),
      rowEl("二次确认窗口秒数", "退出前的最后确认窗口，防误杀重开请求（最小 1）", numberEl("closeToExitFinalConfirmSeconds", 1, 60)),
      saveButton,
      restartHint
    );
  }
  const logsButton = (0, import_react2.createElement)(
    "button",
    {
      type: "button",
      onClick: () => {
        setNotice(null);
        rpc.call(RPC_PATH, "diagnostics.openLogs", {}).then((result) => {
          const opened = result && result.ok ? result.value?.path : void 0;
          if (result && result.ok) {
            setNotice({ kind: "ok", text: opened ? `已打开日志目录：${opened}（把整个 logs 文件夹发过来即可）` : "已打开日志目录（把整个 logs 文件夹发过来即可）" });
          } else {
            setNotice({ kind: "err", text: result && result.error && result.error.message || "打开日志目录失败" });
          }
        }).catch((error) => setNotice({ kind: "err", text: failText(error) }));
      },
      style: {
        marginTop: 10,
        padding: "8px 16px",
        borderRadius: 8,
        border: "1px solid var(--dsw-alias-border-l2)",
        background: "var(--dsw-alias-interactive-bg-hover)",
        color: "var(--dsw-alias-label-primary)",
        fontSize: 13,
        cursor: "pointer"
      }
    },
    "打开日志目录（排错用）"
  );
  const button = (0, import_react2.createElement)(
    "button",
    {
      type: "button",
      disabled: meta[0].loading,
      onClick: () => {
        setNotice(null);
        rpc.call(RPC_PATH, "shortcut.recreate", {}).then((result) => {
          if (result && result.ok) setNotice({ kind: "ok", text: resultMessage(result) || "shortcut recreated" });
          else setNotice({ kind: "err", text: result && result.error && result.error.message || "recreate failed" });
        }).catch((error) => setNotice({ kind: "err", text: failText(error) }));
      },
      style: {
        marginTop: 18,
        padding: "8px 16px",
        borderRadius: 8,
        border: "1px solid var(--dsw-alias-border-l2)",
        background: "var(--dsw-alias-interactive-bg-hover)",
        color: "var(--dsw-alias-label-primary)",
        fontSize: 13,
        cursor: "pointer"
      }
    },
    "重新生成快捷方式（强制覆盖）"
  );
  const uninstallButton = (0, import_react2.createElement)(
    "button",
    {
      type: "button",
      disabled: uninstallBusy[0],
      onClick: function() {
        showUninstallConfirm(uninstall);
      },
      style: {
        marginTop: 10,
        padding: "8px 16px",
        borderRadius: 8,
        border: "1px solid var(--dsw-alias-state-error-primary)",
        background: "transparent",
        color: "var(--dsw-alias-state-error-primary)",
        fontSize: 13,
        cursor: uninstallBusy[0] ? "default" : "pointer",
        opacity: uninstallBusy[0] ? 0.6 : 1
      }
    },
    uninstallBusy[0] ? "卸载中…" : "一键卸载启动器"
  );
  let uninstallEl = null;
  if (uninstallResult[0]) {
    const ur = uninstallResult[0];
    const stepEls = (ur.steps || []).map((s, i) => (0, import_react2.createElement)("li", { key: i, style: { marginBottom: 2 } }, s));
    const manualEls = (ur.manual || []).map((s, i) => (0, import_react2.createElement)("li", { key: i, style: { marginBottom: 2 } }, s));
    uninstallEl = (0, import_react2.createElement)(
      "div",
      { style: { marginTop: 10, fontSize: 12, lineHeight: "19px", color: "var(--dsw-alias-label-secondary)" } },
      (0, import_react2.createElement)("div", { style: { fontWeight: 500 } }, "已完成："),
      (0, import_react2.createElement)("ul", { style: { margin: "4px 0 8px", paddingLeft: 20 } }, stepEls),
      manualEls.length ? (0, import_react2.createElement)("div", { style: { fontWeight: 500, color: "var(--dsw-alias-state-warning-primary)" } }, "需要你手动完成：") : null,
      manualEls.length ? (0, import_react2.createElement)("ul", { style: { margin: "4px 0 0", paddingLeft: 20 } }, manualEls) : null
    );
  }
  let noticeEl = null;
  if (notice[0]) {
    const color = notice[0].kind === "ok" ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)";
    noticeEl = (0, import_react2.createElement)("p", { style: { marginTop: 10, fontSize: 12, lineHeight: "18px", color } }, notice[0].text);
  }
  return (0, import_react2.createElement)("section", { style: { maxWidth: 720, display: "flex", flexDirection: "column", gap: 4 } }, title, intro, content, button, logsButton, uninstallButton, uninstallEl, noticeEl);
}

// src/client/index.ts
var inject = ["slots", "connection", "sessions", "locale"];
var LAUNCHER_SECTION = { id: "native-launcher", order: 30, label: "WebUI 启动器" };
function rpcLogSender(rpc) {
  return (payload) => {
    try {
      void rpc.call(RPC_PATH, "ntf-log", payload).catch(() => {
      });
    } catch {
    }
  };
}
function directLogSender() {
  return (payload) => {
    try {
      void fetch(`${window.location.origin}${RPC_PATH}/ntf-log`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "client-request",
          rpcId: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          method: "ntf-log",
          payload
        })
      }).catch(() => {
      });
    } catch {
    }
  };
}
function apply(ctx) {
  const rpc = ctx.connection?.rpc;
  configureClientLog(rpc === void 0 ? directLogSender() : rpcLogSender(rpc));
  clientInfo(`[log] client 已启动（inject=${inject.join(",")}，rpc=${rpc === void 0 ? "unavailable->direct" : "ok"}）`);
  startBeacon();
  if (rpc !== void 0) {
    startPresenceReporter(ctx, createPresenceSender(rpc));
  }
  if (rpc === void 0) {
    clientWarn("[settings] connection.rpc 不可用：启动器设置卡片未注册（日志走直连兜底通道）");
  } else {
    registerSettingsSection(ctx, { ...LAUNCHER_SECTION, inject: () => ({ rpc }) }, LauncherSection);
  }
  applyClientModules(ctx);
  injectIcon(ctx);
  startInstallPrompt();
}

    return module.exports;
  },
});
}

