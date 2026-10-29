/**
 * 统一解析后端响应里的列表数据。
 *
 * 后端不同接口的列表形态并不统一：
 *   - 数组：      data: [ ... ]              （如分类、组合包）
 *   - 包装对象：  data: { list: [ ... ] }    （如抵扣券 available / mine）
 *   - 包装对象：  data: { items: [ ... ] }
 *
 * 前端若一律用 `Array.isArray(res.data.data)` 判断，遇到包装对象会恒为 false，
 * 列表静默变空 —— 不会报错，但功能整体不可用（真实踩过：抵扣券前台全哑火）。
 * 这里统一按「数组 / list / items」依次尝试。
 */

/**
 * @param {unknown} data 后端响应体的 data 字段
 * @returns {Array} 解析出的数组（解析不出时返回空数组）
 */
export function extractList (data) {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    if (Array.isArray(data.list)) return data.list
    if (Array.isArray(data.items)) return data.items
    if (Array.isArray(data.rows)) return data.rows
    if (Array.isArray(data.orders)) return data.orders
    if (Array.isArray(data.products)) return data.products
    if (Array.isArray(data.users)) return data.users
    if (Array.isArray(data.records)) return data.records
  }
  return []
}

/**
 * 从 axios 响应里取列表（同时要求 success 为真）
 * @param {{ data?: { success?: boolean, data?: unknown } }} res
 * @returns {Array}
 */
export function extractListFromResponse (res) {
  if (!res?.data?.success) return []
  return extractList(res.data.data)
}
