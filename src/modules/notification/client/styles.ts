/**
 * 通知卡片的样式表（模板字符串，随 client bundle 一次性注入）。
 *
 * 移植自上游 dsh-notification `src/client/styles.ts`（逐字保留类名与取值口径）：
 * - 颜色只用官方 `--dsw-alias-*` 设计令牌，无字面色值；
 * - 类名统一 `dsh_notification_` 前缀，避免在拼装后的壳里撞名；
 * - webServer 每个插件只服务一个文件，故样式必须内联在 bundle 里，不能是独立 CSS 产物。
 *
 * 与上游的**有意差异**（记账）：删掉浏览器权限卡相关类（`permissionRow` / `badge*`）——
 * 浏览器通知通道已砍，唯一通道 = 托盘 Toast。
 */

/** `<style>` 元素的稳定 id（HMR / 重复装配下幂等注入）。 */
export const STYLE_ID = 'dsh-native-notification-style'

/** 卡片样式文本。 */
export const cssText = `
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
`

/**
 * 注入样式表一次（稳定 id；重复调用无副作用）。
 * 为什么容错：样式注入失败不该让整张卡片挂掉——宁可样式朴素，也要能用。
 */
export function adoptStyles(): void {
  try {
    if (document.getElementById(STYLE_ID) !== null) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = cssText
    document.head.appendChild(style)
  } catch {
    // 无 document（非浏览器环境自检）时静默跳过：卡片逻辑不依赖样式
  }
}
