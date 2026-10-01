/**
 * 通用 joi 校验中间件 + 公共校验规则
 * 以"白名单+裁剪"策略：未声明字段一律 stripUnknown，避免脏字段污染
 * 失败统一返回 400 + VALIDATION_ERROR
 */
import Joi from 'joi'

/**
 * @param {{ body?: Joi.Schema, query?: Joi.Schema, params?: Joi.Schema }} schemas
 */
export function validate (schemas) {
  return (req, res, next) => {
    for (const part of ['body', 'query', 'params']) {
      const schema = schemas[part]
      if (!schema) continue
      const { value, error } = schema.validate(req[part], {
        abortEarly: false,
        stripUnknown: true,
        convert: true
      })
      if (error) {
        return res.status(400).json({
          success: false,
          message: error.details.map((d) => d.message).join('; '),
          code: 'VALIDATION_ERROR'
        })
      }
      req[part] = value
    }
    next()
  }
}

export const phoneSchema = Joi.string().pattern(/^[1-9]\d{7,14}$/).required()
export const countryCodeSchema = Joi.string().valid('+86', '+66', '+60').default('+66')

// 批量库存查询（POST /api/products/check-stock）：公开端点，数组上限 1-200 个正整数防枚举风暴拖库
export const checkStockSchema = Joi.object({
  productIds: Joi.array().items(Joi.number().integer().min(1)).min(1).max(200).required()
})

export const orderItemSchema = Joi.object({
  product_id: Joi.number().integer().min(1).required(),
  quantity: Joi.number().integer().min(1).max(5000).required()
})

/**
 * 门户订单项（P4 组合包）：product_id（单品）与 bundle_id（组合包）二选一；
 * 合作方批发下单仍用上方 orderItemSchema（仅单品，不支持组合包）
 */
export const portalOrderItemSchema = Joi.object({
  product_id: Joi.number().integer().min(1).optional(),
  bundle_id: Joi.number().integer().min(1).optional(),
  quantity: Joi.number().integer().min(1).max(5000).required()
}).xor('product_id', 'bundle_id')

export const createOrderSchema = Joi.object({
  items: Joi.array().items(portalOrderItemSchema).min(1).max(100).required(),
  contact_name: Joi.string().min(1).max(100).required(),
  contact_phone: Joi.string().min(5).max(20).required(),
  delivery_address: Joi.string().min(1).max(500).required(),
  notes: Joi.string().allow('').max(500).default(''),
  // 前端可能传 ''/null/undefined：统一视作未填，避免 "must be a string" 误报
  referral_code: Joi.string().alphanum().min(4).max(32).empty(['', null]).optional(),
  address_id: Joi.number().integer().min(1).optional(),
  province: Joi.string().allow('').max(80).default(''),
  city: Joi.string().allow('').max(80).default(''),
  district: Joi.string().allow('').max(80).default(''),
  detail_address: Joi.string().allow('').max(300).default(''),
  postal_code: Joi.string().allow('').max(10).default(''),
  payment_method: Joi.string().valid('cod', 'online', 'points').default('cod'),
  checkout_currency: Joi.string().valid('THB', 'USD', 'CNY', 'MYR').optional(),
  // 抵扣券（P2，可选）：下单时核销；''/null 统一视作未填
  user_coupon_id: Joi.number().integer().min(1).empty([null, '']).optional(),
  // 客户端幂等键（可选）：同用户同 key 重复提交只成单一次；''/null 统一视作未填
  client_order_key: Joi.string().max(64).empty(['', null]).optional(),
  clear_cart: Joi.boolean().optional(),
  user_info: Joi.object().unknown(true).optional()
})

export const createPartnerOrderSchema = Joi.object({
  items: Joi.array().items(orderItemSchema).min(1).max(100).required(),
  notes: Joi.string().allow('').max(500).default(''),
  partner_address_id: Joi.number().integer().min(1).required(),
  // 客户端幂等键（可选）：同合作方同 key 重复提交只成单一次
  client_order_key: Joi.string().trim().max(64).empty(['', null]).optional()
})

// 订单试算（quote）：只算价不落库，商品口径与 createOrder 一致（支持组合包）
export const quoteOrderSchema = Joi.object({
  items: Joi.array().items(portalOrderItemSchema).min(1).max(100).required(),
  payment_method: Joi.string().valid('cod', 'online', 'points').default('cod'),
  checkout_currency: Joi.string().valid('THB', 'USD', 'CNY', 'MYR').optional(),
  // 抵扣券（P2，可选）：提供时必须已登录且券属于当前用户；''/null 统一视作未填
  user_coupon_id: Joi.number().integer().min(1).empty([null, '']).optional()
})

// 满减档位：min 门槛金额 / off 减免金额（THB），off 必须小于 min（不允许"减得比门槛多"）
const promotionTierSchema = Joi.object({
  min: Joi.number().greater(0).required(),
  off: Joi.number().greater(0).required()
}).custom((tier, helpers) => {
  if (!(tier.off < tier.min)) {
    return helpers.message('满减档位必须满足：减免金额小于门槛金额')
  }
  return tier
})

// threshold 规则：1-5 档
const promotionRulesSchema = Joi.object({
  tiers: Joi.array().items(promotionTierSchema).min(1).max(5).required()
})

// buy_x_get_y 规则（P3 买多赠一）：buy/get 整数 ≥1；gift_product_id 可选正整数
// （缺省时仅允许 scope 恰为单商品——下单时默认赠同品，跨字段约束见下方 custom）
const promotionBuyGetRulesSchema = Joi.object({
  buy: Joi.number().integer().min(1).required(),
  get: Joi.number().integer().min(1).required(),
  gift_product_id: Joi.number().integer().positive().empty([null, '']).optional()
})

