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
import { QueryTypes } from 'sequelize'
import os from 'node:os'
import path from 'node:path'
import fsPromises from 'node:fs/promises'

let sequelize = null
/**
 * 本测试文件专属的 schema。
 *
 * 必须放**模块变量**，不能放 process.env —— process.env 是进程级的，
 * 而 Vitest 每个测试文件有独立的模块注册表：下一个文件会覆盖 env，
 * 于是上一个文件的 afterAll 读到的是下一个文件的 schema 名，
 * 把下一个文件的 schema 给 DROP 掉（下一个文件的表瞬间消失）。
 */
let testSchema = null


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
export async function syncModelsInDependencyOrder (db) {
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
  const schema = testSchema || 'public'
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
async function invalidateSchemaFingerprint (db) {
  try {
    await fsPromises.unlink(markerFilePath(db))
  } catch { /* 本来就没有标记 */ }
}

async function writeSchemaFingerprint (db, fingerprint) {
  try {
    await fsPromises.writeFile(markerFilePath(db), fingerprint, 'utf8')
  } catch { /* 写不进去就当没标记，下次重建 */ }
}

/**
 * 业务表是否真的就绪。
 *
 * 光比「表的数量」不够：模型改了列但表没重建时，数量照样对得上，
 * 于是「schema 已是最新」的判断会误判成真，接着所有用例都跑在旧结构上。
 * 所以额外抽查几个关键列（token_version / client_order_key / must_reset_password），
 * 缺任何一个都判定为「需要重建」。
 */
const KEY_COLUMNS = [
  { table: 'users', column: 'token_version' },
  { table: 'users', column: 'must_reset_password' },
  { table: 'orders', column: 'client_order_key' },
  { table: 'orders', column: 'total_amount_thb' },
  { table: 'administrators', column: 'token_version' },
  { table: 'export_jobs', column: 'admin_id' }
]

/**
 * 取 SELECT 查询的行数组。
 *
 * 注意 Sequelize 6 在 `type: QueryTypes.SELECT` 且没有 model 时，
 * `query()` 返回的是**行数组本身**（不是 [rows, metadata]）——
 * 早前按 [rows, meta] 解构，拿到的是「第一行对象」，
 * 于是所有计数都变成 0 → 判定永远为「表没建好」→ 每次都重建。
 */
function selectRows (result) {
  if (Array.isArray(result?.[0])) return result[0]
  if (Array.isArray(result)) return result
  return []
}

async function allTablesPresent (db, expected) {
  const schema = testSchema || 'public'
  const rows = selectRows(await db.query(
    `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = :s`,
    { replacements: { s: schema }, type: QueryTypes.SELECT }
  ).catch(() => [{ n: 0 }]))
  const n = Number(rows?.[0]?.n ?? 0)
  if (n < expected) return false

  for (const { table, column } of KEY_COLUMNS) {
    const r = selectRows(await db.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = :s AND table_name = :t AND column_name = :c`,
      { replacements: { s: schema, t: table, c: column }, type: QueryTypes.SELECT }
    ).catch(() => [{ n: 0 }]))
    if (!Number(r?.[0]?.n ?? 0)) return false
  }
  return true
}


export class TestDatabase {
  /** 设定本测试文件专属的 schema（必须在模型定义之前调用） */
  static setSchema (name) {
    testSchema = name || null
  }

  /**
   * 把 Sequelize 的 describeTable 查询按 schema 限定住。
   *
   * Sequelize 6 的 postgres describeTableQuery 里有两个**标量**子查询是跨 schema 的：
   *
   *   1) enum 标签：
   *        WHERE t.typname = c.udt_name
   *      pg_type 是**库级**目录，typname 跨 schema 不唯一。
   *      只要存在第二个 schema 也叫 enum_products_status，就匹配到多行 →
   *      "more than one row returned by a subquery used as an expression"
   *      → prepareSchema() 中断 → 幂等等唯一索引建不出来 →
   *      大量用例莫名失败（并发下单建出 5 单、断言条数不对……）。
   *
   *   2) 字段注释：
   *        pg_statio_all_tables 按 relname 关联，没限定 schema
   *      同名的表（public.users 与本文件 schema 的 users）同样会匹配到多行。
   *
   * 补上 schema 限定后，describeTable 在任意 schema 组合下都正确。
   * 生产只有一个 schema（public），补限定前后语义完全一致 → 行为不变。
   */
  static patchDescribeTableQuery (db) {
    const qg = db.dialect.queryGenerator
    if (qg.__describeTableSchemaScoped) return
    const original = qg.describeTableQuery.bind(qg)

    const ENUM_SQL =
      'FROM pg_catalog.pg_type t JOIN pg_catalog.pg_enum e ON t.oid=e.enumtypid WHERE t.typname=c.udt_name'
    const ENUM_SQL_SCOPED =
      'FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace JOIN pg_catalog.pg_enum e ON t.oid=e.enumtypid WHERE t.typname=c.udt_name AND n.nspname=c.table_schema'
    const COMMENT_SQL =
      'INNER JOIN pg_catalog.pg_description pgd on (pgd.objoid=st.relid) WHERE c.ordinal_position=pgd.objsubid AND c.table_name=st.relname'
    const COMMENT_SQL_SCOPED =
      'INNER JOIN pg_catalog.pg_description pgd on (pgd.objoid=st.relid) WHERE c.ordinal_position=pgd.objsubid AND c.table_name=st.relname AND st.schemaname=c.table_schema'

    qg.describeTableQuery = function (tableName, schema, schemaDelimiter) {
      const sql = original(tableName, schema, schemaDelimiter)
      if (!sql.includes(ENUM_SQL) || !sql.includes(COMMENT_SQL)) {
        // Sequelize 换了版本 → 补丁失效。必须**大声**报出来，
        // 否则会退回到「跨 schema 匹配 → 随机失败」的老坑，且极难排查。
        throw new Error(
          'describeTableQuery 补丁失效：Sequelize 的 SQL 结构与预期不符，' +
          '跨 schema 的 enum/表名匹配问题会重新出现。请检查 sequelize 版本。'
        )
      }
      return sql
        .replace(ENUM_SQL, ENUM_SQL_SCOPED)
        .replace(COMMENT_SQL, COMMENT_SQL_SCOPED)
    }
    qg.__describeTableSchemaScoped = true
  }

  /**
   * 在**任何连接被创建之前**给连接池装上 search_path 钩子。
   *
   * 关键：PG 的 enum 类型是**不带 schema**创建的（CREATE TYPE "enum_xxx"），
   * 落到哪个 schema 取决于连接的 search_path。而连接池的第一条连接是由
   * authenticate() 建的 —— 如果那时钩子还没装上，那条连接的 search_path 就是
   * 默认的 public，于是**表在测试 schema、enum 类型却跑到 public**，
   * 两边对不上，describeTable 就会因为同名 enum 匹配到多行而报错。
   *
   * 所以钩子必须比 authenticate() 更早装上。
   */
  static installSchemaHook (db, schema) {
    db.addHook('afterConnect', async (connection) => {
      await connection.query(`SET search_path TO "${schema}"`)
    })
  }

  /**
   * 删除「创建它的进程已经不在了」的测试 schema。
   *
   * schema 名格式：t_<pid>_<hex>
   *   - pid 还活着 → 别的进程正在用它，绝不能删（删了就是随机失败）
   *   - pid 已经不在 → 上次跑崩/被 kill 留下的垃圾，删掉
   *
   * 当前文件自己的 schema 永远跳过。
   */
  static async dropStaleSchemas (db, currentSchema = null) {
    let rows = []
    try {
      const result = await db.query(
        currentSchema
          ? `SELECT nspname FROM pg_namespace WHERE nspname LIKE 't\\_%' AND nspname <> :cur`
          : `SELECT nspname FROM pg_namespace WHERE nspname LIKE 't\\_%'`,
        { replacements: { cur: currentSchema }, type: QueryTypes.SELECT }
      )
      rows = selectRows(result)
    } catch (err) {
      // 清理失败不该阻断测试：只是会多留几个 schema（不影响隔离性）
      console.warn('⚠️ 清理历史测试 schema 失败（忽略）：', err?.message)
      return
    }
    const names = rows.map(r => r.nspname).filter(Boolean)
    for (const name of names) {
      const pid = Number.parseInt(String(name).split('_')[1], 10)
      if (!Number.isInteger(pid) || pid <= 0) continue
      if (pid === process.pid) continue
      // 进程还在 → 它的 schema 是活的，别动
      try {
        process.kill(pid, 0)
        continue
      } catch (err) {
        // ESRCH = 进程不存在 → 确实是垃圾；EPERM = 存在但不是我们 → 也别动
        if (err?.code !== 'ESRCH') continue
      }
      await db.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`).catch((err) => {
        console.warn(`⚠️ 删除残留 schema ${name} 失败（忽略）：`, err?.message)
      })
    }
  }

  static async initialize () {
    if (sequelize) return sequelize

    const modelsModule = await import('../../src/server/models/index.js')
    sequelize = modelsModule.sequelize

    try {
      await sequelize.authenticate()
      if (testSchema) {
        /**
         * 清掉「历史遗留」的测试 schema。
         *
         * schema 名是 t_<pid>_<随机>：pid 是创建它的进程号。
         * 只有**进程已经不在了**的 schema 才是垃圾（跑崩了 / 被 kill 的那次留下的）。
         * 还在跑的进程（比如另一个终端同时在跑测试）它的 schema 是活的，
         * 删掉就等于把人家的表抽走 —— 那正是「relation xxx does not exist」
         * 这类随机失败的经典来源，所以必须先判断 pid 是否还活着。
         *
         * （以前这里是「删掉除当前以外的所有 t_%」，而且整段被 .catch(() => {})
         *   吞掉：既可能误删别人的活 schema，失败时又一声不响。）
         */
        await this.dropStaleSchemas(sequelize, testSchema)

        await sequelize.query(`CREATE SCHEMA IF NOT EXISTS "${testSchema}"`)
        await sequelize.query(`SET search_path TO "${testSchema}"`)
      }
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
      /**
       * 重建前先把标记删掉。
       *
       * 否则：重建过程中进程被中断（Ctrl-C / 被 kill）时，表已经 DROP 了一部分、
       * 新表还没建完，而标记文件还停留在「与当前模型一致」→ 下一次运行会认为
       * 「schema 已是最新」而跳过重建，直接跑在一张**半残的库**上，
       * 表现为一大批用例集体失败（relation does not exist / 表结构不对）。
       *
       * 先删标记：重建被打断的话，下次运行一定会重建。
       */
      await invalidateSchemaFingerprint(sequelize)
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
      const schema = testSchema
      try {
        // 删掉本文件的 schema（含其中的表），不留垃圾
        if (schema) {
          await sequelize.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {})
        }
        // 指纹标记文件也一并删掉：每个文件一个 schema → 每次跑都新增一个标记文件，
        // 攒在 /tmp 里没人清。schema 都没了，标记留着也没意义。
        await invalidateSchemaFingerprint(sequelize).catch(() => {})
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
            /**
             * 注意：**不**用 RESTART IDENTITY。
             *
             * 重置序列会让 id 在每个用例里从 1 重新开始，于是「上一个用例
             * 签发的 token 里的 userId/adminId」在下一个用例里会**指向另一个
             * 角色/另一个人的行** —— 表现为一堆莫名其妙的 403 / 401 / 404
             * （比如管理员 token 突然指向了 operator 行，权限校验直接 403）。
             *
             * 不重置序列 → id 全局单调递增 → 旧 token 永远匹配不到新行，
             * 这类「张冠李戴」的失败从根上消失。代价只是 id 变大，无副作用。
             */
            await sequelize.query(`TRUNCATE ${quoted} CASCADE`)
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
