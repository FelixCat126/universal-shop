import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import User from './User.js'
import Product from './Product.js'
import Bundle from './Bundle.js'

const Cart = sequelize.define('Cart', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true, // 允许匿名用户的购物车
    comment: '用户ID'
  },
  session_id: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: '会话ID（用于匿名用户购物车）'
  },
  product_id: {
    type: DataTypes.INTEGER,
    // P4 组合包行 product_id 为 NULL、bundle_id 有值；普通商品行反之（控制器保证二选一）
    allowNull: true,
    comment: '产品ID（组合包行为 NULL）'
  },
  bundle_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '组合包ID（P4）：组合包行有值，普通商品行为 NULL'
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: '数量'
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: '加入购物车时的价格（组合包行为组合价）'
  }
}, {
  tableName: 'carts',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  comment: '购物车表',
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['session_id']
    },
    {
      fields: ['product_id']
    },
    {
      unique: true,
      fields: ['user_id', 'product_id'],
      name: 'unique_user_product'
    },
    /**
     * 游客购物车（user_id 恒为 NULL）防双插：
     * PG 唯一索引把 NULL 视为互不相等，上面的 unique_user_product 对游客行完全不生效，
     * 并发/重试可在 (session_id, product_id) 上插入重复行；
     * 故补 user_id IS NULL 的部分唯一索引兜底（addToCart 撞索引后重读走更新分支）。
     */
    {
      unique: true,
      fields: ['session_id', 'product_id'],
      name: 'unique_session_product_guest',
      where: { user_id: null }
    }
    /**
     * 组合包行的两个部分唯一索引（unique_user_bundle / unique_session_bundle_guest）
     * 不在此声明：存量库的 bundle_id 列由 app.js ensureBundleColumns() 补建，
     * 若在模型声明，sync 会在补列前创建索引导致启动失败；
     * 两个索引由 ensureBundleColumns 的幂等 DDL 统一创建。
     */
  ]
})

// 定义关联关系
Cart.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
})

Cart.belongsTo(Product, {
  foreignKey: 'product_id',
  as: 'product'
})

Cart.belongsTo(Bundle, {
  foreignKey: 'bundle_id',
  as: 'bundle'
})

export default Cart