// 适用范围：all 时 ids 可省；category/product 时必须给非空正整数数组
const promotionScopeSchema = Joi.object({
  type: Joi.string().valid('all', 'category', 'product').default('all'),
  ids: Joi.array().items(Joi.number().integer().positive()).min(1)
    .when('type', { is: 'all', then: Joi.optional(), otherwise: Joi.required() })
})

// 促销创建/更新（PUT 为全量替换，与创建同校验）；支持 threshold（满减）与 buy_x_get_y（买多赠一）
export const promotionPayloadSchema = Joi.object({
  type: Joi.string().valid('threshold', 'buy_x_get_y').default('threshold'),
  name: Joi.string().min(1).max(100).required(),
  // rules 结构随 type 分派：threshold=满减档位；buy_x_get_y=买赠
  rules: Joi.when('type', {
    is: 'buy_x_get_y',
    then: promotionBuyGetRulesSchema.required(),
    otherwise: promotionRulesSchema.required()
  }),
  scope: promotionScopeSchema.default({ type: 'all' }),
  start_at: Joi.date().iso().allow(null).optional(),
  end_at: Joi.date().iso().allow(null).optional(),
  priority: Joi.number().integer().default(0),
  status: Joi.string().valid('active', 'inactive').default('active')
}).custom((value, helpers) => {
  if (value.start_at && value.end_at && !(value.start_at < value.end_at)) {
    return helpers.message('生效时间必须满足：start_at 早于 end_at')
  }
  // 买多赠一：赠品缺省仅当 scope 恰为单商品（默认赠同品）；多品/全场/分类必须显式指定赠品商品
  if (value.type === 'buy_x_get_y' && value.rules?.gift_product_id == null) {
    const scopeType = value.scope?.type || 'all'
    const scopeIds = Array.isArray(value.scope?.ids) ? value.scope.ids : []
    if (scopeType !== 'product' || scopeIds.length !== 1) {
      return helpers.message('多品/全场/分类范围必须指定赠品商品（rules.gift_product_id）')
    }
  }
  return value
})

export const promotionStatusSchema = Joi.object({
  status: Joi.string().valid('active', 'inactive').required()
})

/**
 * 抵扣券模板（P2）创建/更新（PUT 为全量替换，与创建同校验）：
 * scope 复用 promotion 规则；min_spend>0 时面额不得超过门槛（不允许"减得比门槛多"）
 */
export const couponTemplatePayloadSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  amount: Joi.number().greater(0).required(),
  min_spend: Joi.number().min(0).default(0),
  total: Joi.number().integer().min(1).allow(null).default(null),
  per_user: Joi.number().integer().min(1).default(1),
  valid_from: Joi.date().iso().allow(null).optional(),
  valid_to: Joi.date().iso().allow(null).optional(),
  scope: promotionScopeSchema.default({ type: 'all' }),
  register_gift: Joi.boolean().default(false),
  status: Joi.string().valid('active', 'inactive').default('active')
}).custom((value, helpers) => {
  if (value.min_spend > 0 && !(value.amount <= value.min_spend)) {
    return helpers.message('抵扣券面额不能大于使用门槛（需满足 amount <= min_spend）')
  }
  if (value.valid_from && value.valid_to && !(value.valid_from < value.valid_to)) {
    return helpers.message('有效期必须满足：valid_from 早于 valid_to')
  }
  return value
})

export const couponTemplateStatusSchema = Joi.object({
  status: Joi.string().valid('active', 'inactive').required()
})

// 组合包组件（P4）：同一组合包内 product_id 不可重复（见 bundlePayloadSchema 的 custom）
const bundleItemInputSchema = Joi.object({
  product_id: Joi.number().integer().positive().required(),
  quantity: Joi.number().integer().min(1).max(999).required()
})

/**
 * 组合包创建/更新（PUT 为全量替换，与创建同校验）：
 * name 必填；price 有限数 >0（Joi.number 默认拒绝 NaN/Infinity）；
 * items 1-10 个、product_id 不重复；组件商品存在性由控制器查库校验
 */
export const bundlePayloadSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  name_th: Joi.string().max(100).empty(['', null]).optional(),
  description: Joi.string().max(2000).empty(['', null]).optional(),
  price: Joi.number().greater(0).required(),
  image: Joi.string().max(500).empty(['', null]).optional(),
  status: Joi.string().valid('active', 'inactive').default('active'),
  items: Joi.array().items(bundleItemInputSchema).min(1).max(10).required()
}).custom((value, helpers) => {
  const ids = value.items.map(it => it.product_id)
  if (new Set(ids).size !== ids.length) {
    return helpers.message('组合包组件商品不可重复')
  }
  return value
})

export const bundleStatusSchema = Joi.object({
  status: Joi.string().valid('active', 'inactive').required()
})

// 用户领券
export const couponClaimSchema = Joi.object({
  template_id: Joi.number().integer().min(1).required()
})

export const registerSchema = Joi.object({
  nickname: Joi.string().min(1).max(50).required(),
  country_code: countryCodeSchema,
  phone: phoneSchema,
  email: Joi.string().email().max(120).optional(),
  password: Joi.string().min(6).max(128).required(),
  referral_code: Joi.string().alphanum().min(4).max(32).empty(['', null]).optional()
})

export const loginSchema = Joi.object({
  email: Joi.string().email().max(120).optional(),
  country_code: Joi.string().valid('+86', '+66', '+60').optional(),
  phone: Joi.string().pattern(/^[1-9]\d{7,14}$/).optional(),
  password: Joi.string().min(1).max(128).required()
})
  .or('email', 'phone')
  .with('phone', 'country_code')
