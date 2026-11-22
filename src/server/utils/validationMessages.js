/**
 * 校验错误的人话化（第 48 轮）
 * ===============================
 *
 * ## 原来是什么样
 *
 * `validate.js` 把 joi 的原始报错直接拼给用户：
 *
 *   "phone" with value "12" fails to match the required pattern: /^[1-9]\d{7,14}$/
 *   "referral_code" length must be at least 4 characters long
 *
 * 三个问题：
 *   1. **英文 + 正则** —— 终端买家（尤其泰文用户）看到的是天书
 *   2. **看不出是哪个字段** —— 前端无法把错误标到具体表单项上
 *   3. **看不出该怎么做** —— "must be at least 4 characters" 没说"填 4-32 位字母或数字"
 *
 * ## 现在的做法
 *
 * 每条错误输出两样东西：
 *   - `field`：字段路径（如 `contact_phone`、`items[0].quantity`）—— **这是给前端用的契约**
 *   - `message`：可读的中文兜底（前端若认识这个字段，会用自己语言的说法替换）
 *
 * 前端只要拿 `field` 去匹配自己的表单项，就能：
 *   - 把红框标到那一栏（而不是弹一条看不懂的 toast）
 *   - 用**自己的语言**说这句话（前端有 i18n，后端没有 Accept-Language 处理）
 */

/** 字段名 → 中文标签（前端认得这个字段时，会用自己的 i18n 文案替换） */
const FIELD_LABELS = {
  id: 'ID',
  username: '用户名',
  nickname: '昵称',
  email: '邮箱',
  phone: '手机号',
  country_code: '国家/区号',
  referral_code: '推荐码',
  referred_by_code: '推荐码',
  password: '密码',
  old_password: '当前密码',
  new_password: '新密码',
  confirmPassword: '确认密码',
  contact_name: '收货人姓名',
  contact_phone: '联系电话',
  contact_country_code: '国家/区号',
  province: '省',
  city: '市',
  district: '区/县',
  detail_address: '详细地址',
  postal_code: '邮编',
  address_type: '地址类型',
  address_id: '地址',
  is_default: '默认地址',
  items: '商品明细',
  quantity: '数量',
  price: '价格',
  product_id: '商品',
  bundle_id: '组合套餐',
  discount_percent: '折扣比例',
  points: '积分',
  stock: '库存',
  template_id: '券模板',
  user_id: '用户',
  user_ids: '用户',
  title: '标题',
  name: '名称',
  description: '说明',
  content: '内容',
  reason: '原因',
  type: '类型',
  status: '状态',
  amount: '金额',
  min_spend: '最低消费',
  per_user: '每人限领',
  total: '总量',
  scope: '适用范围',
  valid_from: '生效时间',
  valid_to: '失效时间',
  category_id: '分类',
  alias: '别名',
  name_th: '泰文名称',
  display_name: '显示名称',
  account_kind: '账号类型',
  discount: '折扣',
  role: '角色',
  real_name: '姓名',
  client_order_key: '幂等键',
  notes: '备注',
  shipping_address: '收货地址',
  payment_method: '支付方式',
  user_coupon_id: '抵扣券',
  moq_unit: '起订量',
  moq_multiplier: '数量步长',
  delta: '调整值',
  admin_id: '管理员',
  action: '操作',
  resource: '资源',
  start_date: '开始日期',
  end_date: '结束日期'
}

/**
 * 从 joi 的错误路径里取出字段名。
 * joi 给的是 `items[0].quantity` 这种路径 → 取最后一段作为字段名。
 */
function fieldNameOf (path = []) {
  const last = path[path.length - 1]
  return typeof last === 'string' ? last : ''
}

/**
 * 字段的中文标签（认不出就用原始字段名，不编造）。
 */
export function fieldLabel (field) {
  if (!field) return ''
  const name = fieldNameOf(String(field).split(/[.[\]]+/).filter(Boolean))
  return FIELD_LABELS[name] || name
}

/**
 * 把一条 joi 错误翻译成可读中文。
 *
 * 不认识的类型不编造内容 —— 退回"「字段」不符合要求"，
 * 总比把 `object.base` 或英文正则甩给用户好。
 */
/** 是否含中日韩字符（用来判断"这是开发者自定义的消息"） */
function hasCJK (str) {
  return typeof str === 'string' && /[\u4e00-\u9fa5]/.test(str)
}

export function friendlyValidationMessage (detail) {
  /**
   * 开发者**自定义**的消息优先保留。
   *
   * 业务规则的消息（"不可重复""必须指定赠品"）比通用映射有用得多 ——
   * 第一版没保留，直接把这两条业务提示冲成了"「」不符合要求"，
   * 两个既有测试立刻红了（它们正是在守护这两条业务消息）。
   */
  if (hasCJK(detail?.message)) return detail.message

  const label = fieldLabel(detail?.path)
  const ctx = detail?.context || {}
  /**
   * joi 的 context 里，`limit` 本身就是数字（string.min → { limit: 2 }），
   * 数组/数字类也是；但 `length` 规则用的是 `ctx.length`。
   * （第一版写成 ctx.limit?.value → 一律 undefined → "至少要 undefined 个字符"）
   */
  // joi 的 context 里 limit 本身就是数字（string.length 也是 { limit: 4 }）
  const limit = ctx.limit ?? ctx.limit?.value
  const values = ctx.valids?.value

  switch (detail?.type) {
    case 'any.required':
      return `「${label}」是必填项`
    case 'string.empty':
      return `「${label}」不能为空`
    case 'string.min':
      return `「${label}」至少要 ${limit} 个字符`
    case 'string.max':
      return `「${label}」最多 ${limit} 个字符`
    case 'string.length':
      return `「${label}」必须是 ${limit} 个字符`
    case 'string.pattern.base':
      return `「${label}」格式不正确`
    case 'string.email':
      return `「${label}」不是有效的邮箱地址`
    case 'string.alphanum':
      return `「${label}」只能包含字母或数字`
    case 'number.min':
      return `「${label}」不能小于 ${limit}`
    case 'number.max':
      return `「${label}」不能大于 ${limit}`
    case 'number.integer':
      return `「${label}」必须是整数`
    case 'array.min':
      return `「${label}」至少要 ${limit} 项`
    case 'array.max':
      return `「${label}」最多 ${limit} 项`
    case 'any.only':
      return `「${label}」只能是 ${[].concat(values || []).join(' / ')} 之一`
    case 'alternatives.match':
    case 'alternatives.types':
    case 'object.missing':
      return `「${label}」需要填写其中一项`
    case 'object.base':
    case 'object.unknown':
      return `「${label}」的内容不正确`
    case 'xor':
      return `「${label}」需要二选一填写`
    default:
      return `「${label || '输入'}」不符合要求`
  }
}

/**
 * 把 joi 的错误列表转成 [{ field, message }]。
 *
 * @param {object} error joi 的 ValidationError
 * @returns {Array<{field: string, message: string}>}
 */
export function validationDetails (error) {
  const details = error?.details || []
  return details.map(d => ({
    // 字段路径（给前端定位用）：items[0].quantity
    field: (d.path || []).join('.'),
    // 可读中文（前端认得这个字段时，会用自己的语言替换）
    message: friendlyValidationMessage(d)
  }))
}

/**
 * 校验失败时的响应体（统一格式）。
 */
export function validationErrorBody (error) {
  const details = validationDetails(error)
  return {
    success: false,
    message: details.map(d => d.message).join('；'),
    code: 'VALIDATION_ERROR',
    // 字段级错误：前端据此把红框标到具体表单项
    details
  }
}
