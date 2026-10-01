import { DataTypes } from 'sequelize'
import sequelize from '../config/database.js'
import Order from './Order.js'
import Product from './Product.js'

const OrderItem = sequelize.define('OrderItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  order_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: Order,
      key: 'id'
    },
    comment: '订单ID'
  },
  product_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: Product,
      key: 'id'
    },
    comment: '商品ID'
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    comment: '购买数量'
  },
  price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: '购买时的商品单价（实际支付价格，已考虑折扣）'
  },
  original_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: '商品原价（未折扣前的价格）'
  },
  discount: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '购买时的折扣百分比'
  },
  product_name_zh: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '商品中文名称快照'
  },
  product_name_th: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: '商品泰文名称快照'
  },
  points_line_cost: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null,
    comment: '该行换购所用积分快照（每件×数量；非积分单可为 0）'
  },
  discount_allocated: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    comment: '该行分摊的订单级促销优惠金额（THB 域；满减按行小计占比分摊，尾差归金额最大行）'
  },
  is_gift: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: '是否赠品行（P3 买多赠一）：赠品行 price/original_price=0、不参与金额与分摊；取消/删除时照常回补库存'
  },
  bundle_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: '组合包ID（P4）：组合包展开成的组件行记录来源 bundle.id；普通商品行为 NULL'
  }
}, {
  tableName: 'order_items',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  comment: '订单项表',
  indexes: [
    {
      fields: ['order_id']
    },
    {
      fields: ['product_id']
    }
  ]
})

// 建立关联关系
OrderItem.belongsTo(Order, { foreignKey: 'order_id', as: 'order' })
OrderItem.belongsTo(Product, { foreignKey: 'product_id', as: 'product' })

// 反向关联
Order.hasMany(OrderItem, { foreignKey: 'order_id', as: 'items' })
Product.hasMany(OrderItem, { foreignKey: 'product_id', as: 'orderItems' })

export default OrderItem