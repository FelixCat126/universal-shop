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
/**
 * --self-test：验证**每条检查自己还会不会响**。
 *
 * 为什么要这个模式：一条"永远绿"的检查比没有检查更危险 ——
 * 它给人虚假的安全感，真出问题那天它不报警；
 * 更糟的是它可能**误报**（把合法数据判成违规），把真问题淹没。
 *
 * 这个模式对每条带 selfTest 的检查：造一份违规数据 → 跑这条检查 → 必须抓到。
 * 抓不到就说明它已经变成假检查了（口径变了、外键加了、检查写错了）。
 *
 * ⚠️ 只能在**测试库**上跑（它会写数据）。
 */
const selfTest = args.includes('--self-test')

const isProd = process.env.NODE_ENV === 'production'

/** 生产库需要显式确认：这些查询在数据量大时并不轻 */
if (isProd && !allowProduction) {
  console.error('❌ 生产环境需要显式确认：请追加 --allow-production')
  console.error('   （这些检查是只读的，但在生产上跑仍会产生数据库负载）')
  process.exit(2)
}

/**
 * ⚠️ 硬闸：自证模式会 **TRUNCATE 表 + 写入违规数据**。
 *
 * 它**绝不能**在生产库上跑 —— --allow-production 只代表"允许只读重查询"，
 * 不代表"允许清库"。这里单独拦一次，不给任何绕过参数。
 *
 * 判定方式：只有 NODE_ENV=test（连 DATABASE_URL_TEST）或显式 --confirm-write 才放行。
 * 其它一律拒绝 —— 因为在 NODE_ENV 未设置时，连接串可能来自 DATABASE_URL，
 * 那可能就是生产库（脚本无法从连接串本身判断是不是生产）。
 */
if (selfTest) {
  if (isProd) {
    console.error('❌ 自证模式（--self-test）会清空表并写入违规数据，禁止在生产环境运行')
    console.error('   请在测试库上执行：NODE_ENV=test DATABASE_URL_TEST=... node scripts/check-data-invariants.mjs --self-test')
    process.exit(2)
  }
  if (process.env.NODE_ENV !== 'test' && !args.includes('--confirm-write')) {
    console.error('❌ 自证模式（--self-test）会清空表并写入违规数据')
    console.error('   当前 NODE_ENV=' + (process.env.NODE_ENV || '(未设置)') + '，连接串可能来自 DATABASE_URL（可能是生产库）')
    console.error('   请改用测试库：NODE_ENV=test DATABASE_URL_TEST=... node scripts/check-data-invariants.mjs --self-test')
    console.error('   （确实知道目标库可清空时，可追加 --confirm-write）')
    process.exit(2)
  }
}

const { default: sequelize } = await import('../src/server/config/database.js')

try {
  if (schema) {
    await sequelize.query(`SET search_path TO "${schema}"`)
  }
  const results = await checkDataInvariants({ sequelize, recentDays })
  if (selfTest) {
    /**
     * 先跑迁移：自证模式直连的是测试库的 public schema（历史遗留），
     * 那里可能缺新加的列（例如 administrators.must_reset_password）。
     * 迁移是幂等的，跑一遍只会补齐、不会破坏。
     */
    try {
      const { runMigrations } = await import('../src/server/migrations/index.js')
      const r = await runMigrations({ sequelize })
      if (r.applied?.length) console.log('🧱 自证前补跑迁移：' + r.applied.join(', '))
    } catch (e) {
      console.error('❌ 自证前补跑迁移失败:', e.message)
      process.exit(2)
    }

    // 从 utils/dataInvariants.js 取 selfTest 定义
    const { CHECKS } = await import('../src/server/utils/dataInvariants.js')
    // 用项目自己的模型工厂（它连的是同一个库：NODE_ENV=test 时优先 DATABASE_URL_TEST）
    const models = (await import('../src/server/models/index.js')).default
    console.log('🧪 自证模式：逐条验证检查项还能不能抓到违规数据')
    console.log('='.repeat(60))
    let bad = 0
    for (const check of CHECKS) {
      if (check.defensive) {
        console.log(`  🛡️  ${check.name} —— 防御项：${check.defensiveReason}`)
        continue
      }
      if (!check.selfTest) {
        bad++
        console.log(`  ❌ ${check.name} —— 既无 selfTest 也未标 defensive（无法证明它会响）`)
        continue
      }
      // 每条检查前清库，避免上一条的数据干扰
      await sequelize.query(
        'TRUNCATE TABLE order_items, orders, carts, user_coupons, point_transactions, ' +
        'user_point_balances, after_sales, export_jobs, products, users, partners, ' +
        'administrators, coupon_templates RESTART IDENTITY CASCADE'
      )
      try {
        await check.selfTest(models)
        // custom 检查项（如 bcrypt 比对）没有 SQL，直接调它取违规行
        let list
        if (check.custom) {
          const { setInvariantSequelizeRef } = await import('../src/server/utils/dataInvariants.js')
          setInvariantSequelizeRef({ models })
          list = (await check.custom()) || []
        } else {
          const rows = await sequelize.query(check.sql, { replacements: { days: String(recentDays) } })
          list = Array.isArray(rows?.[0]) ? rows[0] : (Array.isArray(rows) ? rows : [])
        }
        if (list.length > 0) {
          console.log(`  ✅ ${check.name} —— 造的违规数据被抓到了（${list.length} 行）`)
        } else {
          bad++
          console.log(`  ❌ ${check.name} —— 造了违规数据却抓不到（❗ 永远绿的假检查）`)
        }
      } catch (e) {
        bad++
        console.log(`  ❌ ${check.name} —— 自证过程出错：${e.message}`)
      }
    }
    console.log('='.repeat(60))
    console.log(bad === 0 ? '✅ 全部检查项都能证明自己会响' : `❌ ${bad} 项检查有问题`)
    process.exitCode = bad === 0 ? 0 : 1
  } else {
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
  }
} catch (err) {
  console.error('❌ 校验失败：', err?.message || err)
  process.exitCode = 1
} finally {
  await sequelize.close().catch(() => {})
}
