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

export const orderItemSchema = Joi.object({
  product_id: Joi.number().integer().min(1).required(),
  quantity: Joi.number().integer().min(1).max(5000).required()
})

export const createOrderSchema = Joi.object({
  items: Joi.array().items(orderItemSchema).min(1).max(100).required(),
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
  clear_cart: Joi.boolean().optional(),
  user_info: Joi.object().unknown(true).optional()
})

export const createPartnerOrderSchema = Joi.object({
  items: Joi.array().items(orderItemSchema).min(1).max(100).required(),
  notes: Joi.string().allow('').max(500).default(''),
  partner_address_id: Joi.number().integer().min(1).required()
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
