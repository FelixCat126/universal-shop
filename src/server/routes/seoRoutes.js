/**
 * SEO 路由：sitemap.xml / robots.txt（第 54 轮）
 * ==========================================
 *
 * ## 为什么需要
 *
 * 排查发现（第 54 轮）：全仓**没有任何 sitemap / robots** ——
 * 搜索引擎完全不知道这个商城有哪些商品页。
 *
 * 更糟的是**站内链接图是断的**：
 *   - 首页商品卡是 `<div @click>`（不是 `<a>`）→ DOM 里一个商品链接都没有
 *   - 唯一的商品页入链来自其它商品详情页的"相关推荐"
 *   - 没有商品列表页路由
 * → 爬虫**无法发现任何商品**（索引库空 → 没有入口）。
 *
 * sitemap 是把全量商品一次性推给搜索引擎的**最低成本**手段：
 * 即使站内链接图弱，它也能作为"入口清单"起效。
 *
 * ## 覆盖范围
 *
 *   - 商品详情页（在售 + 有货）
 *   - 商品分类页（前端目前没有独立路由，先指向首页锚点；等列表页路由落地再改）
 *   - 静态页（隐私政策 / 服务条款）
 *
 * **不含**：管理后台、合作方门户（本来就是 noindex）、
 * 购物车/结算/订单等用户态页（对 SEO 是负资产）。
 */
import express from 'express'
import { Op } from 'sequelize'
import Product from '../models/Product.js'
import ProductCategory from '../models/ProductCategory.js'
import { logger } from '../utils/logger.js'

const router = express.Router()

/** 生产站点根地址（canonical / sitemap 都要绝对 URL） */
const SITE_URL = process.env.SITE_URL || 'https://eshop.cider-bar.com'

/** sitemap 单次最多列出的 URL 数（规范上限 50000，这里留足余量） */
const SITEMAP_LIMIT = 45000

/** XML 转义：商品名/分类名里的 & < > " ' 会破坏 XML 结构 */
function xmlEscape (value) {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 拼一条 <url> */
function urlEntry ({ loc, lastmod, changefreq, priority }) {
  const parts = [`    <loc>${xmlEscape(loc)}</loc>`]
  if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`)
  if (changefreq) parts.push(`    <changefreq>${changefreq}</changefreq>`)
  if (priority) parts.push(`    <priority>${priority}</priority>`)
  return `  <url>\n${parts.join('\n')}\n  </url>`
}

/**
 * sitemap.xml
 *
 * 只列**在售且有货**的商品：已下架/无货的商品页对搜索没有价值，
 * 列进去反而是"低质量页面"，会拉低整站评分。
 */
router.get('/sitemap.xml', async (req, res) => {
  try {
    const entries = []

    // 1) 首页
    entries.push(urlEntry({
      loc: `${SITE_URL}/portal/`,
      changefreq: 'daily',
      priority: '1.0'
    }))

    // 2) 静态页
    entries.push(urlEntry({
      loc: `${SITE_URL}/portal/privacy`,
      changefreq: 'yearly',
      priority: '0.3'
    }))
    entries.push(urlEntry({
      loc: `${SITE_URL}/portal/terms`,
      changefreq: 'yearly',
      priority: '0.3'
    }))

    // 3) 分类（前端暂无独立分类路由 → 指向首页；列表页路由落地后改成 /portal/products?category_id=）
    const categories = await ProductCategory.findAll({
      attributes: ['id', 'name', 'updated_at'],
      order: [['sort_order', 'ASC'], ['id', 'ASC']],
      limit: 1000,
      raw: true
    })
    for (const c of categories) {
      entries.push(urlEntry({
        loc: `${SITE_URL}/portal/?category=${c.id}`,
        changefreq: 'weekly',
        priority: '0.6'
      }))
    }

    // 4) 商品详情
    const products = await Product.findAll({
      where: {
        status: 'active',
        stock: { [Op.gt]: 0 }
      },
      attributes: ['id', 'updated_at'],
      order: [['updated_at', 'DESC']],
      limit: SITEMAP_LIMIT,
      raw: true
    })
    for (const p of products) {
      entries.push(urlEntry({
        loc: `${SITE_URL}/portal/products/${p.id}`,
        lastmod: p.updated_at ? new Date(p.updated_at).toISOString() : null,
        changefreq: 'weekly',
        priority: '0.8'
      }))
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    return res.send(xml)
  } catch (error) {
    logger.error('生成 sitemap 失败', { err: error?.message })
    return res.status(500).send('sitemap generation failed')
  }
})

/**
 * robots.txt
 *
 * 明确声明：门户可抓取，后台与合作方门户禁止抓取。
 * （它们虽然已经有 noindex meta，但 robots 里再声明一次是双保险。）
 */
router.get('/robots.txt', (req, res) => {
  const body = [
    'User-agent: *',
    'Allow: /portal/',
    'Disallow: /admin/',
    'Disallow: /partner/',
    'Disallow: /api/',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    ''
  ].join('\n')
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=86400')
  return res.send(body)
})

export default router
