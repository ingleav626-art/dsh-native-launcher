window.__ModuleLoader__.load({ id: 'dsh-notification', factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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

// src/client/SettingsSection.tsx
var import_react = require("react");

// src/client/notifier.ts
function titleKey(reason) {
  switch (reason) {
    case "completed":
      return "notify.titleCompleted";
    case "error":
      return "notify.titleError";
    case "aborted":
      return "notify.titleAborted";
    case "blocked":
      return "notify.titleBlocked";
    case "max-tokens":
      return "notify.titleMaxTokens";
  }
}
function pendingTitleKey(kind) {
  switch (kind) {
    case "approval":
      return "notify.titleApproval";
    case "question":
      return "notify.titleQuestion";
    case "plan-review":
      return "notify.titlePlanReview";
  }
}
function bodyText(body, emptyBody) {
  const trimmed = body.trim();
  return trimmed === "" ? emptyBody : trimmed;
}
function shouldShow(permission, backgroundOnly, documentHidden, completedSessionId, currentSessionId) {
  if (permission !== "granted") return false;
  if (backgroundOnly && !documentHidden && completedSessionId === currentSessionId) return false;
  return true;
}
function notificationTag(sessionId, turn) {
  return `dsh-notification-${sessionId}-${turn}`;
}
function pendingNotificationTag(sessionId, sequence) {
  return `dsh-notification-pending-${sessionId}-${sequence}`;
}
function notificationsApi() {
  return typeof Notification === "undefined" ? void 0 : Notification;
}

// src/client/rules.ts
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
    const key = ruleError(rules[index]);
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

// src/client/SettingsSection.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var OUTCOMES = [
  { field: "notifyCompleted", key: "settings.when.completed", defaultValue: true },
  { field: "notifyError", key: "settings.when.error", defaultValue: true },
  { field: "notifyAborted", key: "settings.when.aborted", defaultValue: false },
  { field: "notifyBlocked", key: "settings.when.blocked", defaultValue: false },
  { field: "notifyMaxTokens", key: "settings.when.maxTokens", defaultValue: false }
];
var PENDING = [
  { field: "notifyApproval", key: "settings.pending.approval", defaultValue: true },
  { field: "notifyQuestion", key: "settings.pending.question", defaultValue: true },
  { field: "notifyPlanReview", key: "settings.pending.planReview", defaultValue: false }
];
function notifyPatch(field, checked) {
  return { [field]: checked };
}
function Toggle(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh_notification_toggleRow", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        type: "checkbox",
        className: "dsh_notification_checkbox",
        defaultChecked: props.defaultChecked,
        onChange: (event) => {
          props.onChange(event.target.checked);
        }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh_notification_toggleText", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh_notification_toggleLabel", children: props.label }),
      props.desc === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh_notification_toggleDesc", children: props.desc })
    ] })
  ] });
}
function RuleRow(props) {
  const { rule, t } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh_notification_ruleRow", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "select",
      {
        className: "dsh_notification_ruleSelect",
        value: rule.mode,
        "aria-label": t("settings.rules.mode.include"),
        onChange: (event) => {
          props.onPatch({ mode: event.target.value === "exclude" ? "exclude" : "include" });
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "include", children: t("settings.rules.mode.include") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "exclude", children: t("settings.rules.mode.exclude") })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        type: "text",
        className: "dsh_notification_ruleInput",
        placeholder: t("settings.rules.patternPlaceholder"),
        value: rule.pattern,
        autoFocus: props.autoFocus,
        onChange: (event) => {
          props.onPatch({ pattern: event.target.value });
        }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh_notification_ruleCheck", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          type: "checkbox",
          checked: rule.isRegex,
          onChange: (event) => {
            props.onPatch({ isRegex: event.target.checked });
          }
        }
      ),
      t("settings.rules.regex")
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh_notification_ruleCheck", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          type: "checkbox",
          checked: rule.caseSensitive,
          onChange: (event) => {
            props.onPatch({ caseSensitive: event.target.checked });
          }
        }
      ),
      t("settings.rules.case")
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: "dsh_notification_ruleDelete",
        "aria-label": t("settings.rules.remove"),
        onClick: props.onRemove,
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { fill: "currentColor", d: "M4.2 3.5h7.6l-.7 9.2a1 1 0 0 1-1 .8H5.9a1 1 0 0 1-1-.8l-.7-9.2Zm.9 1 .6 8h4.6l.6-8H5.1ZM6 1h4v1H6V1Zm-3 2h10v1H3V3Z", fillRule: "evenodd" }) })
      }
    ),
    props.errorKey === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh_notification_error", children: t(props.errorKey) })
  ] });
}
function NotificationSettingsSection({ useSettings, set, requestPermission, sendTest, t }) {
  const settings = useSettings((snapshot) => snapshot);
  const [permission, setPermission] = (0, import_react.useState)(() => notificationsApi()?.permission ?? "denied");
  const [permissionHint, setPermissionHint] = (0, import_react.useState)(null);
  const [draft, setDraft] = (0, import_react.useState)(null);
  const [focusedRuleId, setFocusedRuleId] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    const refresh = () => {
      setPermission(notificationsApi()?.permission ?? "denied");
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
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
    set({ rules: draft });
    setDraft(null);
    setFocusedRuleId(null);
  };
  const onRequestPermission = async () => {
    setPermission(await requestPermission());
    setPermissionHint(null);
  };
  const onClickTest = async () => {
    let current = notificationsApi()?.permission ?? "denied";
    if (current !== "granted") {
      current = await requestPermission();
      setPermission(current);
    }
    if (current !== "granted") {
      setPermissionHint(current === "denied" ? "settings.permission.deniedHint" : "settings.permission.defaultHint");
      return;
    }
    setPermissionHint(null);
    sendTest();
  };
  const permissionText = t(`settings.permission.${permission}`);
  const badgeClass = permission === "granted" ? "dsh_notification_badgeGranted" : permission === "denied" ? "dsh_notification_badgeDenied" : "dsh_notification_badgeDefault";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh_notification_section", "aria-labelledby": "dsh-notification-settings-title", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh_notification_heading", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { id: "dsh-notification-settings-title", className: "dsh_notification_title", children: t("settings.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh_notification_subtitle", children: t("settings.subtitle") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh_notification_card", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      Toggle,
      {
        defaultChecked: settings?.enabled ?? true,
        label: t("settings.enabled"),
        desc: t("settings.enabledDesc"),
        onChange: (checked) => {
          set({ enabled: checked });
        }
      }
    ) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh_notification_card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh_notification_cardTitle", children: t("settings.pending.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh_notification_cardDesc", children: t("settings.pending.subtitle") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh_notification_grid", children: PENDING.map(({ field, key, defaultValue }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Toggle,
        {
          defaultChecked: settings?.[field] ?? defaultValue,
          label: t(key),
          onChange: (checked) => {
            set(notifyPatch(field, checked));
          }
        },
        field
      )) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh_notification_card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh_notification_cardTitle", children: t("settings.permission.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh_notification_cardDesc", children: t("settings.permission.desc") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh_notification_permissionRow", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: `dsh_notification_badge ${badgeClass}`, children: permissionText }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh_notification_button dsh_notification_buttonGhost", onClick: () => {
          void onRequestPermission();
        }, children: t("settings.permission.request") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: "dsh_notification_button dsh_notification_buttonPrimary",
            onClick: () => {
              void onClickTest();
            },
            children: t("settings.permission.test")
          }
        )
      ] }),
      permissionHint === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh_notification_error", children: t(permissionHint) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh_notification_card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh_notification_cardTitle", children: t("settings.when.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh_notification_cardDesc", children: t("settings.when.subtitle") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh_notification_grid", children: OUTCOMES.map(({ field, key, defaultValue }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Toggle,
        {
          defaultChecked: settings?.[field] ?? defaultValue,
          label: t(key),
          onChange: (checked) => {
            set(notifyPatch(field, checked));
          }
        },
        field
      )) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh_notification_card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh_notification_cardTitle", children: t("settings.rules.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh_notification_cardDesc", children: t("settings.rules.subtitle") })
      ] }),
      rules.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh_notification_empty", children: t("settings.rules.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh_notification_rules", children: rules.map((rule, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        RuleRow,
        {
          rule,
          t,
          autoFocus: rule.id === focusedRuleId,
          errorKey: error !== void 0 && error.index === index ? error.key : void 0,
          onPatch: (patch) => {
            edit((list) => patchRule(list, rule.id, patch));
          },
          onRemove: () => {
            edit((list) => removeRule(list, rule.id));
          }
        },
        rule.id
      )) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh_notification_rulesFooter", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh_notification_button dsh_notification_buttonGhost", onClick: addRule, children: t("settings.rules.add") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: "dsh_notification_button dsh_notification_buttonPrimary",
            disabled: !dirty || error !== void 0,
            title: !dirty || error !== void 0 ? error !== void 0 ? t(error.key) : t("settings.rules.saveHint") : void 0,
            onClick: saveRules,
            children: t("settings.rules.save")
          }
        ),
        error !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh_notification_error", children: t(error.key) }) : dirty ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh_notification_unsavedHint", children: t("settings.rules.unsaved") }) : null
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh_notification_card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh_notification_cardTitle", children: t("settings.advanced.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Toggle,
        {
          defaultChecked: settings?.requireInteraction ?? false,
          label: t("settings.advanced.requireInteraction"),
          desc: t("settings.advanced.requireInteractionDesc"),
          onChange: (checked) => {
            set({ requireInteraction: checked });
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Toggle,
        {
          defaultChecked: settings?.backgroundOnly ?? true,
          label: t("settings.advanced.backgroundOnly"),
          desc: t("settings.advanced.backgroundOnlyDesc"),
          onChange: (checked) => {
            set({ backgroundOnly: checked });
          }
        }
      )
    ] })
  ] });
}

