/**
 * 通知设置卡片（设置页的一节）：总开关 / 等待确认 / 通知时机 / 关键词规则 / 高级。
 *
 * 职责声明（超过 300 行软阈值的说明）：本文件只承担**一件事**——把这 12 个设置项渲染成
 * 一张可交互的卡片（含规则行的增删改与草稿保存）；子组件 Toggle / RuleRow 都是它的私有零件，
 * 拆出去只会让"改一处要读三个文件"，故保留单文件。
 *
 * 结构与交互移植自上游 dsh-notification `src/client/SettingsSection.tsx`
 * （基线亦见 refactor-base 的 `lib/client.js` 编译产物；本地克隆 `D:\web\demo\test\dsh-notification-src`）。
 *
 * 与上游的**有意差异**（记账）：
 * - 数据源：上游读写 client localStorage 快照 store；本项目读写官方 settings namespace，
 *   经模块自有窄接口 `face.settings`（host 侧唯一写者并在写前校验规则）。
 * - 浏览器权限卡整块删除——浏览器通知通道已砍，唯一通道 = 托盘 Toast。
 * - 用 `createElement` 而非 JSX：不引 `@types/react`（零新增依赖），且与编译基线可比。
 * - 设置是**异步**取回的，故取到之后才渲染卡片：非受控 checkbox（defaultChecked）若早绑定
 *   到默认值，用户会看到与实际配置不符的开关状态。
 * - 规则编辑保留上游的"草稿 + 保存"语义（未填 pattern 的规则不会落库）；开关类即时保存。
 */
import { createElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { firstRuleError, emptyRule, patchRule, removeRule } from '../shared/rules.ts'
import type { RuleErrorKey } from '../shared/rules.ts'
import type { NotificationRule, NotificationSettings, NotificationSoundMode } from '../shared/types.ts'
import { COPY } from './copy.ts'
import { fileToSoundUpload } from './soundFile.ts'
import type { NotificationClientFace } from './ports.ts'

/** 完成状态类开关字段。 */
type NotifyField = 'notifyCompleted' | 'notifyError' | 'notifyAborted' | 'notifyBlocked' | 'notifyMaxTokens'
/** 等待交互类开关字段。 */
type PendingField = 'notifyApproval' | 'notifyQuestion' | 'notifyPlanReview'

/** 完成状态开关表（文案取自上游 `settings.when.*`）。 */
const OUTCOMES: ReadonlyArray<{ readonly field: NotifyField; readonly label: string }> = [
  { field: 'notifyCompleted', label: COPY['settings.when.completed'] },
  { field: 'notifyError', label: COPY['settings.when.error'] },
  { field: 'notifyAborted', label: COPY['settings.when.aborted'] },
  { field: 'notifyBlocked', label: COPY['settings.when.blocked'] },
  { field: 'notifyMaxTokens', label: COPY['settings.when.maxTokens'] },
]

/** 等待交互开关表。 */
const PENDING: ReadonlyArray<{ readonly field: PendingField; readonly label: string }> = [
  { field: 'notifyApproval', label: COPY['settings.pending.approval'] },
  { field: 'notifyQuestion', label: COPY['settings.pending.question'] },
  { field: 'notifyPlanReview', label: COPY['settings.pending.planReview'] },
]

/**
 * 卡片管理的全部布尔开关字段。
 * 导出是为了让 `card.spec.ts` 断言"schema 里的每个布尔字段都有开关"——
 * 只加 schema 不加 UI 的漂移必须被测试抓住（用户看不见的开关等于不存在）。
 */
export const CARD_BOOLEAN_FIELDS: readonly string[] = [
  'enabled',
  ...OUTCOMES.map(entry => entry.field),
  ...PENDING.map(entry => entry.field),
  'requireInteraction',
  'backgroundOnly',
]

/**
 * 提示音选项表（值域必须与 host 侧 NotificationSoundMode / schema 一致——card.spec 盯住）。
 * 导出同 CARD_BOOLEAN_FIELDS：防"schema 加了模式、下拉没有"的漂移。
 */
export const SOUND_OPTIONS: ReadonlyArray<{ readonly value: NotificationSoundMode; readonly label: string }> = [
  { value: 'default', label: COPY['settings.sound.default'] },
  { value: 'none', label: COPY['settings.sound.none'] },
  { value: 'custom', label: COPY['settings.sound.custom'] },
]

/** 卡片注入面：由模块 client 入口经官方槽位 `inject` 提供。 */
export interface NotificationCardProps {
  readonly face: NotificationClientFace
}

/** 单开关的补丁（与上游 `notifyPatch` 同形：一次只改一个字段）。 */
export function notifyPatch(field: NotifyField | PendingField, checked: boolean): Partial<NotificationSettings> {
  return { [field]: checked } as Partial<NotificationSettings>
}

/** 一个开关行（原生 checkbox：即时生效，非受控）。 */
function Toggle(props: {
  readonly defaultChecked: boolean
  readonly label: string
  readonly desc?: string
  readonly onChange: (checked: boolean) => void
}): ReactElement {
  return createElement(
    'label',
    { className: 'dsh_notification_toggleRow' },
    createElement('input', {
      type: 'checkbox',
      className: 'dsh_notification_checkbox',
      defaultChecked: props.defaultChecked,
      onChange: (event) => { props.onChange(event.target.checked) },
    }),
    createElement(
      'span',
      { className: 'dsh_notification_toggleText' },
      createElement('span', { className: 'dsh_notification_toggleLabel' }, props.label),
      props.desc === undefined ? null : createElement('span', { className: 'dsh_notification_toggleDesc' }, props.desc),
    ),
  )
}

/** 一条可编辑的 include/exclude 规则行。 */
function RuleRow(props: {
  readonly rule: NotificationRule
  readonly errorKey?: RuleErrorKey
  readonly autoFocus: boolean
  readonly onPatch: (patch: Partial<NotificationRule>) => void
  readonly onRemove: () => void
}): ReactElement {
  const rule = props.rule
  return createElement(
    'div',
    { className: 'dsh_notification_ruleRow' },
    createElement(
      'select',
      {
        className: 'dsh_notification_ruleSelect',
        value: rule.mode,
        'aria-label': COPY['settings.rules.mode.include'],
        onChange: (event) => { props.onPatch({ mode: event.target.value === 'exclude' ? 'exclude' : 'include' }) },
      },
      createElement('option', { value: 'include' }, COPY['settings.rules.mode.include']),
      createElement('option', { value: 'exclude' }, COPY['settings.rules.mode.exclude']),
    ),
    createElement('input', {
      type: 'text',
      className: 'dsh_notification_ruleInput',
      placeholder: COPY['settings.rules.patternPlaceholder'],
      value: rule.pattern,
      autoFocus: props.autoFocus,
      onChange: (event) => { props.onPatch({ pattern: event.target.value }) },
    }),
    createElement(
      'label',
      { className: 'dsh_notification_ruleCheck' },
      createElement('input', {
        type: 'checkbox',
        checked: rule.isRegex,
        onChange: (event) => { props.onPatch({ isRegex: event.target.checked }) },
      }),
      COPY['settings.rules.regex'],
    ),
    createElement(
      'label',
      { className: 'dsh_notification_ruleCheck' },
      createElement('input', {
        type: 'checkbox',
        checked: rule.caseSensitive,
        onChange: (event) => { props.onPatch({ caseSensitive: event.target.checked }) },
      }),
      COPY['settings.rules.case'],
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'dsh_notification_ruleDelete',
        'aria-label': COPY['settings.rules.remove'],
        onClick: props.onRemove,
      },
      createElement(
        'svg',
        { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
        createElement('path', {
          fill: 'currentColor',
          d: 'M4.2 3.5h7.6l-.7 9.2a1 1 0 0 1-1 .8H5.9a1 1 0 0 1-1-.8l-.7-9.2Zm.9 1 .6 8h4.6l.6-8H5.1ZM6 1h4v1H6V1Zm-3 2h10v1H3V3Z',
          fillRule: 'evenodd',
        }),
      ),
    ),
    props.errorKey === undefined ? null : createElement('span', { className: 'dsh_notification_error' }, COPY[props.errorKey]),
  )
}

/** 卡片标题区。 */
function heading(): ReactElement {
  return createElement(
    'div',
    { className: 'dsh_notification_heading' },
    createElement('h2', { id: 'dsh-notification-settings-title', className: 'dsh_notification_title' }, COPY['settings.title']),
    createElement('p', { className: 'dsh_notification_subtitle' }, COPY['settings.subtitle']),
  )
}

/** 一张卡片（标题/说明可选，与上游 `.dsh_notification_card` 结构一致）。 */
function cardEl(title: string | null, desc: string | null, ...body: ReactNode[]): ReactElement {
  return createElement(
    'div',
    { className: 'dsh_notification_card' },
    title === null
      ? null
      : createElement(
        'div',
        null,
        createElement('div', { className: 'dsh_notification_cardTitle' }, title),
        desc === null ? null : createElement('div', { className: 'dsh_notification_cardDesc' }, desc),
      ),
    ...body,
  )
}

/**
 * 渲染整张卡片。
 * @param props - 注入面（`face` 由模块 client 入口经槽位 `inject` 提供）。
 * @returns 卡片元素。
 */
export function NotificationCard(props: NotificationCardProps): ReactElement {
  const face = props.face
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<NotificationRule[] | null>(null)
  const [focusedRuleId, setFocusedRuleId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** 测试通知按钮状态（idle → sending → sent/failed）。 */
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  /** 音效上传状态（null = 空闲；'uploading' = 读取/上传中）。 */
  const [soundState, setSoundState] = useState<'idle' | 'uploading'>('idle')
  /** 隐藏的 file input（浏览器要求 click 必须来自用户手势，用 ref 触发）。 */
  const soundInputRef = useRef<HTMLInputElement | null>(null)

  /** 用户在文件选择器里选中文件 → 预检编码 → 上传 → host 落盘并更新设置 → 回读刷新。 */
  const onSoundPicked = (file: File | undefined | null): void => {
    if (!file) return
    setSoundState('uploading')
    setNotice(null)
    fileToSoundUpload(file)
      .then(payload => {
        if (!payload.ok) {
          // 预检失败（类型/大小/空文件）：可区分联合的 ok:false 分支必带用户可读原因
          setNotice(payload.error)
          setSoundState('idle')
          return
        }
        return face.sound.upload({ name: payload.name, dataBase64: payload.dataBase64 })
          .then(result => {
            if (result.ok) {
              face.logger.info(`[card] 音效已上传：${payload.name}`)
              load() // host 已写入 soundPath/soundName，回读刷新当前文件展示
            } else {
              face.logger.warn(`[card] 音效上传被 host 拒绝：${result.error}`)
              setNotice(result.error)
            }
          })
      })
      .catch(error => {
        face.logger.warn(`[card] 音效上传失败：${String(error)}`)
        setNotice(`音效上传失败：${String(error)}`)
      })
      .finally(() => { setSoundState('idle') })
  }

  /** 发一条真实托盘通知验证整条链路（旧卡片的「发送测试通知」在新通道上的等价物）。 */
  const sendTest = (): void => {
    setTestState('sending')
    face.test.send()
      .then(ok => { setTestState(ok ? 'sent' : 'failed') })
      .catch(error => {
        face.logger.warn(`[card] 测试通知请求失败：${String(error)}`)
        setTestState('failed')
      })
  }

  /** 回读 host 侧真值（首载与"写入被拒绝后回滚界面"共用）。 */
  const load = (): void => {
    face.settings.get()
      .then(next => {
        if (next === undefined) {
          // 打点进 host 日志：排查"设置页为什么显示未启用"时，这条是唯一线索
          face.logger.warn('[card] 通知模块不可用：设置读取被拒（modules.notifications=false 或未就绪）')
          setLoadError(COPY['settings.moduleUnavailable'])
          return
        }
        face.logger.info('[card] 通知设置已载入（卡片渲染成功）')
        setLoadError(null)
        setSettings(next)
      })
      .catch(error => {
        face.logger.warn(`[card] 设置读取失败：${String(error)}`)
        setLoadError(`${COPY['settings.loadFailed']}：${String(error)}`)
      })
  }

  useEffect(() => { load() }, [])

  /** 开关类写入：乐观更新 + host 拒绝时回读（避免界面停留在假状态）。 */
  const apply = (patch: Partial<NotificationSettings>): void => {
    setSettings(prev => (prev === null ? prev : { ...prev, ...patch }))
    setNotice(null)
    face.settings.set(patch)
      .then(accepted => {
        if (accepted) return
        face.logger.warn('[card] 开关写入被 host 拒绝（设置服务不可用）')
        setNotice(COPY['settings.saveFailed'])
        load()
      })
      .catch(error => {
        setNotice(`${COPY['settings.saveFailed']}：${String(error)}`)
        load()
      })
  }

  const durable = settings?.rules ?? []
  const rules = draft ?? durable
  const dirty = draft !== null
  const error = firstRuleError(rules)

  const edit = (updater: (current: readonly NotificationRule[]) => NotificationRule[]): void => {
    setDraft(updater(draft ?? durable))
  }
  const addRule = (): void => {
    const rule = emptyRule()
    edit(list => [...list, rule])
    setFocusedRuleId(rule.id)
  }
  const saveRules = (): void => {
    if (draft === null) return
    setNotice(null)
    face.settings.set({ rules: draft })
      .then(accepted => {
        if (accepted) {
          setDraft(null)
          setFocusedRuleId(null)
          return
        }
        face.logger.warn('[card] 规则写入被 host 拒绝（规则非法或设置服务不可用）')
        setNotice(COPY['settings.saveFailed'])
      })
      .catch(error0 => { setNotice(`${COPY['settings.saveFailed']}：${String(error0)}`) })
  }

  // 设置未到手前不渲染开关：非受控 checkbox 一旦早绑定到默认值，界面就会撒谎
  if (settings === null) {
    return createElement(
      'section',
      { className: 'dsh_notification_section' },
      heading(),
      cardEl(
        null,
        null,
        createElement(
          'div',
          { className: loadError === null ? 'dsh_notification_empty' : 'dsh_notification_error' },
          loadError ?? COPY['settings.loading'],
        ),
      ),
    )
  }

  return createElement(
    'section',
    { className: 'dsh_notification_section', 'aria-labelledby': 'dsh-notification-settings-title' },
    heading(),

    cardEl(
      null,
      null,
      createElement(Toggle, {
        defaultChecked: settings.enabled,
        label: COPY['settings.enabled'],
        desc: COPY['settings.enabledDesc'],
        onChange: (checked) => { apply({ enabled: checked }) },
      }),
    ),

    // 测试通知（旧卡片有，重写时误删后按用户要求加回）：一键验证投递链路，排错第一站
    cardEl(
      COPY['settings.test.title'],
      COPY['settings.test.desc'],
      createElement(
        'div',
        { className: 'dsh_notification_rulesFooter' },
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh_notification_button dsh_notification_buttonPrimary',
            disabled: testState === 'sending',
            onClick: sendTest,
          },
          testState === 'sending' ? COPY['settings.test.sending'] : COPY['settings.test.send'],
        ),
        testState === 'sent'
          ? createElement('span', { className: 'dsh_notification_hint' }, COPY['settings.test.sent'])
          : testState === 'failed'
            ? createElement('span', { className: 'dsh_notification_error' }, COPY['settings.test.failed'])
            : null,
      ),
    ),

    // 提示音（v1.0.0 自定义音效）：模式下拉 + 自定义时的文件选择器。
    // 放在测试通知后面：配完音效紧接着点「发送测试通知」就能试听。
    cardEl(
      COPY['settings.sound.title'],
      COPY['settings.sound.subtitle'],
      createElement(
        'select',
        {
          className: 'dsh_notification_ruleSelect',
          value: settings.sound,
          'aria-label': COPY['settings.sound.title'],
          onChange: (event) => { apply({ sound: event.target.value as NotificationSoundMode }) },
        },
        SOUND_OPTIONS.map(option => createElement('option', { key: option.value, value: option.value }, option.label)),
      ),
      settings.sound === 'custom'
        ? createElement(
            'div',
            { className: 'dsh_notification_rulesFooter' },
            // 浏览器安全模型拿不到文件绝对路径，故产品形态 = 选文件 → 上传副本：
            // file input 隐藏（原生控件丑且不可定制），由按钮代为触发（click 必须来自用户手势）。
            createElement('input', {
              ref: soundInputRef,
              type: 'file',
              accept: '.wav,.mp3,.wma',
              'aria-label': COPY['settings.sound.pick'],
              style: { display: 'none' },
              onChange: (event) => {
                onSoundPicked(event.target.files?.[0])
                event.target.value = '' // 清空后同一文件可重复选择（否则 change 不再触发）
              },
            }),
            createElement(
              'button',
              {
                type: 'button',
                className: 'dsh_notification_button dsh_notification_buttonGhost',
                disabled: soundState === 'uploading',
                onClick: () => { soundInputRef.current?.click() },
              },
              soundState === 'uploading' ? COPY['settings.sound.picking'] : COPY['settings.sound.pick'],
            ),
            createElement(
              'span',
              { className: 'dsh_notification_hint' },
              settings.soundName === ''
                ? COPY['settings.sound.nonePicked']
                : `${COPY['settings.sound.current']}${settings.soundName}`,
            ),
          )
        : null,
    ),

    cardEl(
      COPY['settings.pending.title'],
      COPY['settings.pending.subtitle'],
      createElement(
        'div',
        { className: 'dsh_notification_grid' },
        PENDING.map(entry => createElement(Toggle, {
          key: entry.field,
          defaultChecked: settings[entry.field],
          label: entry.label,
          onChange: (checked) => { apply(notifyPatch(entry.field, checked)) },
        })),
      ),
    ),

    cardEl(
      COPY['settings.when.title'],
      COPY['settings.when.subtitle'],
      createElement(
        'div',
        { className: 'dsh_notification_grid' },
        OUTCOMES.map(entry => createElement(Toggle, {
          key: entry.field,
          defaultChecked: settings[entry.field],
          label: entry.label,
          onChange: (checked) => { apply(notifyPatch(entry.field, checked)) },
        })),
      ),
    ),

    cardEl(
      COPY['settings.rules.title'],
      COPY['settings.rules.subtitle'],
      rules.length === 0
        ? createElement('div', { className: 'dsh_notification_empty' }, COPY['settings.rules.empty'])
        : createElement(
          'div',
          { className: 'dsh_notification_rules' },
          rules.map((rule, index) => createElement(RuleRow, {
            key: rule.id,
            rule,
            autoFocus: rule.id === focusedRuleId,
            errorKey: error !== undefined && error.index === index ? error.key : undefined,
            onPatch: (patch) => { edit(list => patchRule(list, rule.id, patch)) },
            onRemove: () => { edit(list => removeRule(list, rule.id)) },
          })),
        ),
      createElement(
        'div',
        { className: 'dsh_notification_rulesFooter' },
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh_notification_button dsh_notification_buttonGhost',
            onClick: addRule,
          },
          COPY['settings.rules.add'],
        ),
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh_notification_button dsh_notification_buttonPrimary',
            disabled: !dirty || error !== undefined,
            title: !dirty || error !== undefined
              ? (error !== undefined ? COPY[error.key] : COPY['settings.rules.saveHint'])
              : undefined,
            onClick: saveRules,
          },
          COPY['settings.rules.save'],
        ),
        error !== undefined
          ? createElement('span', { className: 'dsh_notification_error' }, COPY[error.key])
          : dirty
            ? createElement('span', { className: 'dsh_notification_unsavedHint' }, COPY['settings.rules.unsaved'])
            : null,
      ),
    ),

    cardEl(
      COPY['settings.advanced.title'],
      null,
      createElement(Toggle, {
        defaultChecked: settings.requireInteraction,
        label: COPY['settings.advanced.requireInteraction'],
        desc: COPY['settings.advanced.requireInteractionDesc'],
        onChange: (checked) => { apply({ requireInteraction: checked }) },
      }),
      createElement(Toggle, {
        defaultChecked: settings.backgroundOnly,
        label: COPY['settings.advanced.backgroundOnly'],
        desc: COPY['settings.advanced.backgroundOnlyDesc'],
        onChange: (checked) => { apply({ backgroundOnly: checked }) },
      }),
    ),

    notice === null ? null : createElement('p', { className: 'dsh_notification_error' }, notice),
  )
}
