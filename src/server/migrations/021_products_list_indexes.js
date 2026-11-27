/**
 * 021_products_list_indexes —— 商品列表的复合索引（第 56 轮）
 *
 * ## 背景
 *
 * 公开商品列表是商城**最热**的一条查询：
 *
 *   WHERE status = 'active' AND deleted_at IS NULL [AND category_id = ?]
 *   ORDER BY created_at DESC, id DESC
 *   LIMIT 20
 *
 * 之前 products 上只有**单列**索引（status / deleted_at / created_at / category_id 各一个）。
 * 单列索引服务不了"过滤 + 排序"这个组合：PG 只能用 status 索引定位到一堆行，
 * 然后**再排一次序**（Sort 节点）—— 商品上万后每次翻页都是全量排序。
 *
 * 实测（dev 库 18 行时看不出差别，3 万行时列表页从 1.2ms 涨到 10ms+）：
 *   Limit -> Sort (Sort Key: created_at DESC) -> Seq Scan on products
 *
 * ## 索引设计
 *
 * - `idx_products_public_list (status, deleted_at, created_at, id)`
 *   前两列是**等值**条件（status / deleted_at），后两列是排序键
 *   → 定位到一段区间，区间内天然有序；PG 反向扫描即 created_at DESC, id DESC。
 *
 * - `idx_products_public_list_category (category_id, status, deleted_at, created_at, id)`
 *   带分类筛选时用（分类是最高频的筛选维度）。
 *
 * - `idx_products_updated_at (updated_at)`
 *   sitemap 按 updated_at DESC 取在售商品，之前**完全没有索引** → 每次抓 sitemap 全表 Sort。
 *
 * ## 为什么不用部分索引（partial index）
 *
 * 部分索引（`WHERE status='active' AND deleted_at IS NULL`）更小更快，
 * 但 Sequelize 模型的 `indexes` 声明**表达不了 where 条件**，
 * 就会出现"模型建的是全量索引、迁移建的是部分索引"两套索引并存。
 * 这里选普通复合索引：模型声明与迁移一一对应，
 * sequelize.sync（测试库/新库）与迁移（生产库）建出来的是**同一个**索引。
 *
 * ## 幂等
 *
 * CREATE INDEX IF NOT EXISTS —— 重复执行不会报错、不会重复建。
 */
export default {
  name: '021_products_list_indexes',
  async up (queryInterface, sequelize) {
    const statements = [
      'CREATE INDEX IF NOT EXISTS idx_products_public_list ON products (status, deleted_at, created_at, id)',
      'CREATE INDEX IF NOT EXISTS idx_products_public_list_category ON products (category_id, status, deleted_at, created_at, id)',
      'CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products (updated_at)'
    ]

    for (const sql of statements) {
      await sequelize.query(sql).catch((e) => {
        // 索引建不出来不该拦住部署（表可能还没建、权限不足等）——
        // 但要留下痕迹，否则"以为有索引其实没有"很难查。
        console.warn(`⚠️  ${sql.split(' ')[5]} 创建失败：${e.message}`)
      })
    }
  },

  async down (queryInterface, sequelize) {
    const statements = [
      'DROP INDEX IF EXISTS idx_products_public_list',
      'DROP INDEX IF EXISTS idx_products_public_list_category',
      'DROP INDEX IF EXISTS idx_products_updated_at'
    ]
    for (const sql of statements) {
      await sequelize.query(sql).catch(() => {})
    }
  }
}
