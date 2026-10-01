/**
 * 模型统一导入和关联关系定义
 * 确保所有模型都被正确导入，关联关系正确建立
 */

// 导入数据库连接
import sequelize from '../config/database.js'

// 导入所有模型
import User from './User.js'
import Administrator from './Administrator.js'
import ProductCategory from './ProductCategory.js'
import Product from './Product.js'
import Cart from './Cart.js'
import Order from './Order.js'
import OrderItem from './OrderItem.js'
import Address from './Address.js'
import AdministrativeRegion from './AdministrativeRegion.js'
import SystemConfig from './SystemConfig.js'
import OperationLog from './OperationLog.js'
import AuditLog from './AuditLog.js'
import './UserPointBalance.js'
import './PointTransaction.js'
import Partner from './Partner.js'
import PartnerOrder from './PartnerOrder.js'
import PartnerOrderItem from './PartnerOrderItem.js'
import PartnerAddress from './PartnerAddress.js'
import Promotion from './Promotion.js'
import OrderPromotion from './OrderPromotion.js'
import CouponTemplate from './CouponTemplate.js'
import UserCoupon from './UserCoupon.js'
import Bundle from './Bundle.js'
import BundleItem from './BundleItem.js'
import { logger } from '../utils/logger.js'

// 注意：关联关系已在各个模型文件中定义，无需重复定义
logger.info('✅ 所有数据库模型已导入')

// 导出所有模型
export {
  sequelize,
  User,
  Administrator,
  ProductCategory,
  Product,
  Cart,
  Order,
  OrderItem,
  Address,
  AdministrativeRegion,
  SystemConfig,
  OperationLog,
  AuditLog,
  Partner,
  PartnerOrder,
  PartnerOrderItem,
  PartnerAddress,
  Promotion,
  OrderPromotion,
  CouponTemplate,
  UserCoupon,
  Bundle,
  BundleItem
}

// 导出默认对象
export default {
  sequelize,
  User,
  Administrator,
  ProductCategory,
  Product,
  Cart,
  Order,
  OrderItem,
  Address,
  AdministrativeRegion,
  SystemConfig,
  OperationLog,
  AuditLog,
  Partner,
  PartnerOrder,
  PartnerOrderItem,
  PartnerAddress,
  Promotion,
  OrderPromotion,
  CouponTemplate,
  UserCoupon,
  Bundle,
  BundleItem
}
