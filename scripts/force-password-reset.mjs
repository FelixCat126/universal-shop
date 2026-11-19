#!/usr/bin/env node
/**
 * 默认口令账号 → 置「必须改密」标志
 *
 * ## 为什么需要这个脚本
 *
 * 第 33 轮安全彻查对**生产库**做了只读比对（不修改任何数据）：
 *
 *   管理员 admin  → 密码是否为默认 123456：❌ 是
 *   合作方 test   → 同为 123456
 *   合作方 test1  → 同为 123456
 *
 * 站点在公网，知道出厂口令的人登录一次即成功 —— 这是可直接利用的凭据泄露。
 *
 * ## 它做什么（以及**不**做什么）
 *
 * 做：把这些账号的 `must_reset_password` 置为 true
 *     → 用户下次登录时被**强制**改密（服务端拦截 + 前端强制跳改密页）
 *
 * 不做：**不碰密码本身**。密码仍然由账号主人自己设置 ——
 *      脚本无从知道用户想用什么口令，也不该替用户决定。
 *
 * ## 用法
 *
 *   # 只报告（默认干跑，不写库）
 *   node scripts/force-password-reset.mjs
 *
 *   # 真正置位（生产需要显式确认）
 *   NODE_ENV=production node scripts/force-password-reset.mjs --apply --allow-production
 *
 * 退出码：0 = 正常（干跑时若发现默认口令也算 0，只是会打印清单）；2 = 参数/环境不对
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(ROOT, '.env') })

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const ALLOW_PROD = args.includes('--allow-production')

const DEFAULT_PASSWORD = '123456'
const isProd = process.env.NODE_ENV === 'production'

if (isProd && !ALLOW_PROD) {
  console.error('❌ 生产环境需要显式确认：请追加 --allow-production')
  console.error('   （本脚本会写库：置 must_reset_password 标志，不改密码）')
  process.exit(2)
}

const { default: sequelize } = await import(path.join(ROOT, 'src/server/config/database.js'))
await import(path.join(ROOT, 'src/server/models/index.js'))
const bcrypt = require('bcrypt')

async function main () {
  const { Administrator, Partner } = sequelize.models

  const admins = await Administrator.findAll({ attributes: ['id', 'username', 'password', 'must_reset_password'] })
  const partners = await Partner.findAll({ attributes: ['id', 'login', 'password', 'must_reset_password'] })

  const hits = []
  for (const a of admins) {
    if (await bcrypt.compare(DEFAULT_PASSWORD, a.password)) {
      hits.push({ kind: 'administrator', id: a.id, account: a.username, flagged: a.must_reset_password === true })
    }
  }
  for (const p of partners) {
    if (await bcrypt.compare(DEFAULT_PASSWORD, p.password)) {
      hits.push({ kind: 'partner', id: p.id, account: p.login, flagged: p.must_reset_password === true })
    }
  }

  console.log(`🔍 扫描：管理员 ${admins.length} 个、合作方 ${partners.length} 个`)
  console.log(`   仍在使用默认口令「${DEFAULT_PASSWORD}」的账号：${hits.length} 个`)

  if (!hits.length) {
    console.log('✅ 没有账号在用默认口令')
    return
  }
  for (const h of hits) {
    console.log(`   ${h.flagged ? '✅已置位' : '⚠️ 未置位'}  ${h.kind} ${h.account} (id=${h.id})`)
  }

  if (!APPLY) {
    console.log('')
    console.log('ℹ️ 干跑结束（未写库）。要真正置位请加 --apply')
    console.log('   NODE_ENV=production node scripts/force-password-reset.mjs --apply --allow-production')
    return
  }

  const needFlag = hits.filter(h => !h.flagged)
  if (!needFlag.length) {
    console.log('')
    console.log('✅ 所有默认口令账号都已标记为"必须改密"，无需改动')
    return
  }

  let changed = 0
  for (const h of needFlag) {
    if (h.kind === 'administrator') {
      await Administrator.update({ must_reset_password: true }, { where: { id: h.id } })
    } else {
      await Partner.update({ must_reset_password: true }, { where: { id: h.id } })
    }
    changed++
    console.log(`   🔒 已置位：${h.kind} ${h.account}`)
  }
  console.log('')
  console.log(`✅ 已把 ${changed} 个默认口令账号标记为"必须改密"`)
  console.log('   这些账号下次登录时会被强制修改密码（密码由账号主人自己设置）')
}

main()
  .then(async () => { await sequelize.close(); process.exit(0) })
  .catch(async (e) => {
    console.error('❌ 执行失败:', e.message)
    try { await sequelize.close() } catch {}
    process.exit(1)
  })