// src/client/locales.ts
var zh = {
  "nav": "\u901A\u77E5",
  "settings.title": "\u4EFB\u52A1\u5B8C\u6210\u901A\u77E5",
  "settings.subtitle": "\u5F53 DSH \u5B8C\u6210\u4E00\u6B21\u64CD\u4F5C\u65F6\uFF0C\u901A\u8FC7\u6D4F\u89C8\u5668\u7CFB\u7EDF\u901A\u77E5\u63D0\u9192\u4F60\uFF1B\u53EF\u4EE5\u7528\u5173\u952E\u8BCD\u89C4\u5219\u7CBE\u786E\u63A7\u5236\u54EA\u4E9B\u6D88\u606F\u9700\u8981\u63D0\u9192\u3002",
  "settings.enabled": "\u542F\u7528\u901A\u77E5",
  "settings.enabledDesc": "\u5173\u95ED\u540E\u4E0D\u4F1A\u5F39\u51FA\u4EFB\u4F55\u901A\u77E5\uFF0C\u89C4\u5219\u4E0E\u504F\u597D\u8BBE\u7F6E\u4ECD\u4F1A\u4FDD\u7559\u3002",
  "settings.permission.title": "\u6D4F\u89C8\u5668\u6743\u9650",
  "settings.permission.desc": "\u901A\u77E5\u9700\u8981\u6D4F\u89C8\u5668\u6388\u6743\u3002\u70B9\u51FB\u4E0B\u65B9\u6309\u94AE\u6388\u6743\uFF0C\u7136\u540E\u53D1\u9001\u4E00\u6761\u6D4B\u8BD5\u901A\u77E5\u786E\u8BA4\u751F\u6548\u3002",
  "settings.permission.granted": "\u5DF2\u6388\u6743",
  "settings.permission.denied": "\u5DF2\u62D2\u7EDD\uFF08\u8BF7\u5728\u6D4F\u89C8\u5668\u5730\u5740\u680F\u7684\u7AD9\u70B9\u8BBE\u7F6E\u4E2D\u91CD\u65B0\u5F00\u542F\uFF09",
  "settings.permission.default": "\u672A\u6388\u6743",
  "settings.permission.defaultHint": "\u901A\u77E5\u6743\u9650\u5C1A\u672A\u6388\u4E88\uFF1A\u8BF7\u5148\u70B9\u51FB\u300C\u8BF7\u6C42\u901A\u77E5\u6743\u9650\u300D\uFF0C\u5E76\u5728\u6D4F\u89C8\u5668\u5F39\u51FA\u7684\u63D0\u793A\u4E2D\u9009\u62E9\u5141\u8BB8\u3002",
  "settings.permission.deniedHint": "\u901A\u77E5\u6743\u9650\u5DF2\u88AB\u62D2\u7EDD\uFF1A\u8BF7\u5728\u6D4F\u89C8\u5668\u5730\u5740\u680F\u5DE6\u4FA7\u7684\u7AD9\u70B9\u8BBE\u7F6E\u4E2D\u91CD\u65B0\u5F00\u542F\u901A\u77E5\uFF0C\u7136\u540E\u518D\u8BD5\u3002",
  "settings.permission.request": "\u8BF7\u6C42\u901A\u77E5\u6743\u9650",
  "settings.permission.test": "\u53D1\u9001\u6D4B\u8BD5\u901A\u77E5",
  "settings.when.title": "\u901A\u77E5\u65F6\u673A",
  "settings.when.subtitle": "\u9009\u62E9\u54EA\u4E9B\u7ED3\u675F\u72B6\u6001\u89E6\u53D1\u901A\u77E5\u3002",
  "settings.when.completed": "\u6B63\u5E38\u5B8C\u6210",
  "settings.when.error": "\u51FA\u9519",
  "settings.when.aborted": "\u88AB\u4E2D\u6B62",
  "settings.when.blocked": "\u88AB\u963B\u585E",
  "settings.when.maxTokens": "\u8FBE\u5230 Token \u4E0A\u9650",
  "settings.pending.title": "\u7B49\u5F85\u786E\u8BA4",
  "settings.pending.subtitle": "\u5F53 DSH \u7B49\u5F85\u4F60\u5BA1\u6279\u3001\u56DE\u7B54\u95EE\u9898\u6216\u8BC4\u5BA1\u8BA1\u5212\u65F6\u63D0\u9192\u3002",
  "settings.pending.approval": "\u7B49\u5F85\u5BA1\u6279",
  "settings.pending.question": "\u7B49\u5F85\u56DE\u7B54\u95EE\u9898",
  "settings.pending.planReview": "\u7B49\u5F85\u8BA1\u5212\u8BC4\u5BA1",
  "settings.rules.title": "\u5173\u952E\u8BCD\u89C4\u5219",
  "settings.rules.subtitle": "\u89C4\u5219\u5339\u914D\u8BE5\u8F6E\u56DE\u590D\u6587\u672C\u4E0E\u8C03\u7528\u8FC7\u7684\u5DE5\u5177\u540D\u3002\u5305\u542B\u89C4\u5219\uFF1A\u547D\u4E2D\u4EFB\u4E00\u624D\u901A\u77E5\uFF1B\u6392\u9664\u89C4\u5219\uFF1A\u547D\u4E2D\u5373\u4E0D\u901A\u77E5\u3002",
  "settings.rules.empty": "\u6682\u65E0\u89C4\u5219\uFF0C\u6240\u6709\u5DF2\u542F\u7528\u7684\u5B8C\u6210\u72B6\u6001\u90FD\u4F1A\u901A\u77E5\u3002",
  "settings.rules.add": "\u6DFB\u52A0\u89C4\u5219",
  "settings.rules.save": "\u4FDD\u5B58\u89C4\u5219",
  "settings.rules.mode.include": "\u5305\u542B",
  "settings.rules.mode.exclude": "\u6392\u9664",
  "settings.rules.patternPlaceholder": "\u5173\u952E\u8BCD\u6216\u6B63\u5219\u8868\u8FBE\u5F0F",
  "settings.rules.regex": "\u6B63\u5219",
  "settings.rules.case": "\u533A\u5206\u5927\u5C0F\u5199",
  "settings.rules.remove": "\u5220\u9664\u89C4\u5219",
  "settings.rules.invalid": "\u89C4\u5219\u6A21\u5F0F\u4E0D\u80FD\u4E3A\u7A7A",
  "settings.rules.invalidRegex": "\u65E0\u6548\u7684\u6B63\u5219\u8868\u8FBE\u5F0F",
  "settings.rules.unsaved": "\u89C4\u5219\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539",
  "settings.rules.saveHint": "\u5148\u586B\u5199\u89C4\u5219\u6A21\u5F0F\uFF0C\u518D\u70B9\u4FDD\u5B58",
  "settings.advanced.title": "\u9AD8\u7EA7",
  "settings.advanced.requireInteraction": "\u9700\u8981\u624B\u52A8\u5173\u95ED",
  "settings.advanced.requireInteractionDesc": "\u901A\u77E5\u4FDD\u6301\u663E\u793A\uFF0C\u76F4\u5230\u4F60\u624B\u52A8\u5173\u95ED\uFF08\u9002\u5408\u91CD\u8981\u4EFB\u52A1\uFF09\u3002",
  "settings.advanced.backgroundOnly": "\u4EC5\u5728\u4EFB\u52A1\u4E0D\u5728\u773C\u524D\u65F6\u901A\u77E5",
  "settings.advanced.backgroundOnlyDesc": "\u5F53\u524D\u4F1A\u8BDD\u6B63\u5728\u773C\u524D\u65F6\u4E0D\u63D0\u9192\uFF1B\u9875\u9762\u5728\u540E\u53F0\uFF0C\u6216\u4F60\u6B63\u5728\u67E5\u770B\u5176\u4ED6\u4F1A\u8BDD\u3001\u5176\u4ED6\u5DE5\u4F5C\u533A\u65F6\u4ECD\u4F1A\u63D0\u9192\u3002",
  "notify.titleCompleted": "DSH \u5DF2\u5B8C\u6210\u4EFB\u52A1",
  "notify.titleError": "DSH \u51FA\u9519\u4E86",
  "notify.titleAborted": "DSH \u5DF2\u4E2D\u6B62",
  "notify.titleBlocked": "DSH \u9700\u8981\u5904\u7406",
  "notify.titleMaxTokens": "DSH \u8FBE\u5230 Token \u4E0A\u9650",
  "notify.titleApproval": "DSH \u9700\u8981\u4F60\u7684\u5BA1\u6279",
  "notify.titleQuestion": "DSH \u9700\u8981\u4F60\u7684\u56DE\u7B54",
  "notify.titlePlanReview": "DSH \u9700\u8981\u4F60\u8BC4\u5BA1\u8BA1\u5212",
  "notify.pendingBody": "\u6709\u5F85\u5904\u7406\u7684\u64CD\u4F5C",
  "notify.emptyBody": "\u4EFB\u52A1\u5DF2\u5B8C\u6210",
  "notify.testTitle": "DSH \u901A\u77E5\u6D4B\u8BD5",
  "notify.testBody": "\u5982\u679C\u4F60\u770B\u5230\u8FD9\u6761\u901A\u77E5\uFF0C\u8BF4\u660E\u901A\u77E5\u5DF2\u914D\u7F6E\u6210\u529F\u3002"
};
var en = {
  "nav": "Notifications",
  "settings.title": "Task completion notifications",
  "settings.subtitle": "Get a browser notification when DSH finishes an operation, with keyword rules to control exactly which messages notify.",
  "settings.enabled": "Enable notifications",
  "settings.enabledDesc": "Turning this off stops every notification; rules and preferences are kept.",
  "settings.permission.title": "Browser permission",
  "settings.permission.desc": "Notifications need browser permission. Grant it below, then send a test notification to confirm it works.",
  "settings.permission.granted": "Granted",
  "settings.permission.denied": "Denied (re-enable in the browser's site settings)",
  "settings.permission.default": "Not granted",
  "settings.permission.defaultHint": "Notification permission is not granted yet: click Request permission and allow it in the browser prompt.",
  "settings.permission.deniedHint": "Notification permission was denied: re-enable notifications for this site in the browser's site settings, then try again.",
  "settings.permission.request": "Request permission",
  "settings.permission.test": "Send test notification",
  "settings.when.title": "When to notify",
  "settings.when.subtitle": "Choose which end states trigger a notification.",
  "settings.when.completed": "Completed",
  "settings.when.error": "Failed",
  "settings.when.aborted": "Aborted",
  "settings.when.blocked": "Blocked",
  "settings.when.maxTokens": "Hit token limit",
  "settings.pending.title": "Awaiting confirmation",
  "settings.pending.subtitle": "Get notified when DSH waits for your approval, answer, or plan review.",
  "settings.pending.approval": "Awaiting approval",
  "settings.pending.question": "Awaiting an answer",
  "settings.pending.planReview": "Awaiting plan review",
  "settings.rules.title": "Keyword rules",
  "settings.rules.subtitle": "Rules match the turn's reply text and called tool names. Include rules: notify only if one matches. Exclude rules: suppress on match.",
  "settings.rules.empty": "No rules yet \u2014 every enabled end state notifies.",
  "settings.rules.add": "Add rule",
  "settings.rules.save": "Save rules",
  "settings.rules.mode.include": "Include",
  "settings.rules.mode.exclude": "Exclude",
  "settings.rules.patternPlaceholder": "Keyword or regular expression",
  "settings.rules.regex": "Regex",
  "settings.rules.case": "Case sensitive",
  "settings.rules.remove": "Remove rule",
  "settings.rules.invalid": "Rule pattern must not be empty",
  "settings.rules.invalidRegex": "Invalid regular expression",
  "settings.rules.unsaved": "Rules have unsaved changes",
  "settings.rules.saveHint": "Fill in the rule pattern first, then save",
  "settings.advanced.title": "Advanced",
  "settings.advanced.requireInteraction": "Require manual dismiss",
  "settings.advanced.requireInteractionDesc": "The notification stays until you dismiss it (for important tasks).",
  "settings.advanced.backgroundOnly": "Only notify when the task is out of view",
  "settings.advanced.backgroundOnlyDesc": "Suppress notifications only for the session currently in view; still notify in the background or while viewing another session or workspace.",
  "notify.titleCompleted": "DSH finished",
  "notify.titleError": "DSH failed",
  "notify.titleAborted": "DSH aborted",
  "notify.titleBlocked": "DSH needs attention",
  "notify.titleMaxTokens": "DSH hit the token limit",
  "notify.titleApproval": "DSH needs your approval",
  "notify.titleQuestion": "DSH needs your answer",
  "notify.titlePlanReview": "DSH needs your plan review",
  "notify.pendingBody": "There is a pending action",
  "notify.emptyBody": "The task is done",
  "notify.testTitle": "DSH notification test",
  "notify.testBody": "If you can see this notification, notifications are configured correctly."
};
var NS = "notification";

