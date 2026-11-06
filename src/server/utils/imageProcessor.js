/**
 * 商品/头像图片处理（sharp）
 *
 * 为什么需要：
 * 上传管线原来**原图直接存、原图直接发**。实测线上有一张 1.9MB 的商品图，
 * 而它在列表页只显示 192px 宽 —— 首屏 16 张图就传了 1MB 流量，
 * 在泰国商城的移动网络环境下这是实打实的"卡"。
 *
 * 这里做三件事：
 *   1. 主图：最长边压到 1600px、JPEG q82（覆盖绝大多数展示场景，体积降 90%+）
 *   2. 缩略图：400px WebP q78（列表页用，~15-30KB）
 *   3. 中图：800px WebP q80（详情页/购物车用）
 *
 * **文件名约定**（前端据此拼 srcset，不动数据库）：
 *   原图   product_123.jpg          ← URL 不变，库里存的还是它
 *   缩略图 product_123_thumb.webp
 *   中图   product_123_mid.webp
 *
 * 为什么不改库：加一列存多张图 URL 会牵动所有读写点；
 * 按约定派生则前端与后端各自一处规则，改动面小得多。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * sharp **懒加载**（且失败不致命）。
 *
 * 为什么不能顶层 import：sharp 是原生模块，运行时版本要求很硬
 * （sharp 0.35 要求 Node ≥ 20.9，而生产机是 Node 18）——
 * 顶层 import 一旦不满足，**整个服务起不来**。
 * 图像压缩是"锦上添花"的能力，不该有能力就让服务挂掉。
 *
 * 所以：用到时才 import；import 失败就跳过压缩（保留原图）并告警。
 */
let sharpModule = null
let sharpLoadFailed = false

async function getSharp () {
  if (sharpModule) return sharpModule
  if (sharpLoadFailed) return null
  try {
    const mod = await import('sharp')
    sharpModule = mod.default || mod
    return sharpModule
  } catch (err) {
    sharpLoadFailed = true
    console.warn('[imageProcessor] sharp 不可用，跳过图片压缩（不影响功能）:', err?.message?.split('\n')[0])
    return null
  }
}

/** 各档位的最长边（px） */
export const IMAGE_VARIANTS = {
  thumb: 400,
  mid: 800
}

/** 主图最长边 */
export const MAIN_MAX_EDGE = 1600

/** 派生出的变体文件名（与前端 utils/imageVariants.js 必须一致） */
export function variantFileName (fileName, variant) {
  const ext = path.extname(fileName)
  const base = ext ? fileName.slice(0, -ext.length) : fileName
  return `${base}_${variant}.webp`
}

/**
 * 处理一张已落盘的图片：压缩主图 + 生成缩略图/中图。
 *
 * @param {string} filePath 落盘的绝对路径
 * @returns {Promise<{ main: string, thumb: string|null, mid: string|null }>}
 *   返回各变体的**文件名**（不是路径）
 */
export async function processImageFile (filePath) {
  const dir = path.dirname(filePath)
  const fileName = path.basename(filePath)
  const ext = path.extname(fileName).toLowerCase()

  // 只处理常见位图；其它（svg 等）原样保留
  if (!['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'].includes(ext)) {
    return { main: fileName, thumb: null, mid: null }
  }

  const out = { main: fileName, thumb: null, mid: null }

  /**
   * 1) 主图：压到最长边 1600，并统一存成 **WebP**。
   *
   * 为什么主图也转 WebP：同画质下比 JPEG 小 25~35% ——
   * 详情页/购物车这些"要原图"的场景也省得到。
   *
   * 命名：主图改成 <原名>.webp（库里存的就是它），变体仍是
   * <主图名去扩展名>_thumb.webp / _mid.webp —— 前端按同一规则推导 ✓。
   *
   * 原图（png/jpg…）保留：库里可能还有别处引用它。
   * 失败不阻断上传：保留原图（只是没瘦身）。
   */
  const sharp = await getSharp()
  if (!sharp) return { main: fileName, thumb: null, mid: null }

  try {
    const buf = await sharp(filePath)
      .rotate() // 按 EXIF 方向摆正，省得竖图躺倒
      .resize({ width: MAIN_MAX_EDGE, height: MAIN_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer()
    const webpName = fileName.slice(0, fileName.length - path.extname(fileName).length) + '.webp'
    await fs.writeFile(path.join(dir, webpName), buf)
    out.main = webpName
  } catch (err) {
    // 压缩失败不阻断上传：保留原图，只是没瘦身
    console.warn('[imageProcessor] 主图压缩失败，保留原图', err?.message)
    out.main = fileName
  }

  // 2) 变体：缩略图 / 中图（WebP）
  const src = path.join(dir, out.main)
  for (const [variant, edge] of Object.entries(IMAGE_VARIANTS)) {
    try {
      const name = variantFileName(out.main, variant)
      await sharp(src)
        .rotate()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: variant === 'thumb' ? 78 : 80 })
        .toFile(path.join(dir, name))
      out[variant] = name
    } catch (err) {
      console.warn(`[imageProcessor] ${variant} 生成失败`, err?.message)
    }
  }

  return out
}

/**
 * 批量补齐某个目录里所有图片的变体（一次性脚本用；幂等：已有变体就跳过）。
 * @returns {Promise<{processed: number, skipped: number, savedBytes: number}>}
 */
export async function ensureVariantsInDir (dir) {
  let processed = 0
  let skipped = 0
  let savedBytes = 0
  let entries = []
  try {
    entries = await fs.readdir(dir)
  } catch {
    return { processed, skipped, savedBytes }
  }
  for (const name of entries) {
    const ext = path.extname(name).toLowerCase()
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue
    if (name.includes('_thumb.') || name.includes('_mid.')) continue
    const full = path.join(dir, name)
    const stat = await fs.stat(full).catch(() => null)
    if (!stat?.isFile()) continue

    const thumbPath = path.join(dir, variantFileName(name, 'thumb'))
    const already = await fs.stat(thumbPath).catch(() => null)
    if (already) { skipped++; continue }

    const before = stat.size
    const res = await processImageFile(full)
    const after = (await fs.stat(full).catch(() => null))?.size ?? before
    if (after < before) savedBytes += before - after
    processed++
    if (res.thumb) {
      const t = await fs.stat(path.join(dir, res.thumb)).catch(() => null)
      if (t) savedBytes += 0 // 变体是新增文件，不算"节省"，但首屏只下它
    }
  }
  return { processed, skipped, savedBytes }
}
