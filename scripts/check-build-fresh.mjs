#!/usr/bin/env node

/**
 * 检查前端构建产物是否比源码新（防止部署了旧包）。
 *
 * 为什么需要：改完 src/ 却忘了 `npm run build:all` —— 部署上去的是**上一次**的产物，
 * 功能"没生效"，而且很难第一时间联想到是构建没跑。
 * （这个坑我踩过一次：E2E 跑的是带语法错误的旧包，页面直接白屏。）
 *
 * 判定：源码里最新的修改时间 > 构建产物里最旧的时间 → 构建已过期。
 * 只比较 src/（前端源码）与 dist/（产物）。
 *
 * 用法：
 *   node scripts/check-build-fresh.mjs          # 有过期则退出码 1
 *   node scripts/check-build-fresh.mjs --quiet  # 只在失败时输出
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')
const DIST = path.join(ROOT, 'dist')
const QUIET = process.argv.includes('--quiet')

/** 递归收集文件与最新修改时间 */
function scan (dir, filter, acc = { files: 0, newest: 0, newestPath: '' }) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      scan(full, filter, acc)
    } else if (entry.isFile() && (!filter || filter(entry.name))) {
      const st = fs.statSync(full)
      acc.files++
      if (st.mtimeMs > acc.newest) {
        acc.newest = st.mtimeMs
        acc.newestPath = path.relative(ROOT, full)
      }
    }
  }
  return acc
}

const src = scan(SRC, (name) => /\.(js|vue|css|scss)$/.test(name))
const dist = scan(DIST, (name) => /\.(js|css|html)$/.test(name))

if (src.files === 0) {
  console.log('ℹ️ 没有找到前端源码，跳过检查')
  process.exit(0)
}
if (dist.files === 0) {
  console.error('❌ 没有找到构建产物（dist/）—— 先跑 npm run build:all')
  process.exit(1)
}

if (src.newest > dist.newest) {
  if (!QUIET) {
    console.error('❌ 构建产物比源码旧 —— 部署的会是上一次的包！')
    console.error(`   最新源码：${src.newestPath}`)
    console.error(`   旧产物：  ${dist.newestPath}`)
    console.error('   请先执行：npm run build:all')
  }
  process.exit(1)
}

if (!QUIET) {
  console.log(`✅ 构建产物是最新的（源码 ${src.files} 个文件 / 产物 ${dist.files} 个文件）`)
}
process.exit(0)