// src/client/styles.ts
var STYLE_ID = "dsh-notification-style";
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
.dsh_notification_permissionRow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.dsh_notification_badge {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-radius: 11px;
  font-size: 12px;
  line-height: 16px;
}
.dsh_notification_badgeGranted {
  color: var(--dsw-alias-state-success-primary);
  background: var(--dsw-alias-state-success-tertiary);
}
.dsh_notification_badgeDenied {
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-interactive-bg-hover-danger);
}
.dsh_notification_badgeDefault {
  color: var(--dsw-alias-state-warn-label);
  background: var(--dsw-alias-state-warn-tertiary);
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
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = cssText;
  document.head.appendChild(style);
}

// src/client/store.ts
// dsh 0.1.2-alpha 起移除了 @deepseek-ai/dsh-client-runtime（store 引擎被打进各 UI 包，
// 不再作为独立包暴露）。本插件只用到 getSnapshot/subscribe/update + persist，
// 直接内置一个零依赖 mini store，新旧 dsh 通用，不再 require 任何 dsh client 包。
function createSnapshotStoreLocal(init, opts) {
  var state = init === void 0 ? {} : init;
  var listeners = new Set();
  var persistName = opts && opts.persist && opts.persist.name;
  if (persistName) {
    try {
      var raw = localStorage.getItem(persistName);
      if (raw !== null) {
        var saved = JSON.parse(raw);
        if (saved && typeof saved === "object" && !Array.isArray(saved)) state = Object.assign({}, state, saved);
      }
    } catch (e) {}
  }
  var flush = function () {
    if (persistName) { try { localStorage.setItem(persistName, JSON.stringify(state)); } catch (e) {} }
    listeners.forEach(function (l) { try { l(); } catch (e2) {} });
  };
  return {
    getSnapshot: function () { return state; },
    subscribe: function (cb) { listeners.add(cb); return function () { listeners.delete(cb); }; },
    update: function (mutator) { var draft = Object.assign({}, state); mutator(draft); state = draft; flush(); },
    set: function (next) { state = next; flush(); }
  };
}
var import_client = { createSnapshotStore: createSnapshotStoreLocal };
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
var V2_PERSIST_KEY = "dsh-notification.v2";
var V3_PERSIST_KEY = "dsh-notification.v3";
function migrateV2Settings(storage) {
  const target = storage ?? (typeof localStorage === "undefined" ? void 0 : localStorage);
  if (target === void 0) return void 0;
  try {
    const raw = target.getItem(V2_PERSIST_KEY);
    if (raw === null) return void 0;
    target.removeItem(V2_PERSIST_KEY);
    const saved = JSON.parse(raw);
    return { ...defaultNotificationSettings(), ...saved, backgroundOnly: true };
  } catch {
    return void 0;
  }
}
function migrateV3Settings(storage) {
  const target = storage ?? (typeof localStorage === "undefined" ? void 0 : localStorage);
  if (target === void 0) return void 0;
  try {
    const raw = target.getItem(V3_PERSIST_KEY);
    if (raw === null) return void 0;
    target.removeItem(V3_PERSIST_KEY);
    return { ...defaultNotificationSettings(), ...JSON.parse(raw) };
  } catch {
    return void 0;
  }
}
function createNotificationSettingsStore() {
  return (0, import_client.createSnapshotStore)(migrateV3Settings() ?? migrateV2Settings() ?? defaultNotificationSettings(), {
    persist: { name: "dsh-notification.v4" }
  });
}

