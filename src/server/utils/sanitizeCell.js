/**
 * Excel/CSV 公式注入防护
 *
 * 用户可控字符串若以公式触发字符开头，会被 Excel/WPS 当公式执行（DDE 风险，
 * 可触发外部链接请求或本机命令）。统一在原文前加 ' 前缀强制按文本处理。
 *
 * 判定必须精确，否则会污染合法业务数据：
 *   - '+66812345678'（泰国手机号标准格式）**不能**被处理 —— 加撇号后
 *     管理员每次导出都要手工去掉，而订单联系人正是核心业务字段
 *   - '-5'（负数金额字符串）同样不该被处理
 *   - 只处理真正构成公式的形态：
 *       =...            直接公式
 *       +数字/-数字开头  恒为数值，不是公式
 *       @...            DDE 引用
 *       |...            OWASP 清单中的管道前缀
 *       控制字符开头     可用于绕过简单的前导字符判定
 */

/** 真正的公式起始形态 */
const FORMULA_START = /^\s*[=@|]/
/**
 * +/- 开头：只有「整个值是纯数值」才放行。
 *   '+66812345678' / '-5'      → 纯数值，不是公式
 *   '+66 123' / '+66abc'        → Excel 会解析成 =66 123 / =66abc，是公式
 */
const SIGN_FORMULA = /^\s*[+-](?![0-9]\s*$)/
/** 控制字符（可用于绕过判定） */
const CONTROL_PREFIX = /^[\x00-\x1f\x7f]/
/** 零宽字符/BOM：攻击者常插在公式前绕过判定 */
const ZERO_WIDTH = /^[\uFEFF\u200B-\u200D\u2060]/g

export const sanitizeCell = (value) => {
  if (typeof value !== 'string' || value.length === 0) return value
  // 去掉零宽字符与 BOM 后再判定（但保留原文不改写）
  const probe = value.replace(ZERO_WIDTH, '')
  if (FORMULA_START.test(probe) || CONTROL_PREFIX.test(probe)) {
    return `'${value}`
  }
  // +/- 开头：整体是纯数值才放行，否则 Excel 会当公式（=66 123）
  if (/^\s*[+-]/.test(probe) && !/^\s*[+-]?\d+(\.\d+)?\s*$/.test(probe)) {
    return `'${value}`
  }
  return value
}
