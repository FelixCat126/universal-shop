/**
 * 测试数据库 helper（PostgreSQL）
 *
 * 行为：
 *   - initialize(): 加载模型与连接
 *   - syncModels(): 强制重建所有表（DROP & CREATE）
 *   - clearAllData(): 每个测试前 TRUNCATE 全部业务表（重置自增 id），保留表结构
 *   - cleanup(): 关闭连接
 */

import { createHash } from 'crypto'
import os from 'node:os'
import path from 'node:path'
import fsPromises from 'node:fs/promises'

let sequelize = null


/**
 * 按依赖顺序建表。
 *
 * 为什么不能直接用 `Object.values(sequelize.models)` 的顺序：
 * 那个顺序取决于**模型文件的求值顺序**，而模型文件是被各模块 import 时顺带
 * 求值的 —— 不同测试文件 import 的模块不同，于是注册顺序也不同。
 * 一旦某个文件里 Order 先于 User 注册，建表就会撞
 *   relation "users" does not exist
 * 表现为「部分测试文件整片失败 / relation does not exist」，
 * 而且是随机的（取决于该文件碰巧先 import 了谁）。
 *
 * 这里用「反复重试直到不再进展」：某个模型若因为父表还没建好而失败，
 * 就留到下一轮再试；一轮下来没有任何进展才判定为真的失败。
 */
async function syncModelsInDependencyOrder (db) {
  let pending = Object.values(db.models)
  let lastError = null
  while (pending.length > 0) {
    let progressed = false
    const stillPending = []
    for (const model of pending) {
      try {
        await model.sync({ force: false })
        progressed = true
      } catch (err) {
        const msg = String(err?.message || '')
        // 依赖的父表尚未建好 → 下一轮再试
        if (/does not exist|violates foreign key constraint/i.test(msg)) {
          stillPending.push(model)
          lastError = err
          continue
        }
        if (msg.includes('already exists')) {
          progressed = true
          continue
        }
        throw err
      }
    }
    if (!progressed) {
      throw lastError || new Error('建表失败：无法确定依赖顺序')
    }
    pending = stillPending
  }
}


/**
 * schema 指纹：覆盖表名、列名+类型、模型声明的索引。
 * 任何模型改动都会改变它 —— 用来判断「表结构是否需要重建」。
 */
function schemaFingerprint (models) {
  const parts = []
  for (const model of Object.values(models)) {
    const raw = model.getTableName()
    const table = typeof raw === 'string' ? raw : raw.tableName
    const cols = Object.keys(model.rawAttributes)
      .sort()
      .map(k => `${k}:${model.rawAttributes[k].type?.key || '?'}`)
      .join(',')
    const idx = (model.options?.indexes || [])
      .map(i => JSON.stringify(i.fields) + JSON.stringify(i.where || ''))
      .sort()
      .join(';')
    parts.push(`${table}(${cols})[${idx}]`)
  }
  parts.sort()
  return createHash('sha1').update(parts.join('|')).digest('hex')
}


/**
 * 读取已建好的 schema 指纹。
 *
 * 指纹存在**数据库的注释**里（COMMENT ON DATABASE），而不是内存变量：
 *   - Vitest 每个测试文件有独立的模块注册表，globalThis 也不共享，
 *     存内存等于每个文件都认为「还没建过」→ 每个文件都重建一次；
 *   - 重建 = DROP 全部表。文件之间只要有一点重叠，
 *     就会把别的文件正在用的表抽走 → 随机落在不同用例上的
 *     relation "xxx" does not exist。
 * 存在数据库里则天然跨文件共享：第一个文件建好，后面全部复用。
 */