// src/client/decision.ts
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

// src/client/runner.ts
function projectionAdvance(prevTurn, projection) {
  const turn = projection?.turn ?? 0;
  return { nextTurn: turn, fresh: prevTurn !== void 0 && turn > prevTurn };
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
function pendingAdvance(prev, kind) {
  if (prev === void 0) return { kind, fresh: false };
  return { kind, fresh: kind !== void 0 && kind !== prev.kind };
}
function pendingNotificationFor(sessionId, origin, title, kind, sequence, settings) {
  if (origin === "subagent") return null;
  if (!settings.enabled || !pendingReasonEnabled(settings, kind)) return null;
  if (!rulesAllow(settings, ruleSubject(title, "", []))) return null;
  return { kind, body: title?.trim() ?? "", tag: pendingNotificationTag(sessionId, sequence) };
}

// src/client/index.ts
var inject = ["sessions", "slots", "locale"];
function apply(ctx) {
  adoptStyles();
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-notification: dictionaries");
  const t = ctx.locale.bind(NS);
  const sessions = ctx.get("sessions");
  const settings = createNotificationSettingsStore();
  const set = (patch) => {
    settings.update((draft) => {
      Object.assign(draft, patch);
    });
  };
  const requestPermission = () => notificationsApi()?.requestPermission() ?? Promise.resolve("denied");
  // 通知诊断上报（dsh-native-launcher 集成）：写 host 日志，不污染浏览器 console
  const ntfLog = (kind, data) => {
    try {
      const conn = ctx.get("connection");
      if (conn && conn.rpc) {
        conn.rpc.call("/native-launcher", "ntf-log", Object.assign({ kind, t: Date.now() }, data || {}));
      }
    } catch (e) {
      // connection 不可用时静默
    }
  };
  const show = (title, body, tag, requireInteraction, key) => {
    const notifyKey = String(key || "");
    let trayAccepted = false;
    let trayAttempted = false;
    let browserShown = false;
    // 主通道：上报 host → 托盘弹原生 Toast（可靠，不依赖浏览器通知权限）。
    // 重要：host RPC 返回 ok=true 即代表托盘通道已接收消费权；浏览器不再根据
    // 3 秒时文件是否删除来抢发，避免托盘只是慢一个 tick 时双弹。
    const fireBrowser = (reason) => {
      if (trayAccepted || browserShown) {
        ntfLog("browser-fallback-skipped", { key: notifyKey, reason: trayAccepted ? "tray-accepted" : "already-shown" });
        return;
      }
      browserShown = true;
      const api = notificationsApi();
      ntfLog("browser-fallback", { key: notifyKey, reason, title, tag, api: api === void 0 ? "undefined" : "ok", permission: api === void 0 ? "?" : api.permission });
      if (api === void 0 || api.permission !== "granted") return;
      try {
        const notification = new api(title, { body, tag, requireInteraction });
        ntfLog("constructed", { key: notifyKey, tag });
        notification.onclick = () => {
          window.focus();
        };
      } catch (error) {
        ntfLog("construct-error", { key: notifyKey, tag, error: String(error && error.message ? error.message : error) });
      }
    };
    try {
      const conn = ctx.get("connection");
      if (conn && conn.rpc) {
        trayAttempted = true;
        ntfLog("tray-send", { title, tag, key: notifyKey });
        conn.rpc.call("/native-launcher", "tray-notify", { title: String(title), body: String(body), tag: String(tag), key: notifyKey })
          .then(function (res) {
            const ok = !!(res && res.ok);
            trayAccepted = ok;
            ntfLog("tray-send-result", { key: notifyKey, ok, ownership: ok ? "tray" : "browser-fallback" });
            if (!ok) fireBrowser("tray-rpc-rejected");
          })
          .catch(function (err) {
            ntfLog("tray-send-error", { key: notifyKey, error: String(err && err.message ? err.message : err), ownership: "browser-fallback" });
            fireBrowser("tray-rpc-error");
          });
      } else {
        ntfLog("tray-send-skipped", { key: notifyKey, reason: "no connection", ownership: "browser-fallback" });
        fireBrowser("no-connection");
      }
    } catch (e) {
      ntfLog("tray-send-exception", { key: notifyKey, error: String(e && e.message ? e.message : e), ownership: "browser-fallback" });
      fireBrowser("tray-rpc-exception");
    }
    // 3 秒只做观测，不再把“文件仍存在”解释成“托盘失败”。托盘 Timer、WinRT
    // 或 Windows 调度变慢时，ownership 仍归 tray；这条日志用于确认最终消费状态。
    if (trayAttempted) {
      setTimeout(function () {
        try {
          const conn = ctx.get("connection");
          if (!conn || !conn.rpc) {
            ntfLog("tray-ack-skipped", { key: notifyKey, reason: "no connection" });
            return;
          }
          conn.rpc.call("/native-launcher", "tray-acked", { key: notifyKey }).then(function (res) {
            const consumed = !!(res && res.ok && res.value && res.value.consumed);
            ntfLog("tray-ack", { key: notifyKey, consumed, ownership: trayAccepted ? "tray" : "unresolved" });
            if (!consumed && trayAccepted) ntfLog("tray-pending-after-ack", { key: notifyKey, action: "no-browser-fallback" });
          }).catch(function (error) {
            ntfLog("tray-ack-error", { key: notifyKey, error: String(error && error.message ? error.message : error), action: trayAccepted ? "no-browser-fallback" : "browser-already-fallback" });
          });
        } catch (error) {
          ntfLog("tray-ack-exception", { key: notifyKey, error: String(error && error.message ? error.message : error), action: trayAccepted ? "no-browser-fallback" : "browser-already-fallback" });
        }
      }, 3000);
    }
  };
  const sendTest = () => {
    show(t("notify.testTitle"), t("notify.testBody"), `dsh-notification-test-${Date.now()}`, false, "test");
  };
  ctx.effect(() => {
    const observedTurn = /* @__PURE__ */ new Map();

    const noProjectionWarned = /* @__PURE__ */ new Set();
    const staleWarned = /* @__PURE__ */ new Set();
    const reseed = () => {
      observedTurn.clear();
      staleWarned.clear();
    };
    const stopReset = ctx.on("connection/reset", reseed);
    // 限频：runner-tick 每次 store 更新都触发，逐条上报会刷爆 host 日志（1MB 轮转冲掉历史）
    let lastTickLog = 0;
    const off = sessions.list.subscribe(() => {
      const state = sessions.list.getSnapshot();
      const current = settings.getSnapshot();
      const nowTick = Date.now();
      if (nowTick - lastTickLog >= 60000) {
        lastTickLog = nowTick;
        ntfLog("runner-tick", { sessions: state.ids.length, enabled: current.enabled !== false });
      }
      for (const id of state.ids) {
        const summary = state.byId[id];
        const projection = summary.projectionValues?.notification;
        if (projection === void 0 && !noProjectionWarned.has(id)) {
          noProjectionWarned.add(id);
          ntfLog("no-projection", { id, hint: "notification projection not registered (module off?) or snapshot lacks it" });
        }
        const { nextTurn, fresh } = projectionAdvance(observedTurn.get(id), projection);
        observedTurn.set(id, nextTurn);
        // 链路打点：投影存在但回合未推进时留痕（每会话只报一次，避免刷屏）
        if (!fresh && projection !== void 0 && !staleWarned.has(id)) {
          staleWarned.add(id);
          ntfLog("advance-stale", { id, turn: nextTurn });
        }
        if (!fresh) continue;
        const plan = notificationFor(summary.id, summary.origin, summary.title, projection, current);
        if (plan === null) {
          ntfLog("suppressed-by-rules", { id, turn: nextTurn, origin: summary.origin, title: summary.title });
          continue;
        }
        const permission = notificationsApi()?.permission ?? "denied";
        const showIt = shouldShow(permission, current.backgroundOnly, document.hidden || !document.hasFocus(), id, state.current);
        ntfLog("decide", { id, turn: nextTurn, reason: plan.reason, show: showIt, permission, backgroundOnly: current.backgroundOnly, hidden: document.hidden, current: String(state.current), enabled: current.enabled });
        if (showIt) {
          show(
            t(titleKey(plan.reason)),
            bodyText(plan.body, t("notify.emptyBody")),
            plan.tag,
            current.requireInteraction,
            plan.tag
          );
        }
      }
      const live = new Set(state.ids);
      for (const id of [...observedTurn.keys()]) {
        if (!live.has(id)) observedTurn.delete(id);
      }
    });
    return () => {
      off();
      stopReset();
    };
  }, "dsh-notification: completion runner");
  ctx.effect(() => {
    const observed = /* @__PURE__ */ new Map();
    const sequences = /* @__PURE__ */ new Map();
    const seed = (state) => {
      const live = new Set(state.ids);
      for (const id of state.ids) observed.set(id, { kind: state.byId[id].pendingInteraction });
      for (const id of [...observed.keys()]) {
        if (!live.has(id)) {
          observed.delete(id);
          sequences.delete(id);
        }
      }
    };
    seed(sessions.list.getSnapshot());
    const reseed = () => {
      observed.clear();
      seed(sessions.list.getSnapshot());
    };
    const stopReset = ctx.on("connection/reset", reseed);
    const off = sessions.list.subscribe(() => {
      const state = sessions.list.getSnapshot();
      const current = settings.getSnapshot();
      for (const id of state.ids) {
        const summary = state.byId[id];
        const kind = summary.pendingInteraction;
        const previous = observed.get(id);
        const next = pendingAdvance(previous, kind);
        observed.set(id, { kind: next.kind });
        if (!next.fresh || next.kind === void 0) continue;
        const sequence = (sequences.get(id) ?? 0) + 1;
        sequences.set(id, sequence);
        const plan = pendingNotificationFor(
          summary.id,
          summary.origin,
          summary.displayTitle,
          next.kind,
          sequence,
          current
        );
        if (plan === null) continue;
        const permission = notificationsApi()?.permission ?? "denied";
        const showIt = shouldShow(permission, current.backgroundOnly, document.hidden || !document.hasFocus(), id, state.current);
        if (showIt) {
          show(
            t(pendingTitleKey(plan.kind)),
            bodyText(plan.body, t("notify.pendingBody")),
            plan.tag,
            current.requireInteraction,
            plan.tag
          );
        }
      }
      seed(state);
    });
    return () => {
      off();
      stopReset();
    };
  }, "dsh-notification: pending runner");
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "notification",
    order: 60,
    label: () => t("nav"),
    locale: NS,
    inject: () => ({
      hooks: { settings },
      set,
      requestPermission,
      sendTest
    })
  }, NotificationSettingsSection));
}
return module.exports; } });
//# sourceMappingURL=client.js.map

