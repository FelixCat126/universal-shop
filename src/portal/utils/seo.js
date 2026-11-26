/**
 * 门户端 SEO 元信息（第 54 轮）
 * ================================
 *
 * ## 为什么需要
 *
 * 排查发现（第 54 轮）：**所有商品详情页共用同一个 title**。
 *
 * 根因是两层覆盖打架：
 *   1. `router/index.js` 的路由守卫按 `meta.title` 写死中文（"商品详情"…）
 *   2. `App.vue` 的 `updatePageTitle` 在路由变化后**再写一次**，
 *      而它的 switch **没有 ProductDetail 分支** → 落到 `default` →
 *      title 被改成 `title.main`（"您身边的购物优选专家"）
 *
 * 结果：搜索结果里 N 个商品页显示同一个标题 → 搜索引擎判定为"同一页的重复"，
 * 且完全丢掉了「商品名 + 价格」这类**长尾词**流量。
 *
 * ## 这里做什么
 *
 * 提供一个**统一入口**，让每个页面按自己的数据设置 title / description /
 * canonical / OG 标签，避免各处各写一套、互相覆盖。
 *
 * ## 设计要点
 *
 * - **商品页在数据到位后设置**（不是路由变化时）—— 商品名/价格只有拿到数据才有
 * - 用 `setMeta` 幂等写入：先删旧的同名标签，再写新的，避免 SEO 标签越积越多
 * - `canonical` 用**绝对 URL**（相对 URL 的 canonical 搜索引擎不认）
 * - `og:image` 用商品主图 → 社交分享（Facebook/WhatsApp）才有预览图
 */

/** 站点基础信息（canonical / og 的绝对 URL 需要） */
import { formatAmountWithSymbol } from '../../shared/money.js'

const SITE = {
  name: 'Universal Shop',
  // 生产域名；部署到别的域名时改这里（canonical 会跟着变）
  url: 'https://eshop.cider-bar.com'
}

/**
 * 写一个 <meta> 标签（同名先删后写，保持幂等）。
 * @param {string} attr 属性名（name / property）
 * @param {string} key  标签的键（description / og:title …）
 * @param {string} content 内容
 */
function setMeta (attr, key, content) {
  if (!content) return
  const head = document.head
  // 先删掉同名的旧标签（多个 og:title 会被搜索引擎取第一个，顺序不可控）
  head.querySelectorAll(`meta[${attr}="${key}"]`).forEach(el => el.remove())
  const el = document.createElement('meta')
  el.setAttribute(attr, key)
  el.setAttribute('content', content)
  head.appendChild(el)
}

/** 写 <link rel="canonical"> */
function setCanonical (url) {
  if (!url) return
  document.head.querySelectorAll('link[rel="canonical"]').forEach(el => el.remove())
  const el = document.createElement('link')
  el.setAttribute('rel', 'canonical')
  el.setAttribute('href', url)
  document.head.appendChild(el)
}

/**
 * 统一设置页面 SEO 元信息。
 *
 * @param {object} opts
 * @param {string} opts.title       页面标题（不含站点名后缀）
 * @param {string} [opts.description] 页面描述
 * @param {string} [opts.image]     社交分享图（绝对或相对 URL）
 * @param {string} [opts.path]      站内路径（如 /portal/products/12），用于 canonical
 * @param {string} [opts.type]      og:type（默认 website；商品页用 product）
 * @param {string} [opts.siteName]  站点名（og:site_name）
 */
export function setPageSeo (opts = {}) {
  const { title, description, image, path, type = 'website', siteName = SITE.name } = opts

  // document.title：标题 + 站点名（与原有格式保持一致）
  if (title) {
    document.title = `${title} - ${siteName}`
  }

  setMeta('name', 'description', description)
  setMeta('property', 'og:title', title ? `${title} - ${siteName}` : null)
  setMeta('property', 'og:description', description)
  setMeta('property', 'og:type', type)
  setMeta('property', 'og:site_name', siteName)
  setMeta('property', 'og:url', path ? `${SITE.url}${path}` : null)

  // Twitter 卡片（Twitter/X 会读 og:*，但显式写更保险）
  setMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary')
  setMeta('name', 'twitter:title', title ? `${title} - ${siteName}` : null)
  setMeta('name', 'twitter:description', description)

  if (image) {
    const abs = image.startsWith('http') ? image : `${SITE.url}${image}`
    setMeta('property', 'og:image', abs)
    setMeta('name', 'twitter:image', abs)
  }

  setCanonical(path ? `${SITE.url}${path}` : null)
}

/**
 * 商品详情页专用：把商品信息拼成 SEO 标题与描述。
 *
 * 标题公式：`商品名 · 价格฿ · 店铺名`
 * —— 「商品名 + 价格」正是电商长尾搜索词的主要形态
 * （"iphone 15 case 1200" / "mbv 9k ฿1990"），不写等于放弃这批流量。
 *
 * @param {object} product 商品对象
 * @param {string} [categoryName] 分类名（可选，用于描述）
 * @returns {{title: string, description: string, image: string|null, path: string}}
 */
export function buildProductSeo (product, categoryName) {
  if (!product) return { title: '', description: '', image: null, path: '' }

  const name = product.name || product.alias || ''
  const price = Number(product.price)
  // ⚠️ 金额必须走 shared/money.js 的统一舍入口径（第 40 轮）：
  //    直接 toFixed 会与三端其它地方的舍入规则不一致（moneyConsistency MC-5 门禁会拦）。
  const priceText = Number.isFinite(price) ? formatAmountWithSymbol(price, '฿') : ''
  const title = [name, priceText].filter(Boolean).join(' · ')

  // 描述：商品名 + 分类 + 库存状态 + 描述摘要
  const desc = String(product.description || '').trim().replace(/\s+/g, ' ').slice(0, 150)
  const bits = []
  if (categoryName) bits.push(categoryName)
  if (priceText) bits.push(priceText)
  if (Number(product.stock) > 0) bits.push('มีสินค้า')
  if (desc) bits.push(desc)
  const description = bits.join(' · ').slice(0, 300)

  const path = `/portal/products/${product.id}`
  return {
    title,
    description,
    image: product.image || null,
    path
  }
}

export { SITE }
