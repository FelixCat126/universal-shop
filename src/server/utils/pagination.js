/**
 * 统一分页参数解析：下限 1、上限可配，非法值回退默认。
 * 防止负 offset / 超大 limit / NaN 直接打到数据库。
 *
 * @param {object} query - req.query
 * @param {{ pageKey?: string, pageSizeKey?: string, defaultPageSize?: number, maxPageSize?: number }} [options]
 * @returns {{ page: number, pageSize: number, limit: number, offset: number }}
 */
export function resolvePagination (query = {}, options = {}) {
  const {
    pageKey = 'page',
    pageSizeKey = 'pageSize',
    defaultPageSize = 20,
    maxPageSize = 100
  } = options

  const rawPage = Number.parseInt(query[pageKey], 10)
  const rawSize = Number.parseInt(query[pageSizeKey], 10)

  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1
  const pageSize = Number.isInteger(rawSize) && rawSize >= 1
    ? Math.min(rawSize, maxPageSize)
    : defaultPageSize

  return {
    page,
    pageSize,
    limit: pageSize,
    offset: (page - 1) * pageSize
  }
}
