/**
 * 从 Sequelize 模型自动推导 JSON Schema。
 *
 * 为什么要有：
 *   之前 docs/openapi.json 只是**路由骨架**（方法 + 路径），没有请求/响应体结构。
 *   骨架能回答"有哪些接口"，但回答不了"这个接口到底返回什么字段"——
 *   而后者才是前后端协作时真正会吵架的地方。
 *
 * 怎么做到不手写几百个 schema：
 *   Sequelize 的 rawAttributes 里已经带了类型、是否可空、ENUM 取值，
 *   模型的 attribute 上还写了 comment（中文说明）。
 *   这些信息直接映射成 JSON Schema 就行 —— 模型是唯一事实来源，
 *   改模型 → schema 自动跟着变，不会漂移。
 *
 * 用法：
 *   const schema = modelToSchema(Product, { name: 'Product' })
 *   // → { type: 'object', properties: { id: {...}, name: {...} }, required: [...] }
 */

/** Sequelize DataType key → JSON Schema type */
const TYPE_MAP = {
  INTEGER: 'integer',
  BIGINT: 'integer',
  SMALLINT: 'integer',
  TINYINT: 'integer',
  FLOAT: 'number',
  REAL: 'number',
  DOUBLE: 'number',
  DECIMAL: 'number',
  'DOUBLE PRECISION': 'number',
  STRING: 'string',
  CHAR: 'string',
  TEXT: 'string',
  UUID: 'string',
  DATE: 'string',
  DATEONLY: 'string',
  BOOLEAN: 'boolean',
  JSON: 'object',
  JSONB: 'object',
  ARRAY: 'array',
  BLOB: 'string',
  BINARY: 'string'
}

/** JSON Schema 里的 format（比裸 type 更有信息量） */
const FORMAT_MAP = {
  DATE: 'date-time',
  DATEONLY: 'date',
  UUID: 'uuid'
}

/**
 * 单个 attribute → JSON Schema 属性
 */
function attributeToSchema (attr) {
  const key = attr.type?.key
  const prop = { type: TYPE_MAP[key] || 'string' }

  const format = FORMAT_MAP[key]
  if (format) prop.format = format

  /**
   * ENUM 的取值位置随 Sequelize 版本而变：
   *   v6：type.values（有些模型在 type.options.values）
   *   v5/其他：type.options.enum
   * 三处都认，否则会漏掉枚举 —— 文档里就会显示成普通字符串。
   */
  const enumValues =
    attr.type?.values ||
    attr.type?.options?.values ||
    attr.type?.options?.enum
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    prop.enum = enumValues
  }

  // 数组的子类型
  if (key === 'ARRAY') {
    const sub = attr.type?.options?.type || attr.type?.options?.subType
    if (sub) {
      const subKey = sub.key
      prop.items = { type: TYPE_MAP[subKey] || 'string' }
      const subEnum = sub.values || sub.options?.values || sub.options?.enum
      if (Array.isArray(subEnum)) prop.items.enum = subEnum
    } else {
      prop.items = { type: 'string' }
    }
  }

  /**
   * DECIMAL 的步长由 **scale**（小数位）决定，不是 precision（总位数）：
   *   precision=10, scale=2 → 金额精确到分 → multipleOf = 0.01
   * 写成 1e-precision 会得到 1e-10 —— 一个谁也用不上的精度。
   */
  const scale = attr.type?.options?.scale
  if (scale != null && (key === 'DECIMAL' || key === 'DOUBLE PRECISION')) {
    prop.multipleOf = Number(`1e-${scale}`)
  }

  // 长度约束
  const len = attr.type?.options?.length
  if (typeof len === 'number' && len > 0) prop.maxLength = len

  /**
   * 可空字段标 nullable: true（OpenAPI 3.0 的写法）。
   * 注意：allowNull 是 undefined 的（自增主键等）不算可空 —— 那类字段本来就不该传。
   */
  if (attr.allowNull === true) prop.nullable = true

  // comment → description（模型里写的中文说明直接进文档）
  if (attr.comment) prop.description = String(attr.comment)

  // 枚举值在 comment 里常写成 "支付方式: cod-货到付款, online-在线付款"
  // 把说明补进 description，比只有 "支付方式" 有用得多
  if (prop.enum && prop.description && !prop.description.includes(':')) {
    const named = prop.enum.map(v => `${v}`).join(', ')
    prop.description = `${prop.description}（可选值：${named}）`
  }

  return prop
}

/**
 * 模型 → JSON Schema
 *
 * @param {object} model Sequelize 模型
 * @param {object} options
 * @param {string} options.name schema 名称（组件名）
 * @param {string[]} options.exclude 要排除的属性名
 * @param {string[]} options.include 只保留这些属性名
 * @param {object} options.extra 追加到 schema 顶级的字段（如 description）
 * @returns {object} JSON Schema
 */
export function modelToSchema (model, options = {}) {
  const { name = model.name, exclude = [], include = [], extra = {} } = options
  const properties = {}
  const required = []

  for (const [attrName, attr] of Object.entries(model.rawAttributes || {})) {
    if (exclude.includes(attrName)) continue
    if (include.length > 0 && !include.includes(attrName)) continue
    properties[attrName] = attributeToSchema(attr)
    if (attr.allowNull === false) required.push(attrName)
  }

  return {
    type: 'object',
    title: name,
    ...extra,
    properties,
    ...(required.length > 0 ? { required } : {})
  }
}

/**
 * 枚举 schema（给 query 参数用）
 * @param {string[]} values
 */
export function enumSchema (values) {
  return { type: 'string', enum: values }
}

/**
 * 包装成「统一响应信封」：{ success, message, data }
 * 项目的所有接口都返回这个形状，前端 responseData.js 也按这个解包。
 *
 * @param {object} dataSchema data 字段的 schema
 */
export function envelopeSchema (dataSchema, description = '统一响应信封') {
  return {
    type: 'object',
    description,
    properties: {
      success: { type: 'boolean', description: '是否成功' },
      message: { type: 'string', description: '提示信息' },
      code: { type: 'string', description: '错误码（失败时可选）' },
      data: dataSchema
    },
    required: ['success', 'message']
  }
}

/**
 * 分页信封：data 里带 list + pagination
 */
export function pagedEnvelopeSchema (itemSchema, description = '分页列表') {
  return envelopeSchema({
    type: 'object',
    properties: {
      list: { type: 'array', items: itemSchema },
      pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer', description: '当前页码' },
          limit: { type: 'integer', description: '每页条数' },
          total: { type: 'integer', description: '总条数' },
          totalPages: { type: 'integer', description: '总页数' }
        }
      }
    }
  }, description)
}
