/**
 * 统一分页参数解析：下限 1、上限可配，非法值回退默认。
 * 防止负 offset / 超大 limit / NaN 直接打到数据库。
 *
 * page 也必须有上限：limit 有上限但 page 没有时，
 * `page=999999999` 会产生近亿 OFFSET —— PG 必须顺序扫过整表再丢弃，
 * 叠加 findAndCountAll 的 COUNT(*) 就是两次全表扫描。
 * OFFSET 超过 maxOffset 后直接钳到上限页（而不是报错，保证接口可用）。
 *
 * @param {object} query - req.query
 * @param {{ pageKey?: string, pageSizeKey?: string, defaultPageSize?: number, maxPageSize?: number, maxPage?: number, maxOffset?: number }} [options]
 * @returns {{ page: number, pageSize: number, limit: number, offset: number }}
 */
export function resolvePagination (query = {}, options = {}) {
  const {
    pageKey = 'page',
    pageSizeKey = 'pageSize',
    defaultPageSize = 20,
    maxPageSize = 100,
    maxPage = 10000,
    maxOffset = 100000
  } = options

  const rawPage = Number.parseInt(query[pageKey], 10)
  const rawSize = Number.parseInt(query[pageSizeKey], 10)

  let page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1
  const pageSize = Number.isInteger(rawSize) && rawSize >= 1
    ? Math.min(rawSize, maxPageSize)
    : defaultPageSize

  // 页码上限 + offset 上限：双重钳制，避免深翻页把 DB 拖垮
  if (page > maxPage) page = maxPage
  let offset = (page - 1) * pageSize
  if (offset > maxOffset) {
    offset = maxOffset
    page = Math.floor(offset / pageSize) + 1
  }

  return {
    page,
    pageSize,
    limit: pageSize,
    offset
  }
}
