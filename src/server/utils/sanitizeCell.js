/**
 * Excel/CSV 公式注入防护：用户可控字符串若以 = + - @（允许前导空白）或控制字符开头，
 * 会被 Excel/WPS 当公式执行（DDE 风险）。统一在原文前加 ' 前缀强制按文本处理；
 * 判断用 trim 后的首字符，但保留原文不改写；数字/日期等非字符串原样返回。
 */
export const sanitizeCell = (value) => {
  if (typeof value !== 'string' || value.length === 0) return value
  if (/^\s*[=+\-@]/.test(value) || /^[\x00-\x1f]/.test(value)) {
    return `'${value}`
  }
  return value
}
