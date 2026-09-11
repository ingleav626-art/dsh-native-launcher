/**
 * 通知卡片的中文文案表。
 *
 * 移植自上游 dsh-notification `src/client/locales.ts` 的 `zh` 字典（键名逐字保留，
 * 便于与上游对照）。与上游的**有意差异**（记账）：
 * - 通道口径改写：上游文案讲"浏览器系统通知 / 浏览器权限"，本项目唯一通道是托盘 Toast，
 *   故 `settings.subtitle` 改为托盘口径；浏览器权限卡整块删除（含其文案）。
 * - 不引字典体系：本项目 client 无 locale 模块，中文即产品文案，直接取表（与启动器卡片一致）。
 * - 新增 4 条本项目文案（加载中 / 读取失败 / 模块不可用 / 保存失败）。
 */

/** 卡片文案表（键名与上游一致；新增键见文件头说明）。 */
export const COPY = {
  'settings.title': '任务完成通知',
  'settings.subtitle': '当 dsh 完成一次任务时，通过系统托盘通知提醒你；可以用关键词规则精确控制哪些消息需要提醒。',
  'settings.enabled': '启用通知',
  'settings.enabledDesc': '关闭后不会弹出任何通知，规则与偏好设置仍会保留。',
  'settings.when.title': '通知时机',
  'settings.when.subtitle': '选择哪些结束状态触发通知。',
  'settings.when.completed': '正常完成',
  'settings.when.error': '出错',
  'settings.when.aborted': '被中止',
  'settings.when.blocked': '被阻塞',
  'settings.when.maxTokens': '达到 Token 上限',
  'settings.pending.title': '等待确认',
  'settings.pending.subtitle': '当 dsh 等待你审批、回答问题或评审计划时提醒。',
  'settings.pending.approval': '等待审批',
  'settings.pending.question': '等待回答问题',
  'settings.pending.planReview': '等待计划评审',
  'settings.rules.title': '关键词规则',
  'settings.rules.subtitle': '规则匹配该轮回复文本与调用过的工具名。包含规则：命中任一才通知；排除规则：命中即不通知。',
  'settings.rules.empty': '暂无规则，所有已启用的完成状态都会通知。',
  'settings.rules.add': '添加规则',
  'settings.rules.save': '保存规则',
  'settings.rules.mode.include': '包含',
  'settings.rules.mode.exclude': '排除',
  'settings.rules.patternPlaceholder': '关键词或正则表达式',
  'settings.rules.regex': '正则',
  'settings.rules.case': '区分大小写',
  'settings.rules.remove': '删除规则',
  'settings.rules.invalid': '规则模式不能为空',
  'settings.rules.invalidRegex': '无效的正则表达式',
  'settings.rules.unsaved': '规则有未保存的修改',
  'settings.rules.saveHint': '先填写规则模式，再点保存',
  'settings.test.title': '测试通知',
  'settings.test.desc': '点一下发一条真实的托盘通知：能弹出来，就说明「模块 → 投递端 → 托盘 → 系统」整条链路已打通。',
  'settings.test.send': '发送测试通知',
  'settings.test.sending': '发送中…',
  'settings.test.sent': '已交到托盘。若没看到：先确认托盘图标在（重启 dsh 会自动拉起），再检查系统「专注/勿扰」与上方「任务托盘通知」开关；细节见 logs 里的 [notify] 行。',
  'settings.test.failed': '投递失败：host 拒绝了这次请求（通知模块未启用？）——细节见 logs 里的 [notification] / [notify] 行。',
  'settings.advanced.title': '高级',  'settings.advanced.requireInteraction': '需要手动关闭',
  'settings.advanced.requireInteractionDesc': '通知保持显示，直到你手动关闭（适合重要任务）。',
  'settings.advanced.backgroundOnly': '仅在任务不在眼前时通知',
  'settings.advanced.backgroundOnlyDesc': '当前会话正在眼前时不提醒；页面在后台，或你正在查看其他会话、其他工作区时仍会提醒。',
  'settings.loading': '载入通知设置…',
  'settings.loadFailed': '通知设置读取失败',
  'settings.moduleUnavailable': '通知模块未启用（请在上方「WebUI 启动器」卡片里开启「启用通知模块」）',
  'settings.saveFailed': '保存失败：host 拒绝了这次写入（规则非法或设置服务不可用）',
} as const

/** 文案键。 */
export type NotificationCopyKey = keyof typeof COPY