/**
 * 指纹标记文件（放磁盘，不放内存、也不放数据库）。
 *
 *   - 放内存（globalThis / 模块变量）：Vitest 每个测试文件有独立的模块注册表，
 *     等于每个文件都认为「还没建过」→ 每个文件都重建一次；而重建 = DROP 全部表，
 *     会把别的文件正在用的表抽走 → 随机落在不同用例上的 relation does not exist；
 *   - 放数据库表：读标记要走连接池，反而引入快照/连接状态的不确定性；
 *   - 放磁盘：同一台机器、同一套模型指纹 → 跨文件、跨进程都稳定，
 *     且完全不碰数据库。
 *
 * 文件名带上库名，避免不同测试库互相干扰。
 */
function markerFilePath (db) {
  const dbName = (db.config && db.config.database) || 'shop_test'
  const schema = 'public'
  return path.join(os.tmpdir(), `.shop-test-schema-${dbName}-${schema}.marker`)
}

async function readSchemaFingerprint (db) {
  try {
    return (await fsPromises.readFile(markerFilePath(db), 'utf8')).trim()
  } catch {
    return null
  }
}

/**
 * 写指纹。
 *
 * 存在一张**不是模型**的表里：sequelize.drop() 只删模型对应的表，
 * clearAllData 的 TRUNCATE 也只清模型表 —— 所以这张标记表能活过重建，
 * 跨测试文件、跨进程都保留。
 *
 * （早前试过 COMMENT ON DATABASE，但应用连接用的角色通常不拥有数据库，
 *   COMMENT 会因权限不足失败 —— 而失败被 catch 吞掉，指纹永远写不进去，
 *  于是每个文件都重建一次。）
 */
async function writeSchemaFingerprint (db, fingerprint) {
  try {
    await fsPromises.writeFile(markerFilePath(db), fingerprint, 'utf8')
  } catch { /* 写不进去就当没标记，下次重建 */ }
}

/** 业务表是否都已建好（数量够不够） */
async function allTablesPresent (db, expected) {
  const [rows] = await db.query(
    `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`
  ).catch(() => [[{ n: 0 }]])
  const n = Number(rows?.[0]?.n ?? rows?.[0]?.[0] ?? 0)
  return n >= expected
}

export class TestDatabase {
  static async initialize () {
    if (sequelize) return sequelize

    const modelsModule = await import('../../src/server/models/index.js')
    sequelize = modelsModule.sequelize

    try {
      await sequelize.authenticate()
      console.log('✅ 测试数据库连接成功（PG）')
    } catch (error) {
      console.error('❌ 测试数据库连接失败：', error.message)
      console.error('   请确认 PostgreSQL 已启动：`npm run db:up`')
      console.error('   或检查 DATABASE_URL_TEST：', process.env.DATABASE_URL_TEST)
      throw error
    }

    return sequelize
  }

  /** 当前模型的 schema 指纹（表名 + 列 + 索引） */
  static schemaFingerprint () {
    if (!sequelize) return null
    return schemaFingerprint(sequelize.models)
  }

  static async syncModels () {
    if (!sequelize) {
      throw new Error('数据库未初始化，请先调用 initialize()')
    }
    const expected = Object.keys(sequelize.models).length
    const fingerprint = schemaFingerprint(sequelize.models)

    // 快速路径：标记一致且表都在 → 直接用，不重建
    if (await readSchemaFingerprint(sequelize) === fingerprint &&
        await allTablesPresent(sequelize, expected)) {
      console.log('ℹ️ 表结构已是最新，直接复用（不重建，避免抽走其它文件正在用的表）')
      return
    }

    /**
     * 需要重建时，先拿一把 PG 咨询锁（advisory lock）。
     *
     * 为什么必须有：Vitest 在**收集**阶段会把所有测试文件（连同各自的
     * setup 文件）都 import 一遍 —— 也就是 70 个 setup 模块几乎同时执行，
     * 每个都会走到这里。若它们各自重建（重建 = DROP 全部表再逐个建表），
     * 就会互相把对方刚建好的表抽走，最终留下一张残缺的库，
     * 表现为「大批用例莫名 relation does not exist / 403 / 500」。
     *
     * 拿到锁后再查一次标记：很可能已经有别的文件建好了，直接复用即可。
     */
    await sequelize.query('SELECT pg_advisory_lock(862427114)')
    try {
      if (await readSchemaFingerprint(sequelize) === fingerprint &&
          await allTablesPresent(sequelize, expected)) {
        console.log('ℹ️ 表结构已由其它文件建好，直接复用')
        return
      }
      await this._rebuildSchema(fingerprint, expected)
    } finally {
      await sequelize.query('SELECT pg_advisory_unlock(862427114)').catch(() => {})
    }
  }

