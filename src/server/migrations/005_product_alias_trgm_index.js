/**
 * 005_product_alias_trgm_index —— 商品别名的 trigram 索引
 *
 * 背景：004 给 name / name_th 建了 trigram 索引，但**别名（alias）没被搜到** ——
 * 运营可以在管理端填"产品别名"（记客户口头叫法、拼音、其它语言叫法），
 * 填了客户却搜不着，等于白填。
 *
 * 所以这次做两件事：
 *   1. 搜索条件加上 alias（见 productController.getProducts）
 *   2. 给 alias 补上对应的 trigram 索引
 *
 * 为什么不直接改 004：004 已经在生产跑过并记进 schema_migrations。
 * 改一个"已执行"的迁移文件，会造成**文件说 A、库里是 B**的静默不一致
 * （迁移执行器按名字跳过已执行的，不会重跑）。已上线的迁移只能新增、不能改写。
 *
 * 幂等：IF NOT EXISTS。
 */
export default {
  name: '005_product_alias_trgm_index',
  async up (queryInterface, sequelize) {
    // pg_trgm 可能装不上（权限不足）——那 004 也不会有索引，跳过即可
    const [ext] = await sequelize.query(
      `SELECT n.nspname AS schema_name
       FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
       WHERE e.extname = 'pg_trgm'`
    )
    const schema = ext?.[0]?.schema_name
    if (!schema) {
      console.warn('⚠️  pg_trgm 扩展不可用，跳过 alias 索引（别名搜索会走全表扫描）')
      return 'skipped'
    }
    const opclass = `"${schema}".gin_trgm_ops`

    try {
      await sequelize.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_alias_trgm
         ON products USING gin (alias ${opclass})`
      )
    } catch (e) {
      // CONCURRENTLY 失败 → 清掉可能残留的 invalid 索引 → 退回普通建索引
      console.warn(`⚠️  alias 索引并发创建失败（${e.message}），改用普通建索引`)
      await sequelize.query('DROP INDEX IF EXISTS idx_product_alias_trgm').catch(() => {})
      await sequelize.query(
        `CREATE INDEX IF NOT EXISTS idx_product_alias_trgm
         ON products USING gin (alias ${opclass})`
      )
    }

    await sequelize.query('ANALYZE products')
    console.log('✅ products 已加 alias trigram 搜索索引')
  },
  async down (queryInterface, sequelize) {
    await sequelize.query('DROP INDEX IF EXISTS idx_product_alias_trgm')
  }
}
