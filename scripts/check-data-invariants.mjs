#!/usr/bin/env node

/**
 * 生产数据不变量校验（只读 CLI）
 *
 * 用途：定时/手动检查「账实是否相符」——
 *   积分余额 = 流水累计、订单金额 = 明细之和、库存不为负、
 *   已用券挂得上订单、已支付订单有支付时间……
 *
 * **只读**：全程只有 SELECT，绝不写库。
 *
 * 用法：
 *   # 校验测试库
 *   DATABASE_URL_TEST=postgres://... npm run check:invariants
 *
 *   # 校验生产库（必须显式确认，防止手滑在生产上跑重查询）
 *   DATABASE_URL=postgres://... npm run check:invariants -- --allow-production
 *
 *   # 指定 schema（测试库用；生产是 public，不用传）
 *   npm run check:invariants -- --schema=myschema
 *
 *   # 调整"近期严格"类检查的窗口天数（默认 30）
 *   npm run check:invariants -- --recent-days=7
 *
 * 退出码：0 = 全部通过；1 = 有违规（或查询失败）。
 */

import { checkDataInvariants } from '../src/server/utils/dataInvariants.js'

const args = process.argv.slice(2)
const allowProduction = args.includes('--allow-production')
const jsonOut = args.includes('--json')
const only = (args.find(a => a.startsWith('--only=')) || '').replace('--only=', '')
// 生产用 public；测试库里表在各自的 schema 里，跑之前用 --schema 指定
const schema = (args.find(a => a.startsWith('--schema=')) || '').replace('--schema=', '')
// 近期窗口天数（"近期严格"类检查的范围）
const recentDays = Number((args.find(a => a.startsWith('--recent-days=')) || '').replace('--recent-days=', '') || 30)

const isProd = process.env.NODE_ENV === 'production'

/** 生产库需要显式确认：这些查询在数据量大时并不轻 */
if (isProd && !allowProduction) {
  console.error('❌ 生产环境需要显式确认：请追加 --allow-production')
  console.error('   （这些检查是只读的，但在生产上跑仍会产生数据库负载）')
  process.exit(2)
}

const { default: sequelize } = await import('../src/server/config/database.js')

try {
  if (schema) {
    await sequelize.query(`SET search_path TO "${schema}"`)
  }
  const results = await checkDataInvariants({ sequelize, recentDays })
  const filtered = only ? results.filter(r => r.name === only) : results

  if (jsonOut) {
    console.log(JSON.stringify(filtered, null, 2))
  } else {
    console.log('🔍 数据不变量校验')
    console.log('='.repeat(60))
    let bad = 0
    for (const r of filtered) {
      if (r.violations === 0) {
        console.log(`  ✅ ${r.title}`)
      } else if (r.violations < 0) {
        bad++
        console.log(`  ⚠️  ${r.title} —— 查询失败：${r.error}`)
      } else {
        bad++
        console.log(`  ❌ ${r.title} —— ${r.violations} 条违规（范围：${r.scope}）`)
        for (const d of r.detail) {
          console.log(`       ${JSON.stringify(d)}`)
        }
      }
    }
    console.log('='.repeat(60))
    console.log(bad === 0 ? '✅ 全部通过' : `❌ ${bad} 项检查未通过`)
  }
  process.exitCode = filtered.some(r => r.violations !== 0) ? 1 : 0
} catch (err) {
  console.error('❌ 校验失败：', err?.message || err)
  process.exitCode = 1
} finally {
  await sequelize.close().catch(() => {})
}
