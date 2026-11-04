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
        await sequelize.query(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`)
      }
    } catch (error) {
      console.warn('⚠️ 清理测试数据失败：', error.message)
    }
  }

  static getSequelize () {
    return sequelize
  }
}
