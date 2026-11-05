#!/usr/bin/env node

/**
 * 测试环境清理（PG 版本）：DROP 所有表 + 关闭连接 + 删除覆盖率报告
 */

import fs from 'fs'
import { QueryTypes } from 'sequelize'
import { TestDatabase } from './test-database.js'

async function cleanupTestEnvironment () {
  console.log('🧹 清理测试环境...')
  try {
    process.env.NODE_ENV = 'test'
    if (!process.env.DATABASE_URL_TEST) {
      process.env.DATABASE_URL_TEST = 'postgres://shop:shop@127.0.0.1:5432/shop_test'
    }

    const seq = await TestDatabase.initialize()
    try {
      /**
       * 1) 删掉所有测试 schema（t_%）—— 包括上次跑崩 / 被 kill 留下的。
       */
      const result = await seq.query(
        `SELECT nspname FROM pg_namespace WHERE nspname LIKE 't\\_%'`,
        { type: QueryTypes.SELECT }
      )
      // QueryTypes.SELECT 且无 model 时，Sequelize 直接返回行数组
      const rows = Array.isArray(result?.[0]) ? result[0] : (Array.isArray(result) ? result : [])
      for (const r of rows) {
        if (!r?.nspname) continue
        await seq.query(`DROP SCHEMA IF EXISTS "${r.nspname}" CASCADE`).catch(() => {})
      }
      console.log(`✅ 测试 schema 已清理（${rows.length} 个）`)

      /**
       * 2) 删掉 public 里的模型表 —— 旧「共用 public schema」方案留下的残留。
       *
       * 用原生 SQL 而不是 sequelize.drop()：public 里那些表的 enum 类型
       * 可能已经被清掉了（orphaned），Sequelize 再解析模型属性时会抛
       * "Cannot set properties of undefined (setting 'supportsSearchPath')"。
       */
      try {
        await seq.query(
          `DO $$
           DECLARE t text;
           BEGIN
             FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
             LOOP
               EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', t);
             END LOOP;
           END $$;`
        )
        console.log('✅ public 里的模型表已 DROP')
      } catch (e) {
        console.warn('⚠️ DROP 阶段：', e.message)
      }

      /**
       * 3) 删掉 public 里残留的 enum 类型。
       *
       * 表被 DROP 后，enum 类型会变成孤儿（pg_type 里还在）——
       * 而 PG 的 typname 跨 schema 不唯一，这些孤儿会让 Sequelize 的
       * describeTable 匹配到多行 → prepareSchema() 中断、唯一索引建不出来。
       */
      await seq.query(
        `DO $$
         DECLARE t text;
         BEGIN
           FOR t IN SELECT e.typname FROM pg_type e
                      JOIN pg_namespace n ON n.oid = e.typnamespace
                     WHERE e.typtype = 'e' AND n.nspname = 'public'
           LOOP
             EXECUTE format('DROP TYPE IF EXISTS %I CASCADE', t);
           END LOOP;
         END $$;`
      ).catch((e) => console.warn('⚠️ 清理残留 enum：', e.message))
      console.log('✅ 残留 enum 类型已清理')
    } catch (e) {
      console.warn('⚠️ 清理阶段：', e.message)
    }
    await TestDatabase.cleanup()

    const coverageDir = './coverage'
    if (fs.existsSync(coverageDir)) {
      fs.rmSync(coverageDir, { recursive: true, force: true })
      console.log('✅ 清理覆盖率报告')
    }
    for (const f of ['./test-results.xml', './junit.xml']) {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f)
        console.log(`✅ 删除临时文件: ${f}`)
      }
    }

    console.log('🎉 测试环境清理完成')
  } catch (error) {
    console.error('❌ 测试环境清理失败：', error.message)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cleanupTestEnvironment()
}