  /** 真正重建表结构（调用方需已持有咨询锁） */
  static async _rebuildSchema (fingerprint, expected) {
    try {
      /**
       * PG force sync 说明：
       * Sequelize 在 sync({ force: true }) 时并行发出所有 CREATE TABLE + CREATE INDEX，
       * 偶尔会出现"表还没建好就建索引"竞态。
       * 解法：先整体 DROP（串行），再逐模型按依赖顺序 sync（不 force）。
       */
      await sequelize.drop({ cascade: true })
      // 按依赖顺序建表（见 syncModelsInDependencyOrder）
      await syncModelsInDependencyOrder(sequelize)
      await writeSchemaFingerprint(sequelize, fingerprint)
      console.log('✅ 测试数据库表结构同步完成')
    } catch (error) {
      // 非致命的 stderr 容忍（如索引已存在），真正致命的重新抛出
      if (error.message && error.message.includes('already exists')) {
        console.warn('⚠️ syncModels 警告（可忽略）：', error.message.split('\n')[0])
      } else {
        console.error('❌ syncModels 失败：', error.message)
        throw error
      }
    }
  }

  static async cleanup () {
    if (sequelize) {
      try {
        await sequelize.close()
      } catch {}
      sequelize = null
      console.log('✅ 测试数据库连接已关闭')
    }
  }

  /**
   * TRUNCATE 全部业务表（CASCADE + RESTART IDENTITY）。
   * PG 下一句搞定，比逐表 destroy 快得多。
   */
  static async clearAllData () {
    if (!sequelize) return
    try {
      const modelNames = Object.keys(sequelize.models)
      const tableNames = modelNames
        .map(name => sequelize.models[name].getTableName())
        .map(t => (typeof t === 'string' ? t : `${t.schema ? `"${t.schema}".` : ''}"${t.tableName}"`))
      const quoted = tableNames
        .map(t => (t.startsWith('"') ? t : `"${t}"`))
        .join(', ')
      if (quoted) {
        /**
         * TRUNCATE 需要所有业务表的 ACCESS EXCLUSIVE 锁。
         *
         * 上一个用例的「异步写」会跟它抢锁 —— 后台有若干 fire-and-forget 的
         * 写（操作日志、审计日志，都是响应发出后才落库的）：
         *   - logOperation 的 res.end 钩子：setImmediate 里写 operation_logs
         *   - 各控制器的 AuditLog.logUser(...).catch(() => {})
         * 这些写落在 TRUNCATE 期间就会形成死锁。
         *
         * 关键：**这里的错误不能吞掉**。清库失败 = 下一个用例看到脏数据，
         * 表现为一堆随机的断言失败（条数不对 / 404 / 401），极难定位。
         * 所以死锁就重试（PG 的 idle_in_transaction_session_timeout 是 10s，
         * 冲突的事务最多 10s 后会被 PG 掐掉，所以要等够久），仍失败才抛出去。
         */
        const maxAttempts = 6
        for (let attempt = 1; ; attempt++) {
          try {
            await sequelize.query(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`)
            break
          } catch (err) {
            const isDeadlock = err?.original?.code === '40P01' || /deadlock/i.test(err?.message || '')
            if (!isDeadlock || attempt >= maxAttempts) throw err
            await new Promise(r => setTimeout(r, 1000 * attempt))
          }
        }
      }
    } catch (error) {
      console.error('❌ 清理测试数据失败：', error.message)
      throw error
    }
  }

  static getSequelize () {
    return sequelize
  }
}
