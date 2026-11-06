/**
 * 图片变体（前端侧）
 *
 * 后端上传时会把图片压到最长边 1600px，并派生两档 WebP：
 *   <原名>.jpg          主图（URL 不变，库里存的就是它）
 *   <原名>_thumb.webp   400px —— 列表页/卡片用
 *   <原名>_mid.webp     800px —— 详情页、购物车用
 *
 * 前端按这个约定拼 srcset，浏览器自己按屏宽挑档：
 * 1440 宽的屏上，列表页那列实际只有 ~300px 宽，却下载了 1.9MB 的主图 ——
 * 加上 srcset 后只下 ~20KB 的缩略图。
 *
 * 命名规则必须与 server/utils/imageProcessor.js 的 variantFileName 保持一致。
 */

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|tiff)(\?.*)?$/i

/** 变体文件名的后缀 */
const VARIANT_SUFFIX = { thumb: '_thumb.webp', mid: '_mid.webp' }

/**
 * 从图片 URL 推出各档位的 URL。
 * @param {string} url 原始 URL（相对或绝对）
 * @returns {{ main: string, thumb: string|null, mid: string|null }}
 */
export function imageVariants (url) {
  if (!url || typeof url !== 'string') return { main: url, thumb: null, mid: null }
  // 只处理站内上传的图片；外链（http…/cdn…）不管
  if (!url.startsWith('/uploads/')) return { main: url, thumb: null, mid: null }
  const m = url.match(IMAGE_EXT)
  if (!m) return { main: url, thumb: null, mid: null }

  // m[1] 是**不带点**的扩展名（'jpg'），截断时要连点一起算
  const ext = m[1]
  const query = m[2] || ''
  const base = url.slice(0, url.length - (ext.length + 1) - query.length)
  return {
    main: url,
    thumb: `${base}${VARIANT_SUFFIX.thumb}${query}`,
    mid: `${base}${VARIANT_SUFFIX.mid}${query}`
  }
}

/**
 * 拼 srcset（没有变体就返回 undefined，交给 <img> 用 src 兜底）。
 * @param {string} url 原始 URL
 * @returns {string|undefined}
 */
export function imageSrcSet (url) {
  const { main, thumb, mid } = imageVariants(url)
  if (!thumb && !mid) return undefined
  const parts = []
  if (thumb) parts.push(`${thumb} 400w`)
  if (mid) parts.push(`${mid} 800w`)
  parts.push(`${main} 1600w`)
  return parts.join(', ')
}

/**
 * 首屏图片该用 eager 还是 lazy。
 *
 * 原来**所有**图片都是 loading="lazy" —— 连首屏那 4 张也是，
 * 浏览器要等布局算完才知道它可见，等于首屏图反而晚到。
 * 前 N 张（首屏）用 eager + fetchpriority=high，其余保持 lazy。
 *
 * @param {number} index 该图在列表中的序号
 * @param {number} [eagerCount] 首屏图数量
 */
export function imageLoadingFor (index, eagerCount = 4) {
  if (index < eagerCount) {
    return { loading: 'eager', fetchpriority: 'high' }
  }
  return { loading: 'lazy', fetchpriority: 'auto' }
}
