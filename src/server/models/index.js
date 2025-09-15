/**
 * 模型统一导入和关联关系定义
 * 确保所有模型都被正确导入，关联关系正确建立
 */

// 导入数据库连接
import sequelize from '../config/database.js'

// 导入所有模型
import User from './User.js'
import Administrator from './Administrator.js'
import Product from './Product.js'
import Cart from './Cart.js'
import Order from './Order.js'
import OrderItem from './OrderItem.js'
import Address from './Address.js'
import AdministrativeRegion from './AdministrativeRegion.js'
import SystemConfig from './SystemConfig.js'
import OperationLog from './OperationLog.js'

// 注意：关联关系已在各个模型文件中定义，无需重复定义
console.log('✅ 所有数据库模型已导入')

// 导出所有模型
export {
  sequelize,
  User,
  Administrator,
  Product,
  Cart,
  Order,
  OrderItem,
  Address,
  AdministrativeRegion,
  SystemConfig,
  OperationLog
}

// 导出默认对象
export default {
  sequelize,
  User,
  Administrator,
  Product,
  Cart,
  Order,
  OrderItem,
  Address,
  AdministrativeRegion,
  SystemConfig,
  OperationLog
}
