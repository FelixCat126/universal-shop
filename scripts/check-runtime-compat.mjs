#!/usr/bin/env node
/**
 * 生产依赖的**运行时兼容性**检查
 * ============================
 *
 * ## 为什么需要这个脚本
 *
 * 第 41 轮升级依赖时踩过一次：把 file-type 从 21 升到 22，
 * 它依赖的 strtok3 用了 Node 20+ 才支持的正则标志（`/v`），
 * 而生产是 **Node 18.20.8** → 服务**启动即崩**，PM2 反复重启（200+ 次），
 * 直到人工发现才停下。
 *
 * 根因：**依赖能不能在当前 Node 上跑，只有 import 一下才知道**，
 * 而 `npm install` 不做任何这种检查 —— 它只管把包装上。
 *
 * 这个脚本在部署流程里（npm install 之后、重启服务之前）跑：
 * 逐个 import 生产依赖，任何一个在当前 Node 上炸了 → 立刻失败并中止部署，
 * **服务保持原样继续跑**（旧版本依赖还在 node_modules 里）。
 *
 * ## 用法
 *
 *   node scripts/check-runtime-compat.mjs
 *
 * 退出码：0 = 全部可加载；1 = 有不兼容（部署应中止）
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

/**
 * 必须逐个 import 的生产依赖。
 * 挑的是"启动时一定会被加载"的那些 —— 它们炸了，服务根本起不来。
 */
const CRITICAL = [
  'express',
  'express-rate-limit',
  'helmet',
  'cors',
  'pg',
  'sequelize',
  'ioredis',
  'file-type',
  'bcrypt',
  'sharp',
  'dotenv',
  'jsonwebtoken',
  'joi',
  'multer',
  'compression',
  'winston',
  'lru-cache'
]

const results = []
for (const name of CRITICAL) {
  try {
    // 直接 import 包名：Node 会按包的 exports/main 解析入口
    await import(name)
    results.push({ name, ok: true })
  } catch (e) {
    results.push({ name, ok: false, error: String(e?.message || e).split('\n')[0].slice(0, 160) })
  }
}

const failed = results.filter(r => !r.ok)

console.log(`🔧 运行时兼容性检查（Node ${process.version}）`)
for (const r of results) {
  console.log(`   ${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : '  → ' + r.error}`)
}

if (failed.length) {
  console.log('')
  console.error(`❌ ${failed.length} 个依赖在当前 Node（${process.version}）上无法加载：${failed.map(f => f.name).join(', ')}`)
  console.error('   → 这些版本与当前 Node 不兼容（常见原因：用了新 Node 才支持的正则/语法）')
  console.error('   → 请降级这些包，或先升级 Node 后再升依赖')
  console.error('   → 部署应当中止：服务会保持旧版本依赖继续运行，不做无谓的重启风暴')
  process.exit(1)
}

console.log('')
console.log('✅ 全部生产依赖在当前 Node 上可加载')
process.exit(0)
