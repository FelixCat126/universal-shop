/**
 * 通用短信发送服务（第 55 轮）
 * ============================
 *
 * ## 为什么要有这一层
 *
 * 之前短信只有**一个用途**：密码重置的 OTP，写在 `passwordResetService.deliverOtp` 里，
 * 文案是**英文硬编码**，且逻辑与"业务事件"无关。
 *
 * 但泰国商城的短信是刚需 —— 用户下了单，货发出去了，他得知道。
 * 于是需要一个能承担业务事件的通用发送器：
 *
 *   - **多语言**：按收件号码的区号选语言（+66 泰语 / +86 中文 / 其它英文）
 *   - **模板化**：事件 → 模板 → 变量替换，文案集中在一处
 *   - **防轰炸**：同���号码 + 同模板有冷却，避免订单状态连跳时把用户刷屏（还烧钱）
 *   - **留痕**：每次发送都落库 —— 客户说"没收到短信"时，能查到底是没发还是没到
 *   - **不影响业务**：发送失败只记日志，业务照常成功
 *
 * ## 与密码重置的关系
 *
 * 密码重置**必须**发短信才能完成（OTP 是流程的一部分），所以它没配置通道时
 * 仍然抛 503（与第 50 轮之前的行为一致）。
 * 业务事件短信则是**锦上添花**：没配置就静默跳过，绝不影响下单/发货。
 *
 * ## 通道协议
 *
 * 沿用既有的聚合器 webhook（`SMS_WEBHOOK_URL`），body 保持向后兼容：
 *
 * ```json
 * { "country_code": "+66", "phone": "0812345678", "message": "..." }
 * ```
 *
 * 额外带两个可选字段（聚合器不认识可以忽略）：`template`、`locale`。
 */
import { logger } from '../utils/logger.js'
import SmsLog from '../models/SmsLog.js'
import SystemConfig from '../models/SystemConfig.js'

/** 短信事件 → 模板 key */
export const SMS_EVENTS = {
  PASSWORD_RESET: 'password_reset',
  ORDER_SHIPPED: 'order_shipped',
  ORDER_DELIVERED: 'order_delivered',
  ORDER_CANCELLED: 'order_cancelled',
  AFTER_SALE_REVIEWED: 'after_sale_reviewed'
}

/**
 * 模板文案（三种语言）。
 *
 * 为什么模板在代码里而不是数据库：短信文案是**产品的一部分**，
 * 改动需要走代码评审（避免线上发错内容）。运营想调的是
 * "开不开、发哪些事件"（那是 `system_configs` 里的开关），不是文案本身。
 *
 * 变量用 `{name}` 占位，渲染时做**白名单替换**（只替换已知变量，
 * 不做通用模板引擎 —— 短信模板不需要那么强）。
 */
export const SMS_TEMPLATES = {
  [SMS_EVENTS.PASSWORD_RESET]: {
    'zh-CN': 'Universal Shop 密码重置验证码：{otp}，{minutes} 分钟内有效。',
    'en-US': 'Your Universal Shop password reset code is {otp}. Valid for {minutes} minutes.',
    'th-TH': 'รหัสรีเซ็ตรหัสผ่านของ Universal Shop คือ {otp} ใช้ได้ {minutes} นาที'
  },
  /**
   * 可选变量的模板用**函数**写。
   *
   * 为什么不用字符串模板：字符串模板只能做"变量替换"，
   * 变量为空时只能留下 "{tracking_number}" 这种**占位符给用户看** ——
   * 客户收到"物流单号：{tracking_number}"，比不发短信还糟。
   * 函数模板能整句去掉（"没有单号就不提单号"）。
   */
  [SMS_EVENTS.ORDER_SHIPPED]: {
    'zh-CN': (v) => [
      `订单 ${v.order_no || ''} 已发货。`,
      v.contact_name ? `收货人：${v.contact_name}。` : '',
      v.tracking_number ? `物流单号：${v.tracking_number}。` : ''
    ].filter(Boolean).join(''),
    'en-US': (v) => [
      `Your order ${v.order_no || ''} has shipped.`,
      v.contact_name ? `Recipient: ${v.contact_name}.` : '',
      v.tracking_number ? `Tracking: ${v.tracking_number}.` : ''
    ].filter(Boolean).join(' '),
    'th-TH': (v) => [
      `คำสั่งซื้อ ${v.order_no || ''} จัดส่งแล้ว`,
      v.contact_name ? `ผู้รับ: ${v.contact_name}` : '',
      v.tracking_number ? `เลขพัสดุ์: ${v.tracking_number}` : ''
    ].filter(Boolean).join(' ')
  },
  [SMS_EVENTS.ORDER_DELIVERED]: {
    'zh-CN': '订单 {order_no} 已送达，感谢您的购买。',
    'en-US': 'Your order {order_no} has been delivered. Thank you for shopping with us.',
    'th-TH': 'คำสั่งซื้อ {order_no} ส่งถึงแล้ว ขอบคุณที่ช้อปกับเรา'
  },
  [SMS_EVENTS.ORDER_CANCELLED]: {
    'zh-CN': '订单 {order_no} 已取消。如有疑问请联系客服。',
    'en-US': 'Your order {order_no} has been cancelled. Please contact us if you have questions.',
    'th-TH': 'คำสั่งซื้อ {order_no} ถูกยกเลิก หากมีข้อสงสัยโปรดติดต่อฝ่ายบริการ'
  },
  [SMS_EVENTS.AFTER_SALE_REVIEWED]: {
    'zh-CN': (v) => `您的售后申请（订单 ${v.order_no || ''}）处理结果：${v.result || ''}。${v.note || ''}`.trim(),
    'en-US': (v) => `Your after-sales request (order ${v.order_no || ''}) was ${v.result || ''}. ${v.note || ''}`.trim(),
    'th-TH': (v) => `คำขอหลังการขาย (คำสั่งซื้อ ${v.order_no || ''}) ผลลัพธ์: ${v.result || ''} ${v.note || ''}`.trim()
  }
}