if (typeof window !== 'undefined' && typeof window.__ModuleLoader__ !== 'undefined') {
window.__ModuleLoader__.load({
  id: 'dsh-native-launcher',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require('react');

    // 主动索要通知权限（原生权限窗口）：页面加载后延迟请求，未授权时自动弹出
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        setTimeout(function () {
          Notification.requestPermission().catch(function () {});
        }, 2000);
      }
    } catch (e) {}

    var LABEL_STYLE = {
      fontSize: 12,
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-tertiary)',
      minWidth: 110,
      flex: 'none',
    };
    var VALUE_STYLE = {
      fontSize: 13,
      lineHeight: '20px',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      wordBreak: 'break-all',
    };
    var ROW_STYLE = { display: 'flex', gap: 12, alignItems: 'baseline', padding: '6px 0' };

    function Row(props) {
      return react.createElement(
        'div',
        { style: ROW_STYLE },
        react.createElement('div', { style: LABEL_STYLE }, props.label),
        react.createElement('div', { style: VALUE_STYLE }, props.children),
      );
    }

    function LauncherSection(props) {
      var rpc = props.rpc;
      var form = react.useState(null);
      var setForm = form[1];
      var meta = react.useState({ loading: true, error: null, shortcutExists: false, settingsAvailable: false });
      var setMeta = meta[1];
      var saving = react.useState(false);
      var setSaving = saving[1];
      var notice = react.useState(null);
      var setNotice = notice[1];
      var uninstallBusy = react.useState(false);
      var setUninstallBusy = uninstallBusy[1];
      var uninstallResult = react.useState(null);
      var setUninstallResult = uninstallResult[1];

      react.useEffect(() => {
        var alive = true;
        rpc.call('/native-launcher', 'config.get', {}).then((result) => {
          if (!alive) return;
          if (result && result.ok) {
            var v = result.value;
            setForm({
              launchCommand: String(v.launchCommand || ''),
              shortcutName: String(v.shortcutName || ''),
              port: Number(v.port) || 3080,
              autoOpen: v.autoOpen !== false,
              openMode: v.openMode || 'app',
              tray: v.tray !== false,
              traySurvivesDsh: v.traySurvivesDsh !== false,
              trayNotify: v.trayNotify !== false,
              closeToExit: v.closeToExit !== false,
              closeToExitDebounceSeconds: Number(v.closeToExitDebounceSeconds) || 20,
              closeToExitFinalConfirmSeconds: Number(v.closeToExitFinalConfirmSeconds) || 2,
              force: v.force === true,
              modulesNotifications: !(v.modules && v.modules.notifications === false),
            });
            setMeta({ loading: false, error: null, shortcutExists: !!v.shortcutExists, settingsAvailable: v.settingsAvailable !== false });
          } else {
            setMeta({ loading: false, error: (result && result.error && result.error.message) || 'config.get failed', shortcutExists: false, settingsAvailable: false });
          }
        }).catch((error) => {
          if (alive) setMeta({ loading: false, error: String(error && error.message ? error.message : error), shortcutExists: false, settingsAvailable: false });
        });
        return () => { alive = false; };
      }, [rpc]);

      function setValue(key, value) {
        setForm((prev) => Object.assign({}, prev, { [key]: value }));
      }

      function save() {
        if (!form[0]) return;
        setSaving(true);
        setNotice(null);
        var f = form[0];
        rpc.call('/native-launcher', 'config.set', { values: {
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
          modules: { notifications: f.modulesNotifications },
        } }).then((result) => {
          setSaving(false);
          if (result && result.ok) setNotice({ kind: 'ok', text: (result.value && result.value.message) || 'saved' });
          else setNotice({ kind: 'err', text: (result && result.error && result.error.message) || 'save failed' });
        }).catch((error) => {
          setSaving(false);
          setNotice({ kind: 'err', text: String(error && error.message ? error.message : error) });
        });
      }

      var uninstallBusy = react.useState(false);
      var setUninstallBusy = uninstallBusy[1];
      var uninstallResult = react.useState(null);
      var setUninstallResult = uninstallResult[1];

      // 自绘卸载确认框：复用安装引导卡片（showCard）的骨架与样式，内嵌两个勾选，
      // 确认后回调 uninstall(opts)。原生 DOM 实现（document.body 挂载），不受 slot 区域限制。
      function showUninstallConfirm(onConfirm) {
        var overlay = document.createElement('div');
        overlay.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)');
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.parentNode.removeChild(overlay); });
        var card = document.createElement('div');
        card.setAttribute('style', 'display:flex;flex-direction:column;gap:14px;padding:24px;border-radius:14px;background:#ffffff;color:#1a1a1a;box-shadow:0 12px 48px rgba(0,0,0,.35);font:14px/1.5 system-ui,sans-serif;width:400px;max-width:calc(100vw - 48px);border:1px solid #e0e0e0');
        var top = document.createElement('div');
        top.setAttribute('style', 'display:flex;align-items:center;gap:12px');
        var img = document.createElement('img');
        img.src = '/native-launcher/icon.png'; img.alt = '';
        img.setAttribute('style', 'width:44px;height:44px;border-radius:10px;flex:none;background:#f0f0f0');
        var titles = document.createElement('div');
        titles.setAttribute('style', 'display:flex;flex-direction:column;gap:2px;min-width:0');
        var title = document.createElement('div'); title.textContent = '卸载 WebUI 启动器';
        title.setAttribute('style', 'font-size:15px;font-weight:600;color:#1a1a1a');
        var sub = document.createElement('div'); sub.textContent = '此操作将移除启动器的全部组件，且不可撤销。';
        sub.setAttribute('style', 'font-size:12px;color:#666');
        titles.appendChild(title); titles.appendChild(sub);
        top.appendChild(img); top.appendChild(titles);
        var list = document.createElement('ul');
        list.setAttribute('style', 'margin:0;padding-left:18px;font-size:13px;line-height:1.7;color:#333');
        ['停止系统托盘与 dsh 后端服务（约 6 秒后自动停止）', '删除桌面快捷方式', '清理全部生成文件与通知注册表项', '从 dsh profile 移除本插件条目'].forEach(function (t) {
          var li = document.createElement('li'); li.textContent = t; list.appendChild(li);
        });
        function checkRow(text) {
          var row = document.createElement('label');
          row.setAttribute('style', 'display:flex;align-items:center;gap:8px;font-size:13px;color:#1a1a1a;cursor:pointer');
          var cb = document.createElement('input');
          cb.type = 'checkbox'; cb.checked = false;
          cb.style.accentColor = '#e5484d';
          row.appendChild(cb); row.appendChild(document.createTextNode(text));
          row._cb = cb;
          return row;
        }
        var rowStop = checkRow('立即停止 dsh 服务（推荐，否则本次进程继续运行）');
        var rowClear = checkRow('同时清除保存的全部个性化配置（重装后回到默认值）');
        var rowBtn = document.createElement('div');
        rowBtn.setAttribute('style', 'display:flex;gap:10px;justify-content:flex-end');
        var cancel = document.createElement('button');
        cancel.textContent = '取消';
        cancel.setAttribute('style', 'background:none;border:1px solid #ccc;border-radius:8px;color:#444;cursor:pointer;font:inherit;padding:7px 16px');
        cancel.addEventListener('click', function () { overlay.parentNode.removeChild(overlay); });
        var confirmBtn = document.createElement('button');
        confirmBtn.textContent = '确认卸载';
        confirmBtn.setAttribute('style', 'background:#e5484d;color:#fff;border:none;border-radius:8px;cursor:pointer;font:inherit;font-weight:600;padding:7px 22px');
        confirmBtn.addEventListener('click', function () {
          var stop = rowStop._cb.checked, clear = rowClear._cb.checked;
          overlay.parentNode.removeChild(overlay);
          onConfirm({ stopAfter: stop, clearSettings: clear });
        });
        rowBtn.appendChild(cancel); rowBtn.appendChild(confirmBtn);
        card.appendChild(top); card.appendChild(list); card.appendChild(rowStop); card.appendChild(rowClear); card.appendChild(rowBtn);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
      }

      function uninstall(opts) {
        setUninstallBusy(true);
        setUninstallResult(null);
        rpc.call('/native-launcher', 'launcher.uninstall', { clearSettings: !!(opts && opts.clearSettings), stopAfter: !(opts && opts.stopAfter === false) }).then((result) => {
          setUninstallBusy(false);
          if (result && result.ok) setUninstallResult(result.value || { steps: [], manual: [] });
          else setNotice({ kind: 'err', text: (result && result.error && result.error.message) || 'uninstall failed' });
        }).catch((error) => {
          setUninstallBusy(false);
          setNotice({ kind: 'err', text: String(error && error.message ? error.message : error) });
        });
      }

      var inputStyle = {
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-interactive-bg-hover)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 13,
        width: 260,
      };

      function groupEl(titleText) {
        return react.createElement('div', { style: { marginTop: 14, marginBottom: 2, fontSize: 12, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--dsw-alias-label-tertiary)', textTransform: 'uppercase' } }, titleText);
      }

      function rowEl(label, desc, control) {
        return react.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '7px 0' } }, [
          react.createElement('div', { key: 'l', style: { flex: '1 1 auto' } }, [
            react.createElement('div', { key: 'a', style: { fontSize: 13.5, color: 'var(--dsw-alias-label-primary)' } }, label),
            desc ? react.createElement('div', { key: 'b', style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', marginTop: 1 } }, desc) : null,
          ]),
          react.createElement('div', { key: 'c', style: { flex: '0 0 auto' } }, control),
        ]);
      }

      function toggleEl(key, disabled) {
        return react.createElement('input', {
          type: 'checkbox',
          checked: !!(form[0] && form[0][key]),
          disabled: !!disabled,
          onChange: (e) => setValue(key, e.target.checked),
          style: { width: 16, height: 16, accentColor: 'var(--dsw-alias-brand-primary)', cursor: 'pointer' },
        });
      }

      function numberEl(key, minValue, maxValue) {
        return react.createElement('input', {
          type: 'number',
          value: form[0] ? form[0][key] : '',
          min: minValue,
          max: maxValue,
          onChange: (e) => setValue(key, Math.max(minValue, Math.floor(Number(e.target.value) || 0))),
          style: Object.assign({}, inputStyle, { width: 90 }),
        });
      }

      var title = react.createElement('h3', { style: { margin: '0 0 12px', fontSize: 16, lineHeight: '24px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, 'WebUI 启动器');
      var intro = react.createElement(
        'p',
        { style: { margin: '0 0 8px', fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' } },
        '桌面快捷方式一键启动 dsh Web UI：静默启动、自动开浏览器、端口探测直连。改动保存后需重启 dsh 完全生效。',
      );

      var content;
      if (meta[0].loading) {
        content = react.createElement('p', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 } }, '加载配置中…');
      } else if (meta[0].error) {
        content = react.createElement('p', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13 } }, '配置读取失败：' + meta[0].error + '（插件 RPC 未注册？请重启后重试）');
      } else {
        var restartHint = react.createElement('div', { style: { marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '带 * 的项在下次启动时生效；其余即时语义项同样建议重启一次以重建脚本。');

        var saveButton = react.createElement(
          'button',
          { type: 'button', onClick: save, disabled: saving[0],
            style: { marginTop: 14, padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-label-inverted, #fff)', fontSize: 13, fontWeight: 500, cursor: saving[0] ? 'default' : 'pointer', opacity: saving[0] ? 0.6 : 1 } },
          saving[0] ? '保存中…' : '保存设置',
        );

        var openModeSelect = react.createElement('select', {
          value: form[0].openMode,
          onChange: (e) => setValue('openMode', e.target.value),
          style: Object.assign({}, inputStyle, { width: 180 }),
        },
          react.createElement('option', { value: 'app' }, 'App 独立窗口（推荐）'),
          react.createElement('option', { value: 'new-window' }, '浏览器独立窗口'),
          react.createElement('option', { value: 'default' }, '浏览器默认行为'),
        );

        content = react.createElement('div', null,
          groupEl('启动'),
          rowEl('启动命令', '桌面快捷方式执行的命令（需 PATH 里有 dsh）*',
            react.createElement('input', { type: 'text', value: form[0].launchCommand, onChange: (e) => setValue('launchCommand', e.target.value), style: inputStyle })),
          rowEl('端口', 'WebUI 端口，需与 webserver 配置一致*', numberEl('port', 1, 65535)),
          rowEl('快捷方式名称', '桌面快捷方式的显示名称*', react.createElement('input', { type: 'text', value: form[0].shortcutName, onChange: (e) => setValue('shortcutName', e.target.value), style: Object.assign({}, inputStyle, { width: 180 }) })),
          rowEl('强制覆盖快捷方式', '每次启动都重新生成快捷方式（默认幂等跳过）', toggleEl('force')),

          groupEl('浏览器窗口'),
          rowEl('自动打开浏览器', '快捷方式启动后自动打开 WebUI（PWA 应用窗口优先）', toggleEl('autoOpen')),
          rowEl('打开方式', null, openModeSelect),

          groupEl('托盘与通知'),
          rowEl('系统托盘', '托盘图标：打开 WebUI / 任务通知 / 退出', toggleEl('tray')),
          rowEl('托盘在 dsh 退出后保留', '关 = 托盘随 dsh 一起退出（保存后立即按新模式重启托盘）', toggleEl('traySurvivesDsh')),
          rowEl('任务托盘通知', '任务完成或需要关注时弹系统通知', toggleEl('trayNotify')),
          rowEl('启用通知模块', 'WebUI 内的任务通知投影通道（关闭仅影响通知模块本身）', toggleEl('modulesNotifications')),

          groupEl('关闭语义（关窗即退）'),
          rowEl('关窗自动退出', '所有窗口关闭且无任务运行时自动退出服务（仅快捷方式启动生效）', toggleEl('closeToExit')),
          rowEl('退出防抖秒数', '关窗后等待的秒数，期间重开页面会取消退出（最小 5）', numberEl('closeToExitDebounceSeconds', 5, 600)),
          rowEl('二次确认窗口秒数', '退出前的最后确认窗口，防误杀重开请求（最小 1）', numberEl('closeToExitFinalConfirmSeconds', 1, 60)),

          saveButton,
          restartHint,
        );
      }

      var button = react.createElement(
        'button',
        {
          type: 'button',
          disabled: meta[0].loading,
          onClick: () => {
            setNotice(null);
            rpc.call('/native-launcher', 'shortcut.recreate', {}).then((result) => {
              if (result && result.ok) setNotice({ kind: 'ok', text: (result.value && result.value.message) || 'shortcut recreated' });
              else setNotice({ kind: 'err', text: (result && result.error && result.error.message) || 'recreate failed' });
            }).catch((error) => setNotice({ kind: 'err', text: String(error && error.message ? error.message : error) }));
          },
          style: {
            marginTop: 18, padding: '8px 16px', borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'var(--dsw-alias-interactive-bg-hover)',
            color: 'var(--dsw-alias-label-primary)', fontSize: 13, cursor: 'pointer',
          },
        },
        '重新生成快捷方式（强制覆盖）',
      );

      var uninstallButton = react.createElement(
        'button',
        {
          type: 'button',
          disabled: uninstallBusy[0],
          onClick: function () { showUninstallConfirm(uninstall); },
          style: {
            marginTop: 10, padding: '8px 16px', borderRadius: 8,
            border: '1px solid var(--dsw-alias-state-error-primary)',
            background: 'transparent',
            color: 'var(--dsw-alias-state-error-primary)', fontSize: 13, cursor: uninstallBusy[0] ? 'default' : 'pointer', opacity: uninstallBusy[0] ? 0.6 : 1,
          },
        },
        uninstallBusy[0] ? '卸载中…' : '一键卸载启动器',
      );

      var uninstallEl = null;
      if (uninstallResult[0]) {
        var ur = uninstallResult[0];
        var stepEls = (ur.steps || []).map((s, i) => react.createElement('li', { key: i, style: { marginBottom: 2 } }, s));
        var manualEls = (ur.manual || []).map((s, i) => react.createElement('li', { key: i, style: { marginBottom: 2 } }, s));
        uninstallEl = react.createElement(
          'div',
          { style: { marginTop: 10, fontSize: 12, lineHeight: '19px', color: 'var(--dsw-alias-label-secondary)' } },
          react.createElement('div', { style: { fontWeight: 500 } }, '已完成：'),
          react.createElement('ul', { style: { margin: '4px 0 8px', paddingLeft: 20 } }, stepEls),
          manualEls.length ? react.createElement('div', { style: { fontWeight: 500, color: 'var(--dsw-alias-state-warning-primary)' } }, '需要你手动完成：') : null,
          manualEls.length ? react.createElement('ul', { style: { margin: '4px 0 0', paddingLeft: 20 } }, manualEls) : null,
        );
      }

      var noticeEl = null;
      if (notice[0]) {
        var color = notice[0].kind === 'ok' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)';
        noticeEl = react.createElement('p', { style: { marginTop: 10, fontSize: 12, lineHeight: '18px', color: color } }, notice[0].text);
      }

      return react.createElement('section', { style: { maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 4 } }, title, intro, content, button, uninstallButton, uninstallEl, noticeEl);
    }

    function apply(ctx) {
      // 关闭语义：online/offline 上报（页面加载登记 / 关闭时 keepalive 送达），
      // host 据此判断"无客户端在线"→ 任务检查 → 官方优雅退出
      try {
        var cid = null;
        try { cid = window.localStorage.getItem('dsh-native-launcher.clientId'); } catch (e) {}
        if (!cid) {
          cid = 'c-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
          try { window.localStorage.setItem('dsh-native-launcher.clientId', cid); } catch (e) {}
        }
        var base = window.location.origin;
        var report = function (path) {
          try {
            fetch(base + path + '?client=' + encodeURIComponent(cid), { keepalive: true }).catch(function () {});
          } catch (e) {}
        };
        report('/native-launcher/online');
        window.addEventListener('pagehide', function () { report('/native-launcher/offline'); });
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) report('/native-launcher/online');
        });
      } catch (e) {}

      // 手动调用 dsh-notification 插件：它不在 client graph（bundles 列表）里，
      // cordis runner 不会为它调用 apply——由我们 require 它的模块并手动 apply
      // （其 factory 已注册于同文件第一个 load；apply 需要 ctx，故在此调用）
      try {
        var notificationModule = require('dsh-notification');
        if (notificationModule && typeof notificationModule.apply === 'function') {
          notificationModule.apply(ctx);
        } else {
}
      } catch (error) {
}

      // 加固：注册失败只记日志，绝不拖累设置页/GUI 初始化
      try {
        // 组件是 register 的第二个参数（yasa 等正确写法）；inject 提供 RPC
        // alpha.2+ 的设置段注册走 slots.inject 生成器（槽位账本就绪后才挂卡），且 label
        // 必须是函数（官方 "插件" 段同款写法）；rc.2 无 slots.inject，保持直接注册 + 字符串 label。
        var sectionComponent = { inject: function () { return { rpc: ctx.connection.rpc }; } };
        if (typeof ctx.slots.inject === 'function') {
          ctx.slots.inject('settings.section', function* () {
            yield ctx.slots.register(
              {
                name: 'settings.section',
                id: 'native-launcher',
                order: 30,
                label: function () { return 'WebUI 启动器'; },
                inject: sectionComponent.inject,
              },
              LauncherSection,
            );
          });
        } else {
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'native-launcher',
              order: 30,
              label: 'WebUI 启动器',
              inject: sectionComponent.inject,
            },
            LauncherSection,
          );
        }
      } catch (error) {
}

      // 注入自定义 favicon + 真实 URL 的 PWA manifest：
      //   favicon → --app 独立窗口的任务栏图标
      //   manifest → host 提供的 /native-launcher/manifest.webmanifest（真实 http URL，
      //              Chromium 可安装性检查只认这个；blob/data URL 均被拒）
      try {
        ctx.connection.rpc
          .call('/native-launcher', 'icon.get', {})
          .then(function (result) {
            if (!result || !result.ok || !result.value || !result.value.dataUrl) return;
            var head = document.head;
            if (!head) return;

            // 1) 替换已有 favicon，保证窗口/任务栏图标是我们的
            var links = head.querySelectorAll('link[rel~="icon"], link[rel~="shortcut"]');
            for (var i = 0; i < links.length; i++) links[i].remove();
            var iconLink = document.createElement('link');
            iconLink.rel = 'icon';
            iconLink.type = 'image/png';
            iconLink.href = result.value.dataUrl;
            head.appendChild(iconLink);

            // 2) PWA manifest：替换 dsh 自带的 /manifest.webmanifest（浏览器只认第一个 manifest）
            var existing = head.querySelectorAll('link[rel~="manifest"]');
            for (var i = 0; i < existing.length; i++) existing[i].remove();
            var manifestLink = document.createElement('link');
            manifestLink.rel = 'manifest';
            manifestLink.href = '/native-launcher/manifest.webmanifest';
            head.appendChild(manifestLink);
          })
          .catch(function (error) {
});
      } catch (error) {
}

      // 安装引导：站点可安装时（beforeinstallprompt）自动弹出自绘模态框（接近浏览器原生安装框的观感），
      // 点击"安装"才弹浏览器的原生安装框——浏览器硬限制：prompt() 必须用户手势，无法完全自动弹原生框。
      try {
        var promptState = { deferred: null, shown: false, card: null };

        function removeCard() {
          if (promptState.card && promptState.card.parentNode) promptState.card.parentNode.removeChild(promptState.card);
          promptState.card = null;
          promptState.shown = false;
        }

        function showCard() {
          if (promptState.shown || !promptState.deferred || !document.body) return;
          promptState.shown = true;
          var overlay = document.createElement('div');
          overlay.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45)');
          overlay.addEventListener('click', function (e) {
            if (e.target === overlay) removeCard();
          });
          var card = document.createElement('div');
          card.setAttribute(
            'style',
            'display:flex;flex-direction:column;gap:16px;padding:24px;border-radius:14px;' +
              'background:#ffffff;color:#1a1a1a;' +
              'box-shadow:0 12px 48px rgba(0,0,0,.35);font:14px/1.5 system-ui,sans-serif;width:340px;max-width:calc(100vw - 48px);' +
              'border:1px solid #e0e0e0',
          );
          var top = document.createElement('div');
          top.setAttribute('style', 'display:flex;align-items:center;gap:12px');
          var img = document.createElement('img');
          img.src = '/native-launcher/icon.png';
          img.alt = '';
          img.setAttribute('style', 'width:44px;height:44px;border-radius:10px;flex:none;background:#f0f0f0');
          var titles = document.createElement('div');
          titles.setAttribute('style', 'display:flex;flex-direction:column;gap:2px;min-width:0');
          var title = document.createElement('div');
          title.textContent = '安装 DSH WebUI';
          title.setAttribute('style', 'font-size:15px;font-weight:600;color:#1a1a1a');
          var sub = document.createElement('div');
          sub.textContent = '安装为桌面应用：独立窗口、任务栏图标、可固定到任务栏。';
          sub.setAttribute('style', 'font-size:12px;color:#666');
          titles.appendChild(title);
          titles.appendChild(sub);
          top.appendChild(img);
          top.appendChild(titles);
          var row = document.createElement('div');
          row.setAttribute('style', 'display:flex;gap:10px;justify-content:flex-end;align-items:center');
          var later = document.createElement('button');
          later.textContent = '稍后';
          later.setAttribute('style', 'background:none;border:1px solid #ccc;border-radius:8px;color:#444;cursor:pointer;font:inherit;padding:7px 16px');
          later.addEventListener('click', removeCard);
          var install = document.createElement('button');
          install.textContent = '安装';
          install.setAttribute(
            'style',
            'background:#4c8dff;color:#fff;border:none;border-radius:8px;' +
              'cursor:pointer;font:inherit;font-weight:600;padding:7px 22px',
          );
          var hint = document.createElement('div');
          hint.textContent = '如果未弹出安装窗口（浏览器限制），请用 Edge 菜单 ⋯ → 更多工具 → 应用 → 将此站点安装为应用。';
          hint.setAttribute('style', 'display:none;font-size:12px;color:#8a5a00;background:#fff7e0;border:1px solid #f0d9a0;border-radius:8px;padding:8px 10px;line-height:1.5');
          install.addEventListener('click', function () {
            var promptEvent = promptState.deferred;
            if (!promptEvent) return;
            promptState.deferred = null;
            // 浏览器安全限制：prompt() 必须用户手势且受 Edge 安装抑制期影响——
            // 若被抑制（此前多次展示/忽略过），prompt() 会被静默丢弃，这里做超时兜底提示
            var settled = false;
            var timer = setTimeout(function () {
              if (settled) return;
              settled = true;
              hint.style.display = 'block';
            }, 2500);
            promptEvent.prompt();
            promptEvent.userChoice
              .then(function () {
                clearTimeout(timer);
                if (!settled) {
                  settled = true;
                  removeCard();
                }
              })
              .catch(function () {
                clearTimeout(timer);
                if (!settled) {
                  settled = true;
                  removeCard();
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
        }

        window.addEventListener('beforeinstallprompt', function (event) {
          event.preventDefault();
          promptState.deferred = event;
          showCard();
        });
        window.addEventListener('appinstalled', removeCard);
      } catch (error) {
}
    }

    exports.apply = apply;
    exports.inject = ['slots', 'connection', 'sessions', 'locale'];
    return module.exports;
  },
});
}