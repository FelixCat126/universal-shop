/**
 * 004_product_search_trgm_index —— 商品搜索改用 trigram 索引
 *
 * 背景：商品搜索是 `name LIKE '%关键词%' OR name_th LIKE '%关键词%'`。
 * **前导通配符的 LIKE 用不了 btree 索引** —— PG 只能全表扫。
 * 商品少的时候无所谓（18 个商品扫一次 1ms 出头），但这是随商品量线性增长的：
 *
 *   实测（3 万商品，关键词 'MBAR 29999'，命中 1 行）
 *     没有索引：10.4ms   ← 全表扫了 3 万行才找到那 1 行
 *     有索引： 1.2ms    ← 走 GIN trigram
 *
 * 也就是说：搜索越"准"（命中越少）越慢 —— 越需要索引的场合越慢。
 *
 * pg_trgm 把字符串切成 3 字符的 trigram 存进 GIN 索引，
 * 于是 `LIKE '%xxx%'` 也能走索引。三个语言的商品名都能用：
 * 泰文没有空格分词，中文不分词 —— 基于词的全文检索（FTS）都不适用，
 * trigram 是唯一稳妥的选择。
 *
 * 已知边界：**关键词少于 3 个字符时 trigram 索引帮不上忙**
 * （trigram 需要至少 3 个连续字符），PG 会自动回落到顺序扫描 ——
 * 那种查询本来也快（扫的行少/命中多），可以接受。
 *
 * 幂等：全部 IF NOT EXISTS，重复执行安全。
 */
export default {
  name: '004_product_search_trgm_index',
  async up (queryInterface, sequelize) {
    // 扩展可能没装（部分托管 PG 不给 CREATEDB 之外的权限）——
    // 装不上就跳过索引，**绝不能让迁移失败把服务卡在起不来的状态**：
    // 搜索慢一点只是慢，迁移失败是整个服务起不来。
    try {
      await sequelize.query('CREATE EXTENSION IF NOT EXISTS pg_trgm')
    } catch (e) {
      console.warn('⚠️  无法启用 pg_trgm（权限不足？），商品搜索将退回全表扫描：', e.message)
      return
    }

    /**
     * opclass 要**带 schema 限定**：pg_trgm 可能装在 public，
     * 而某些环境（测试基建按文件隔离 schema）把 search_path 设成只有业务 schema，
     * 这时 `gin_trgm_ops` 根本找不到 → "operator class does not exist for access method gin"。
     * 查一下扩展实际装在哪个 schema，按实际位置写。
     */
    const opclass = await resolveOpclass(sequelize)
    if (!opclass) {
      console.warn('⚠️  找不到 pg_trgm 的 opclass，商品搜索将退回全表扫描')
      return
    }

    await createIndex(sequelize, 'idx_product_name_trgm', 'name', opclass)
    await createIndex(sequelize, 'idx_product_name_th_trgm', 'name_th', opclass)

    // 新建索引后要更新统计信息，否则规划器可能仍选顺序扫描
    await sequelize.query('ANALYZE products')
    console.log('✅ products 已加 trigram 搜索索引（name / name_th）')
  },
  async down (queryInterface, sequelize) {
    await sequelize.query('DROP INDEX IF EXISTS idx_product_name_th_trgm')
    await sequelize.query('DROP INDEX IF EXISTS idx_product_name_trgm')
  }
}

/**
 * 找 pg_trgm 的 gin opclass 的**完整限定名**。
 * @returns {Promise<string|null>} 例如 "public.gin_trgm_ops"
 */
async function resolveOpclass (sequelize) {
  const [rows] = await sequelize.query(`
    SELECT n.nspname AS schema_name
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm'
  `)
  const schema = rows?.[0]?.schema_name
  if (!schema) return null
  // schema 名来自 pg_catalog，用标识符引号包一下（PG 里 schema 名是普通标识符）
  return `"${schema}".gin_trgm_ops`
}

/**
 * 建 GIN trigram 索引。
 *
 * 用 CONCURRENTLY：建索引时**不锁表**，线上照常能改商品。
 * 普通 CREATE INDEX 会拿 ACCESS EXCLUSIVE 锁 —— 商品少时无所谓，
 * 但商品表涨到几万行时，建索引期间整个商品管理都动不了。
 *
 * CONCURRENTLY 有两个约束：
 *   - 不能在事务里跑（迁移执行器本来就不包事务，OK）
 *   - 失败时可能留下一个 **invalid** 索引（名为目标名但没建完），
 *     这时再跑一次会因为"已存在"而跳过 —— 索引却用不了。
 *     所以失败要先删掉残留再退回普通建索引。
 */
async function createIndex (sequelize, indexName, column, opclass) {
  try {
    await sequelize.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName}
       ON products USING gin (${column} ${opclass})`
    )
  } catch (e) {
    // CONCURRENTLY 失败 → 清理可能残留的 invalid 索引 → 退回普通建索引
    console.warn(`⚠️  ${indexName} 并发建索引失败（${e.message}），改用普通建索引`)
    await sequelize.query(`DROP INDEX IF EXISTS ${indexName}`).catch(() => {})
    await sequelize.query(
      `CREATE INDEX IF NOT EXISTS ${indexName}
       ON products USING gin (${column} ${opclass})`
    )
  }
}
