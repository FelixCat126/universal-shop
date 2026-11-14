/**
 * 数据库层"坏输入"的翻译层
 *
 * ## 为什么需要
 *
 * 管理端 34 个写路由里只有 9 个挂了 joi 校验（promotions / coupon-templates /
 * bundles 有，其余没有）。没校验的那些，**超长字符串会直接撞 PG 的 varchar 长度**：
 *
 *   value too long for type character varying(50)
 *
 * Sequelize 把它当普通异常抛出来 → 控制器的 catch 统一回 **500** →
 * 客户端看到"服务器内部错误"，完全不知道是自己输入太长；
 * 日志里还留一条带 stack 的 error，把真错误淹掉。
 *
 * ## 这些错误码都是**客户端输入问题**，不是服务端故障
 *
 *   22001 string_data_right_truncation —— 字符串超出字段长度
 *   22003 numeric_value_out_of_range   —— 数值越界
 *   22P02 invalid_text_representation   —— 文本格式非法（如把数字塞进 uuid 列）
 *   23502 not_null_violation           —— 必填没给
 *   23503 foreign_key_violation        —— 外键指向的行不存在
 *   23514 check_violation              —— 违反 CHECK 约束（如非法状态枚举）
 *
 * ## 为什么不逐个加 joi schema
 *
 * 逐个加 schema 需要人肉抄每个模型的列长度（抄错就是"合法的输入被拒"）；
 * 而这一层是**兜底**：不管哪个接口、哪个字段、以后新增的接口，
 * 数据库层的坏输入都会被翻译成 400 + 一句人话。
 * （理想状态是两者都有：入口处校验给精确提示，这一层兜底防漏。）
 */

/** PG 错误码 → 用户能看懂的话 */
const PG_CODE_MESSAGES = {
  // ⚠️ PG 错误码必须加引号：'22P02' 不是合法标识符（裸写会语法报错）
  '22001': '输入内容超出字段允许的长度',
  '22003': '输入的数值超出允许范围',
  '22P02': '输入的格式不正确',
  '23502': '缺少必填字段',
  '23503': '关联的数据不存在',
  '23514': '输入的值不被允许'
}

/** 没有 PG 错误码时的兜底：按消息文本识别 */
const MESSAGE_PATTERNS = [
  { re: /value too long for type/i, message: '输入内容超出字段允许的长度', code: 'VALUE_TOO_LONG' },
  { re: /numeric field overflow|out of range/i, message: '输入的数值超出允许范围', code: 'VALUE_OUT_OF_RANGE' },
  { re: /invalid input syntax for type/i, message: '输入的格式不正确', code: 'INVALID_VALUE_FORMAT' },
  { re: /null value in column/i, message: '缺少必填字段', code: 'NOT_NULL_VIOLATION' },
  { re: /violates foreign key constraint/i, message: '关联的数据不存在', code: 'FOREIGN_KEY_ERROR' },
  { re: /violates check constraint/i, message: '输入的值不被允许', code: 'CHECK_VIOLATION' }
]

/**
 * Sequelize 的校验错误消息是英文技术语：
 *   "Validation len on username failed"
 *   "Validation isEmail on email failed"
 * 后台是中文界面，直接透出去用户看不懂 —— 这里翻成一句人话。
 */
const VALIDATOR_MESSAGES = {
  len: '长度超出限制',
  max: '超出允许的最大值',
  min: '小于允许的最小值',
  isEmail: '格式不正确（应为邮箱地址）',
  isURL: '格式不正确（应为网址）',
  isUrl: '格式不正确（应为网址）',
  isIn: '取值不在允许范围内',
  notEmpty: '不能为空',
  notNull: '不能为空',
  is: '取值不合法',
  numeric: '必须是数字',
  isInt: '必须是整数',
  isDecimal: '必须是数字',
  isBoolean: '必须是布尔值',
  equals: '与已有数据重复'
}

/** @param {object} errObj Sequelize 的单个字段错误 */
function describeValidationFailure (errObj) {
  if (!errObj) return '数据校验失败'
  const field = errObj.path || errObj.paths?.[0] || ''
  const msg = String(errObj.message || '')
  // 格式：Validation <validator> on <path> failed
  const m = /^Validation\s+(\w+)\s+on\s+(.+?)\s+failed$/i.exec(msg)
  if (m) {
    const validator = m[1]
    const detail = VALIDATOR_MESSAGES[validator] || '内容不符合要求'
    return field ? `「${field}」${detail}` : detail
  }
  if (field && msg) return `「${field}」${msg}`
  return msg || '数据校验失败'
}

/**
 * 取 PG 错误码：Sequelize 把原始错误放在 parent / original 上，
 * 三种形态都要认（不同驱动版本位置不同）。
 */
function pgCodeOf (error) {
  return error?.parent?.code || error?.original?.code || error?.code || null
}

/**
 * @returns {{status:number, message:string, code:string}|null}
 *   不是"坏输入"就返回 null（调用方按 500 处理）。
 */
export function translateDbInputError (error) {
  if (!error) return null

  const code = pgCodeOf(error)
  if (code && PG_CODE_MESSAGES[code]) {
    return { status: 400, message: PG_CODE_MESSAGES[code], code: 'DB_INPUT_ERROR' }
  }

  // Sequelize 的校验错误（字段级）也是客户端输入问题
  if (error.name === 'SequelizeValidationError' || error.name === 'ValidationError') {
    const first = error.errors?.[0]
    return {
      status: 400,
      message: describeValidationFailure(first),
      code: 'VALIDATION_ERROR'
    }
  }

  // 没有错误码时按消息文本兜底（不同驱动/版本的错误码位置不统一）
  const msg = String(error.message || '')
  for (const p of MESSAGE_PATTERNS) {
    if (p.re.test(msg)) return { status: 400, message: p.message, code: p.code }
  }

  return null
}

/**
 * 控制器 catch 块的标准写法：
 *   坏输入 → 400 + 人话；其它 → 500 + 通用提示（细节只进日志）
 *
 * @param {object} res   Express response
 * @param {Error} error  捕获到的异常
 * @param {object} opts
 * @param {string} opts.logLabel       日志标签
 * @param {string} opts.fallbackMessage 兜底提示（500 时给客户端看的那句）
 * @param {Function} [opts.logger]     日志器（默认用全局 logger）
 */
export function respondDbError (res, error, { logLabel, fallbackMessage, logger }) {
  const translated = translateDbInputError(error)
  if (translated) {
    // 坏输入不是服务端故障 → 只记 warn，不记 error（免得淹没真错误）
    if (logger) logger.warn(logLabel, { err: error?.message })
    return res.status(translated.status).json({
      success: false,
      message: translated.message,
      code: translated.code
    })
  }
  if (logger) logger.error(logLabel, { err: error?.message, stack: error?.stack })
  return res.status(500).json({
    success: false,
    message: fallbackMessage,
    code: 'INTERNAL_SERVER_ERROR'
  })
}