/** 售后结论的中文/英文/泰文说法（作为变量传入模板） */
const AFTER_SALE_RESULT_TEXT = {
  approved: { 'zh-CN': '已通过', 'en-US': 'approved', 'th-TH': 'อนุมัติแล้ว' },
  rejected: { 'zh-CN': '已驳回', 'en-US': 'declined', 'th-TH': 'ปฏิเสธ' },
  received: { 'zh-CN': '退货已入库', 'en-US': 'return received', 'th-TH': 'รับสินค้าคืนแล้ว' }
}

/** 区号 → 语言 */
function localeForCountryCode (countryCode) {
  if (countryCode === '+66') return 'th-TH'
  if (countryCode === '+86') return 'zh-CN'
  return 'en-US'
}

/**
 * 从手机号里拆出区号与号码。
 * 兼容两种写法：带区号（'+66812345678'）与不带（'0812345678'，按默认区号补）。
 *
 * @param {string} phone
 * @param {string} [defaultCountryCode]
 * @returns {{ countryCode: string, phone: string } | null}
 */
export function splitPhone (phone, defaultCountryCode = '+66') {
  if (!phone) return null
  const raw = String(phone).trim()
  if (!raw) return null

  for (const code of ['+86', '+66', '+60']) {
    if (raw.startsWith(code)) {
      return { countryCode: code, phone: raw.slice(code.length) }
    }
  }
  // 不带区号：按默认补上
  if (/^\d{6,15}$/.test(raw)) {
    return { countryCode: defaultCountryCode, phone: raw }
  }
  return null
}

/**
 * 渲染模板。
 *
 * 模板可以是**字符串**（`{name}` 占位），也可以是**函数**（vars → string）：
 *   - 字符串：变量总是有的场景（OTP）
 *   - 函数：变量可能为空、且为空时整句都不该出现的场景（物流单号、售后备注）
 *
 * 字符串模板里：已知但为空的变量渲染成空串；**未知**变量原样保留
 * （保留是为了暴露写错的变量名，而不是悄悄吞掉）。
 */
export function renderTemplate (template, vars = {}) {
  if (typeof template === 'function') return String(template(vars || {}) || '')
  return String(template || '').replace(/\{(\w+)\}/g, (m, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return m
    const v = vars[key]
    return v === undefined || v === null ? '' : String(v)
  })
}

/** 通道是否已配置 */
export function isSmsChannelConfigured () {
  return Boolean(process.env.SMS_WEBHOOK_URL)
}

/**
 * 业务短信是否开启 + 哪些事件允许发。
 *
 * 两道闸（**环境变量优先**，设了就盖过系统配置）：
 *   1. 环境变量 `SMS_BUSINESS_ENABLED` —— 部署时的总开关
 *      （留空 = 交给系统配置；这是"紧急时用环境变量一键掐掉"的兜底）
 *   2. 系统配置 `sms_business_enabled` —— 运营可在管理端随时关掉
 *
 * 两处都没配 = **默认不发**（保守：新功能默认不花钱、不打扰用户）。
 *
 * 事件白名单 `sms_business_events`（系统配置，逗号分隔）——
 * 运营可以只发"发货"，不发其它。
 *
 * @returns {Promise<{ enabled: boolean, events: string[] }>}
 */
