import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import ProductCategory from './ProductCategory.js'
import { registerModelStatsInvalidation } from '../utils/statsCache.js'

const Product = sequelize.define('Product', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: '产品名称'
  },
  name_th: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: '泰文名称（用于多语种搜索）'
  },
  alias: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: '产品别名'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: '产品描述'
  },
  category_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '产品分类 ID（product_categories.id）',
    references: {
      model: 'product_categories',
      key: 'id'
    }
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0.00,
    comment: '产品价格（泰铢 THB）'
  },
  points: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: { min: 0 },
    comment: '购买所需积分（0 表示不启用积分兑换）'
  },
  discount: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null,
    validate: {
      min: 0,
      max: 100
    },
    comment: '折扣百分比(0-100)'
  },
  stock: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: '库存数量'
  },
  image: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: '产品图片URL'
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive'),
    defaultValue: 'active',
    comment: '产品状态'
  }
}, {
  tableName: 'products',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  paranoid: true,
  deletedAt: 'deleted_at',
  comment: '产品信息表',
  indexes: [
    /**
     * 第 56 轮新增的复合索引（与迁移 021_products_list_indexes.js 一一对应）。
     *
     * 为什么需要：公开列表的过滤+排序是
     *   WHERE status='active' AND deleted_at IS NULL [AND category_id=?]
     *   ORDER BY created_at DESC, id DESC
     * 之前只有单列索引（status / deleted_at / created_at 各自一个），
     * 排序**用不上任何索引** → 每次翻页都要全量 Sort。
     *
     * 索引写成 (status, deleted_at, created_at, id)：
     *   - 前两列是**等值**条件 → PG 能在索引里定位到一段区间
     *   - 后两列是排序键 → 区间内天然有序，倒着扫就是 created_at DESC
     *   - DESC/ASC 混排用普通 ASC 索引也能满足（PG 支持反向扫描）
     */
    {
      fields: ['status', 'deleted_at', 'created_at', 'id'],
      name: 'idx_products_public_list'
    },
    {
      fields: ['category_id', 'status', 'deleted_at', 'created_at', 'id'],
      name: 'idx_products_public_list_category'
    },
    {
      fields: ['updated_at'],
      name: 'idx_products_updated_at'
    },
    // 商品分类索引（用于分类筛选）
    {
      fields: ['category_id'],
      name: 'idx_product_category_id'
    },
    // 价格索引（用于价格排序和筛选）
    {
      fields: ['price'],
      name: 'idx_product_price'
    },
    // 商品状态索引（用于状态筛选）
    {
      fields: ['status'],
      name: 'idx_product_status'
    },
    // 库存索引（用于库存筛选）
    {
      fields: ['stock'],
      name: 'idx_product_stock'
    },
    // 商品名称索引（用于搜索）
    {
      fields: ['name'],
      name: 'idx_product_name'
    },
    // 创建时间索引（用于排序）
    {
      fields: ['created_at'],
      name: 'idx_product_created_at'
    },
    // 复合索引：状态+分类（常用组合查询）
    {
      fields: ['status', 'category_id'],
      name: 'idx_product_status_category_id'
    },
    {
      fields: ['deleted_at'],
      name: 'idx_product_deleted_at'
    }
  ]
})

Product.belongsTo(ProductCategory, {
  foreignKey: 'category_id',
  as: 'productCategory'
})

/**
 * 商品写入也让统计缓存失效。
 *
 * 面板上的"低库存 / 缺货"两个待办数是按 stock 统计的 ——
 * 运营刚调完库存就刷新面板，数字必须立刻变，
 * 否则会出现"卡上写着 3 个低库存，商品页里一个都没有"这种对不上的情况。
 */
registerModelStatsInvalidation(Product)

export default Product