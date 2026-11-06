#!/usr/bin/env node

/**
 * 一次性/可重复执行：给存量图片补齐缩略图与中图变体，并压缩过大的主图。
 *
 * 背景：上传管线原来不做任何图片处理，线上商品图最大的一张 1.9MB，
 * 而列表页只显示 192px 宽 —— 首屏光图片就传 1MB。
 * 现在上传会自动处理，但**存量图片**还得补一遍。
 *
 * 幂等：已有 _thumb.webp 的会跳过；主图只在超过上限时才重写。
 *
 * 用法：
 *   node scripts/reprocess-images.mjs                # 处理 public/uploads 下所有图片
 *   node scripts/reprocess-images.mjs --dry-run      # 只统计不改动
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureVariantsInDir, MAIN_MAX_EDGE } from '../src/server/utils/imageProcessor.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const UPLOAD_ROOT = path.join(ROOT, 'public/uploads')
const DRY = process.argv.includes('--dry-run')

const dirs = ['products', 'avatars', 'system']

let totalProcessed = 0
let totalSkipped = 0
let totalSaved = 0

for (const d of dirs) {
  const dir = path.join(UPLOAD_ROOT, d)
  const exists = await fs.stat(dir).catch(() => null)
  if (!exists?.isDirectory()) continue

  if (DRY) {
    // 干跑：只统计"缺变体"与"主图过大"的数量
    const entries = await fs.readdir(dir)
    let needThumb = 0
    let big = 0
    for (const name of entries) {
      const ext = path.extname(name).toLowerCase()
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue
      if (name.includes('_thumb.') || name.includes('_mid.')) continue
      const thumb = await fs.stat(path.join(dir, name.replace(ext, '_thumb.webp'))).catch(() => null)
      if (!thumb) needThumb++
      const st = await fs.stat(path.join(dir, name)).catch(() => null)
      if (st && st.size > 300 * 1024) big++
    }
    console.log(`[${d}] 需要补变体 ${needThumb} 张，主图超 300KB 的 ${big} 张`)
    totalProcessed += needThumb
    continue
  }

  const res = await ensureVariantsInDir(dir)
  console.log(`[${d}] 处理 ${res.processed} 张，跳过已有变体 ${res.skipped} 张，主图减小 ${(res.savedBytes / 1024).toFixed(0)}KB`)
  totalProcessed += res.processed
  totalSkipped += res.skipped
  totalSaved += res.savedBytes
}

if (DRY) {
  console.log(`\n干跑结束：共 ${totalProcessed} 张需要处理（未改动任何文件）`)
} else {
  console.log(`\n✅ 完成：处理 ${totalProcessed} 张，跳过 ${totalSkipped} 张，主图共减小 ${(totalSaved / 1024).toFixed(0)}KB`)
  console.log('   变体文件名约定：<原名>_thumb.webp / <原名>_mid.webp（前端按此拼 srcset）')
}
console.log(`（主图上限 ${MAIN_MAX_EDGE}px）`)