export async function getBusinessSmsPolicy () {
  const envEnabled = String(process.env.SMS_BUSINESS_ENABLED || '').trim()
  const envEvents = String(process.env.SMS_BUSINESS_EVENTS || '').trim()

  /**
   * 两个键**一条查询**读回来。
   *
   * 逐键读是两条查询；批量改订单状态时这个函数会被调到，
   * 多出的查询会顶破"批量操作查询数不线性膨胀"的门禁。
   */
  const cfg = await SystemConfig.getConfigs(['sms_business_enabled', 'sms_business_events'])
  const cfgEnabled = cfg.sms_business_enabled ?? null
  const cfgEvents = cfg.sms_business_events ?? null

  const enabled = envEnabled !== ''
    ? envEnabled !== '0' && envEnabled.toLowerCase() !== 'false'
    : cfgEnabled !== null && cfgEnabled !== undefined
      ? String(cfgEnabled) !== 'false' && String(cfgEnabled) !== '0'
      : false

  const rawEvents = cfgEvents != null && String(cfgEvents).trim() !== ''
    ? String(cfgEvents)
    : (envEvents || '')

  let events = rawEvents
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e && Object.values(SMS_EVENTS).includes(e))

  /**
   * 白名单为空时用**默认事件集**。
   *
   * 为什么不"开了开关但什么都不发"：那样运营会开完开关发现一条都没出去，
   * 以为坏了。而且"开了总开关"这个动作本身就表达了"我要发短信"的意图。
   *
   * 默认集只含**用户最需要知道**的两条：发货、售后结论。
   * 送达/取消量最大且价值低 → 要发得运营显式勾选。
   */
  if (!events.length && enabled) {
    events = [SMS_EVENTS.ORDER_SHIPPED, SMS_EVENTS.AFTER_SALE_REVIEWED]
  }

  return { enabled, events }
}

/**
 * 同一号码 + 同一模板的发送冷却（毫秒）。
 *
 * 为什么要：订单状态连跳（pending→shipping→shipped→delivered）会连发好几条，
 * 用户被刷屏、还烧短信费。默认 5 分钟内同一事件不重复发。
 */
function cooldownMs () {
  const n = Number(process.env.SMS_COOLDOWN_SECONDS)
  return (Number.isFinite(n) && n >= 0 ? n : 300) * 1000
}

/**
 * 发送冷却表（进程内）：key = `${phone}:${template}:${dedupeKey}` → 上次发送时间戳
 *
 * **dedupeKey 是"同一件事"的标识**（订单号、售后单号……）。
 *
 * 为什么需要它：冷却的本意是"同一订单状态连跳时别刷屏"，
 * 但如果只按"号码 + 模板"算，同一个客户**两单在 5 分钟内先后发货**，
 * 第二单会被第一单的冷却挡掉 —— 客户收不到第二单的通知，
 * 而且系统里还留着一条"已跳过"的记录，看起来像"发过了"。
 * 加了 dedupeKey 后：同一订单重复事件被挡，不同订单互不影响。
 */
const lastSentAt = new Map()

/** 冷却表上限（防止无限增长；超过就清掉过期项） */
const MAX_COOLDOWN_ENTRIES = 5000

function pruneCooldownTable () {
  if (lastSentAt.size <= MAX_COOLDOWN_ENTRIES) return
  const cutoff = Date.now() - cooldownMs()
  for (const [k, t] of lastSentAt) {
    if (t < cutoff) lastSentAt.delete(k)
  }
}

/**
 * 发送一条短信（best-effort，**永不抛错**）。
 *
 * @param {object} opts
 * @param {string} opts.phone        收件号码（可带区号）
 * @param {string} [opts.countryCode] 区号（不带区号时用它补）
 * @param {string} opts.template     模板 key（SMS_EVENTS 之一）
 * @param {object} [opts.vars]       模板变量
 * @param {string} [opts.locale]     强制语言（默认按区号推断）
 * @param {boolean} [opts.require]   true = 发送失败要抛错（密码重置用）
 * @param {string} [opts.dedupeKey]  "同一件事"的标识（订单号等），参与冷却判定
 * @returns {Promise<{ sent: boolean, reason?: string, message?: string }>}
 */
