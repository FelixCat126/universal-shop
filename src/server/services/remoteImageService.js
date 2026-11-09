/**
 * 远程图片下载入库（供 CSV 批量导入商品时用）
 *
 * 流程：远程 URL → 下载（带 SSRF 防护）→ 校验是图片 → 落盘到 uploads/products
 *      → 压缩 + 生成缩略图/中图变体 → 返回可存进商品的 URL
 *
 * 与"手动上传图片"走的是**同一套**处理管线（processImageFile），
 * 所以批量导入出来的图和手动传的是一样的规格（主图 WebP + 两档变体）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { fetchRemoteImage, detectImageType } from '../utils/remoteImageFetcher.js'
import { processImageFile } from '../utils/imageProcessor.js'
import { logger } from '../utils/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** 商品图目录（与 uploadController 一致） */
const UPLOAD_DIR = path.join(__dirname, '../../public/uploads/products')

/** 扩展名 → magic bytes 识别出来的类型要能对上 */
const EXT_BY_TYPE = {
  png: '.png',
  jpg: '.jpg',
  gif: '.gif',
  webp: '.webp'
}

/**
 * 下载远程图片并存到本地。
 *
 * @param {string} rawUrl 远程图片地址
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxBytes]
 * @returns {Promise<{url: string, filename: string, variants: {thumb: string|null, mid: string|null}, bytes: number}>}
 */
export async function downloadAndStoreImage (rawUrl, options = {}) {
  const url = String(rawUrl || '').trim()
  if (!url) throw new Error('图片地址为空')

  // 1) 下载（SSRF 防护在 fetchRemoteImage 里）
  const { buffer, contentType } = await fetchRemoteImage(url, options)

  // 2) 校验确实是图片（不信 Content-Type）
  const type = detectImageType(buffer)
  const ext = EXT_BY_TYPE[type]
  if (!ext) throw new Error('不支持的图片格式')

  // 3) 落盘（随机名，不带用户提供的任何字符）
  await fs.mkdir(UPLOAD_DIR, { recursive: true })
  const baseName = `imported_${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`
  const target = path.join(UPLOAD_DIR, baseName)
  await fs.writeFile(target, buffer)

  // 4) 压缩 + 生成变体（失败不阻断 —— 图已经落盘了，只是没瘦身）
  let processed = null
  try {
    processed = await processImageFile(target)
  } catch (e) {
    logger.warn('远程图片压缩处理失败（保留原图）', { err: e?.message })
  }
  const mainName = processed?.main || baseName
  const finalPath = path.join(UPLOAD_DIR, mainName)
  // 变体处理可能把主图换成 .webp；把原图删掉（避免留两份）
  if (mainName !== baseName) {
    await fs.unlink(target).catch(() => {})
  }
  const bytes = (await fs.stat(finalPath).catch(() => null))?.size ?? buffer.length

  return {
    url: `/uploads/products/${mainName}`,
    filename: mainName,
    contentType: contentType || type,
    bytes,
    variants: {
      thumb: processed?.thumb ? `/uploads/products/${processed.thumb}` : null,
      mid: processed?.mid ? `/uploads/products/${processed.mid}` : null
    }
  }
}

/**
 * 批量下载（给 CSV 导入用）。
 *
 * 逐张下载，**单张失败不影响其它**（商品图缺失不该让整批导入失败），
 * 失败原因逐张回报。
 *
 * @param {Array<{rowNumber: number, url: string}>} items
 * @param {object} [options]
 * @returns {Promise<{results: Array<{rowNumber: number, ok: boolean, url?: string, reason?: string}>}>}
 */
export async function downloadImagesBatch (items, options = {}) {
  const results = []
  for (const item of items) {
    try {
      const stored = await downloadAndStoreImage(item.url, options)
      results.push({ rowNumber: item.rowNumber, ok: true, url: stored.url, variants: stored.variants })
    } catch (e) {
      results.push({ rowNumber: item.rowNumber, ok: false, reason: e.message })
    }
  }
  return { results }
}
