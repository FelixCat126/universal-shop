#!/usr/bin/env node

/**
 * 把存量图片的引用从 jpg/png 切到 webp。
 *
 * 背景：上传管线现在会把主图统一转成 WebP（同画质比 JPEG 小 25~35%），
 * 新上传的图已经是 .webp 了；但**存量数据**的 products.image / bundles.image /
 * users.avatar_url 还指着老的 .jpg —— 详情页/购物车这些"要原图"的场景
 * 还在下 JPEG，白白多传几十 KB。
 *
 * 安全设计：
 *   - **默认干跑**，只报告不改（--apply 才真改）
 *   - 只在**磁盘上确实存在对应 .webp** 时才改（否则图会裂）
 *   - **原 .jpg 文件保留** —— 改错了可以改回去
 *   - 幂等：已经是 .webp 的跳过
 *
 * 用法：
 *   node scripts/switch-images-to-webp.mjs            # 干跑（只看会改什么）
 *   node scripts/switch-images-to-webp.mjs --apply    # 真改
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT, 'public')

const APPLY = process.argv.includes('--apply')

/** 要处理的「表.列」 */
const TARGETS = [
  { table: 'products', column: 'image' },
  { table: 'bundles', column: 'image' },
  { table: 'users', column: 'avatar_url' }
]

process.env.NODE_ENV = process.env.NODE_ENV || 'production'
const { QueryTypes } = await import('sequelize')
const { default: sequelize } = await import('../src/server/config/database.js')

/**
 * 取查询的行数组。
 * 注意 Sequelize 在 `type: QueryTypes.SELECT` 且没有 model 时返回的是**行数组本身**
 * （没有 [rows, metadata] 那层）—— 早前按 [rows, meta] 解构拿到的是"第一行对象"。
 */
function selectRows (result) {
  if (Array.isArray(result?.[0]) && Array.isArray(result?.[0]?.[0] || {})) return result[0]
  if (Array.isArray(result)) return result
  return []
}

/** '/uploads/products/x.jpg' → 磁盘绝对路径 */
function diskPath (url) {
  if (!url || !url.startsWith('/uploads/')) return null
  return path.join(PUBLIC_DIR, url.replace(/^\/+/, ''))
}

/** 把 '/uploads/products/x.jpg' 的扩展名换成 .webp */
function toWebpUrl (url) {
  return url.replace(/\.(jpe?g|png|bmp|tiff)(\?.*)?$/i, '.webp$2')
}

let totalRows = 0
let totalSwitched = 0
let savedBytes = 0
const details = []

for (const { table, column } of TARGETS) {
  const result = await sequelize.query(
    `SELECT id, ${column} AS url FROM ${table}
     WHERE ${column} IS NOT NULL AND ${column} LIKE '/uploads/%' AND ${column} ~* '\\.(jpe?g|png|bmp|tiff)$'`,
    { type: QueryTypes.SELECT }
  )
  const list = selectRows(result)

  for (const row of list) {
    const url = row.url
    const webpUrl = toWebpUrl(url)
    if (webpUrl === url) continue
    const target = diskPath(webpUrl)
    if (!target || !fs.existsSync(target)) continue // 没有对应 webp → 不动（否则图会裂）

    let saved = 0
    try {
      const oldPath = diskPath(url)
      const oldSize = oldPath && fs.existsSync(oldPath) ? fs.statSync(oldPath).size : 0
      const newSize = fs.statSync(target).size
      saved = Math.max(0, oldSize - newSize)
    } catch {}

    totalRows++
    details.push({ table, column, id: row.id, from: url, to: webpUrl, saved })
    savedBytes += saved

    if (APPLY) {
      await sequelize.query(
        `UPDATE ${table} SET ${column} = ? WHERE id = ?`,
        { replacements: [webpUrl, row.id] }
      )
      totalSwitched++
    }
  }
}

console.log(`扫描到 ${totalRows} 处可切换为 webp 的图片引用`)
if (!APPLY) {
  console.log('（干跑，未修改任何数据；加 --apply 执行）')
  for (const d of details.slice(0, 12)) {
    console.log(`  ${d.table}.${d.column}#${d.id}: ${d.from} → ${d.to}（省 ${Math.round(d.saved / 1024)}KB）`)
  }
  if (details.length > 12) console.log(`  … 另有 ${details.length - 12} 处`)
  console.log(`合计可省约 ${Math.round(savedBytes / 1024)}KB`)
} else {
  console.log(`✅ 已切换 ${totalSwitched} 处（合计省约 ${Math.round(savedBytes / 1024)}KB；原图文件保留，可回滚）`)
}

await sequelize.close().catch(() => {})
process.exit(0)