export async function sendSms ({ phone, countryCode, template, vars = {}, locale, require = false, dedupeKey = '' }) {
  const split = splitPhone(phone, countryCode || '+66')
  if (!split) {
    if (require) {
      const err = new Error('手机号格式无效')
      err.status = 400
      throw err
    }
    return { sent: false, reason: 'invalid_phone' }
  }

  const tpl = SMS_TEMPLATES[template]
  if (!tpl) {
    if (require) {
      const err = new Error(`未知的短信模板：${template}`)
      err.status = 500
      throw err
    }
    return { sent: false, reason: 'unknown_template' }
  }

  const loc = locale || localeForCountryCode(split.countryCode)
  const message = renderTemplate(tpl[loc] || tpl['en-US'], vars)

  // 通道没配：
  //   - 生产：require 时抛 503（OTP 是流程的一部分，没有短信就没法重置）
  //   - 开发/测试：返回 false，由调用方把 OTP 透出给前端（沿用第 55 轮之前的行为）
  //   - 业务事件：静默跳过，绝不影响下单/发货
  if (!isSmsChannelConfigured()) {
    if (require && process.env.NODE_ENV === 'production') {
      const err = new Error('短信服务未配置，暂时无法发送短信')
      err.status = 503
      throw err
    }
    /**
     * 这里**不写留痕**。
     *
     * 理由："通道没配"是**部署级状态**（要么有、要么没有），
     * 不是"这一条消息发生了什么"。管理端会直接提示"通道尚未配置"。
     *
     * 写成行的话：批量取消 10 单 = 10 行"跳过：通道没配"的噪音，
     * 而且是**随订单数线性增长**的写 —— 批量取消的查询门禁
     * （bulkCancelResources BC-5）就是被这个撑爆的。
     */
    return { sent: false, reason: 'channel_not_configured', message }
  }

  // 防轰炸：同号码 + 同模板 + 同一件事，在冷却期内不重复发
  const key = `${split.countryCode}${split.phone}:${template}:${dedupeKey || ''}`
  const last = lastSentAt.get(key) || 0
  const cool = cooldownMs()
  if (cool > 0 && Date.now() - last < cool) {
    await recordSmsLog({ phone: split.phone, countryCode: split.countryCode, template, locale: loc, message, status: 'skipped', reason: 'cooldown' })
    return { sent: false, reason: 'cooldown', message }
  }

  const timeoutMs = Number(process.env.SMS_TIMEOUT_MS) || 8000
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetch(process.env.SMS_WEBHOOK_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.SMS_WEBHOOK_TOKEN
            ? { Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` }
            : {})
        },
        body: JSON.stringify({
          country_code: split.countryCode,
          phone: split.phone,
          message,
          // 聚合器不认识这两个字段可以忽略 —— 便于按模板统计
          template,
          locale: loc
        })
      })
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      throw new Error(`短信通道返回 ${response.status}`)
    }

    pruneCooldownTable()
    lastSentAt.set(key, Date.now())
    await recordSmsLog({ phone: split.phone, countryCode: split.countryCode, template, locale: loc, message, status: 'sent' })
    return { sent: true, message }
  } catch (error) {
    logger.error('发送短信失败', { template, err: error?.message })
    await recordSmsLog({
      phone: split.phone,
      countryCode: split.countryCode,
      template,
      locale: loc,
      message,
      status: 'failed',
      reason: String(error?.message || error).slice(0, 200)
    })
    if (require) {
      const err = new Error('短信发送失败，请稍后重试')
      err.status = 502
      throw err
    }
    return { sent: false, reason: 'send_failed', message }
  }
}

/**
 * 写发送留痕。
 *
 * 留痕不是为了统计，是为了**排查**："客户说没收到短信"时，
 * 能查到底是没发（status=skipped）、发失败（status=failed）还是发出去了（status=sent）。
 *
 * 只有**真的走到通道**的发送才留痕（sent / failed / 冷却跳过）；
 * "通道没配"不写行 —— 那是部署级状态，管理端有提示，
 * 逐条写行只会随订单数线性膨胀（见 sendSms 里的说明）。
 */
async function recordSmsLog ({ phone, countryCode, template, locale, message, status, reason = null }) {
  try {
    await SmsLog.create({
      phone,
      country_code: countryCode,
      template,
      locale,
      message: String(message || '').slice(0, 500),
      status,
      reason
    })
  } catch (error) {
    // 留痕失败不影响主流程
    logger.error('写短信留痕失败（不影响发送）', { template, err: error?.message })
  }
}

/**
 * 发"售后审核结论"短信（业务事件专用：把状态翻译成对应语言的词）。
 */
export async function sendAfterSaleReviewedSms ({ phone, countryCode, orderNo, status, note, dedupeKey }) {
  const loc = localeForCountryCode(countryCode || '+66')
  const result = (AFTER_SALE_RESULT_TEXT[status] || {})[loc] || status
  return sendSms({
    phone,
    countryCode,
    template: SMS_EVENTS.AFTER_SALE_REVIEWED,
    locale: loc,
    vars: {
      order_no: orderNo || '',
      result,
      note: note || ''
    },
    dedupeKey
  })
}
