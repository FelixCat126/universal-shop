import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import ProductCategory from '../models/ProductCategory.js'

const DEFAULT_CATEGORY_NAMES = ['MBAR 9K', 'MBAR 10K', 'MBAR 12K', 'MBAR WEED']

/**
 * 增量、幂等迁移（可随时重复执行）：
 * - CREATE `product_categories`（通过 sync）及默认四类「仅缺失时插入」
 * - 若 `products` 无 category_id 列则 ADD COLUMN，不删旧 `category` 文本列（若存在）
 * - 仅为 category_id IS NULL 的商品回填为首类 ID，不改已有赋值
 */

export async function ensureProductCategoriesMigrate () {
  const qi = sequelize.getQueryInterface()
  await ProductCategory.sync()

  for (let i = 0; i < DEFAULT_CATEGORY_NAMES.length; i++) {
    const name = DEFAULT_CATEGORY_NAMES[i]
    await ProductCategory.findOrCreate({
      where: { name },
      defaults: { sort_order: i }
    })
  }

  const desc = await qi.describeTable('products')
  if (!desc.category_id) {
    await qi.addColumn('products', 'category_id', {
      type: DataTypes.INTEGER,
      allowNull: true
    })
  }

  const first = await ProductCategory.findOne({ order: [['sort_order', 'ASC'], ['id', 'ASC']] })
  if (!first) return

  await sequelize.query(
    'UPDATE products SET category_id = :cid WHERE category_id IS NULL',
    { replacements: { cid: first.id } }
  )
}
