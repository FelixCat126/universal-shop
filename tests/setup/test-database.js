/**
 * 测试数据库 helper（PostgreSQL）
 *
 * 行为：
 *   - initialize(): 加载模型与连接
 *   - syncModels(): 强制重建所有表（DROP & CREATE）
 *   - clearAllData(): 每个测试前 TRUNCATE 全部业务表（重置自增 id），保留表结构
 *   - cleanup(): 关闭连接
 */

let sequelize = null

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
      // 按引用依赖顺序逐模型 sync，避免外键尚不存在就建索引
      for (const model of Object.values(sequelize.models)) {
        await model.sync({ force: false })
      }
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
