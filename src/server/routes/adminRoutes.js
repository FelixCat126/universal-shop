import express from 'express'
import OrderController from '../controllers/orderController.js'
import UserController from '../controllers/userController.js'
import AdministratorController from '../controllers/administratorController.js'
import AddressController from '../controllers/addressController.js'
import { authenticateAdmin, requirePermission, requireSuperAdmin, logOperation } from '../middlewares/adminAuthMiddleware.js'
import { loginLimiter, exportLimiter, writeLimiter } from '../middlewares/security.js'
import { requireCaptchaAfterFailures } from '../middlewares/loginGuard.js'

import ProductCategoryController from '../controllers/productCategoryController.js'
import PartnerAdminController from '../controllers/partnerAdminController.js'
import PartnerCsvController from '../controllers/partnerCsvController.js'
import UserCsvController from '../controllers/userCsvController.js'
import { csvUpload } from '../controllers/productCsvController.js'
import PromotionController from '../controllers/promotionController.js'
import CouponAdminController from '../controllers/couponAdminController.js'
import BundleAdminController from '../controllers/bundleAdminController.js'
import AfterSaleController from '../controllers/afterSaleController.js'
import AdminPointsController from '../controllers/adminPointsController.js'
import ReconciliationController from '../controllers/reconciliationController.js'
import { getRuntimeMetrics } from '../middlewares/observability.js'
import { validate, promotionPayloadSchema, promotionStatusSchema, couponTemplatePayloadSchema, couponTemplateStatusSchema, couponGrantSchema, couponVoidSchema, bundlePayloadSchema, bundleStatusSchema } from '../middlewares/validate.js'

const router = express.Router()

// 管理员登录：限流 + 失败次数过阈值时强制验证码，防暴力破解

/**
 * 管理员级收口（admin / super_admin）。
 *
 * 用于**资损级写操作**：订单退款审批、重置客户密码等 ——
 * 这些不是"日常运营操作"，操作员（operator）不该有权做。
 */
const requireAdminOnly = (req, res, next) => {
  const role = req.admin?.role
  if (role === 'super_admin' || role === 'admin') return next()
  return res.status(403).json({
    success: false,
    message: '需要管理员权限（操作员不能执行该操作）'
  })
}

router.post('/login', loginLimiter, requireCaptchaAfterFailures(), AdministratorController.login)

/**
 * 初始化超级管理员：必须 INIT_SECRET 校验（控制器内强制）；
 * 同时保留每 IP 极低限速避免被持续探测
 */
router.post('/init', loginLimiter, AdministratorController.initSuperAdmin)

/**
 * 管理员**自己**的账号信息与改密。
 *
 * 这两个接口在"强制改密"期间**必须放行**（见 adminAuthMiddleware 的白名单）——
 * 否则被标记的管理员会被自己锁在门外（改密页都打不开）。
 */
router.get('/me', authenticateAdmin, (req, res) => {
  res.json({
    success: true,
    data: {
      id: req.admin.id,
      username: req.admin.username,
      role: req.admin.role,
      email: req.admin.email,
      must_reset_password: req.admin.mustResetPassword === true
    }
  })
})

router.put('/me/password', authenticateAdmin, AdministratorController.changeMyPassword)

// 验证token（需要认证）
router.get('/validate-token', authenticateAdmin, (req, res) => {
  res.json({
    success: true,
    message: 'Token有效',
    data: {
      admin: req.admin
    }
  })
})

// 以下路由需要管理员认证
router.use(authenticateAdmin)

// 管理员订单路由（需要orders权限）
// 注意：具体路径必须放在 /:id 通配之前，否则 GET /orders/export 会被 /orders/:id 抢先匹配
router.get('/orders/export', requirePermission('orders'), exportLimiter, logOperation('export', 'orders'), OrderController.exportOrders)
router.get('/orders', requirePermission('orders'), OrderController.getAllOrders)
router.get('/orders/:id', requirePermission('orders'), OrderController.getOrderDetail)
// 批量改订单状态（一次最多 200 个；不合法的流转会跳过并回报）
router.post('/orders/bulk/status', requirePermission('orders'), logOperation('bulk_update_order_status', 'order'), OrderController.bulkUpdateOrderStatus)
router.put('/orders/:id/status', requirePermission('orders'), logOperation('update_order_status', 'order'), OrderController.updateOrderStatus)
router.delete('/orders/:id', requireSuperAdmin, logOperation('delete_order', 'order'), OrderController.deleteOrder)
router.get('/after-sales', requirePermission('orders'), AfterSaleController.listAdmin)
/**
 * 售后审批要收口到管理员（admin/super_admin）。
 *
 * 为什么：审批通过 = 订单取消 + 收积分 + 收券 + 回补库存 —— **资损级写操作**。
 * 之前只挂 requirePermission('orders')，而 operator 恰好有 orders 权限
 * → 操作员可以对**任意用户的在途订单**批退款。
 *
 * 与同文件「重置客户密码」的要求一致（那边已经用 requireUserAdmin 收口），
 * 两边都是"账号/资金级高危操作"，不该一个收一个不收。
 *
 * 列表（GET）仍然对 operator 开放 —— 看售后是客服的日常工作。
 */
router.put('/after-sales/:id/status', requirePermission('orders'), requireAdminOnly, logOperation('review_after_sale', 'after_sale'), AfterSaleController.review)

// 合作方（批发）与普通用户菜单隔离：独立 permission partners
/**
 * CSV 批量导入合作方：**必须排在 GET /:id 之前** ——
 * 否则 "/export.csv" 会被 "/:id" 抢先匹配，id 解析失败变成 400。
 */
router.get('/partners/export.csv', requirePermission('partners'), PartnerCsvController.exportPartners)
router.post(
  '/partners/import',
  requirePermission('partners'),
  writeLimiter,
  logOperation('import_partners_csv', 'partner'),
  csvUpload.single('file'),
  PartnerCsvController.importPartners
)
router.get('/partners', requirePermission('partners'), PartnerAdminController.listPartners)
router.post('/partners', requirePermission('partners'), logOperation('create_partner', 'partner'), PartnerAdminController.createPartner)
router.put('/partners/:id', requirePermission('partners'), logOperation('update_partner', 'partner'), PartnerAdminController.updatePartner)
router.put('/partners/:id/password', requirePermission('partners'), logOperation('reset_partner_password', 'partner'), PartnerAdminController.resetPartnerPassword)
router.delete('/partners/:id', requirePermission('partners'), logOperation('delete_partner', 'partner'), PartnerAdminController.deletePartner)
router.get('/partner-orders/export', requirePermission('partners'), exportLimiter, logOperation('export', 'partner_orders'), PartnerAdminController.exportPartnerOrders)
router.get('/partner-orders', requirePermission('partners'), PartnerAdminController.listPartnerOrders)
router.put('/partner-orders/:id/status', requirePermission('partners'), logOperation('update_partner_order_status', 'partner_order'), PartnerAdminController.updatePartnerOrderStatus)

// 管理员用户路由（需要users权限）
/**
 * CSV 批量导入用户：**必须排在 GET /:id 之前** ——
 * 否则 "/export.csv" 会被 "/:id" 抢先匹配，id 解析失败变成 400。
 *
 * 导入的账号走"邀请流程"：系统生成随机初始密码（只在导入结果里显示一次），
 * 账号标记 must_reset_password=true，用户首次登录被强制改密 ——
 * 密码永远不进 CSV，也永远不经运营的手。
 */
router.get('/users/export.csv', requirePermission('users'), UserCsvController.exportUsers)
router.post(
  '/users/import',
  requirePermission('users'),
  writeLimiter,
  logOperation('import_users_csv', 'user'),
  csvUpload.single('file'),
  UserCsvController.importUsers
)
/**
 * 管理端辅助重置客户密码。
 *
 * 为什么需要：客户忘记密码时的自助重置依赖**短信通道**（SMS_WEBHOOK_URL），
 * 线上没配短信 → forgot-password 直接返回 503。结果就是：客户忘了密码，
 * **永远回不来**，运营还帮不上（原来只有管理员账号能重置密码，客户账号没有这条路径）。
 *
 * 补上运营侧的兜底：生成随机临时密码 + 标记"必须改密"，
 * 临时密码**只在这里显示一次**，运营线下告知客户，客户首次登录被强制改密。
 */
/**
 * 重置密码是**账号级高危操作**（会顶掉客户的所有会话），
 * 比普通"改资料"更严：只允许 super_admin / admin ——
 * operator 能查/改用户，但不该能重置客户的密码。
 */
const requireUserAdmin = (req, res, next) => {
  const role = req.admin?.role
  if (role === 'super_admin' || role === 'admin') return next()
  return res.status(403).json({ success: false, message: '需要管理员权限（操作员不能重置客户密码）' })
}
router.put('/users/:id/password', requirePermission('users'), requireUserAdmin, logOperation('reset_user_password', 'user'), UserController.resetUserPassword)
router.get('/users', requirePermission('users'), UserController.getAllUsers)
router.put('/users/:id/status', requirePermission('users'), logOperation('update_user_status', 'user'), UserController.updateUserStatus)
/**
 * 管理端注销用户（第 46 轮）。
 *
 * 与「重置客户密码」同级 —— 账号级高危操作，收口到 admin/super_admin。
 * 语义是**匿名化**（历史订单/积分保留），不是物理删数据。
 */
router.delete('/users/:id', requirePermission('users'), requireUserAdmin, logOperation('delete_user_account', 'user'), UserController.deleteUserByAdmin)
router.get('/users/:userId/addresses', requirePermission('users'), AddressController.getAdminUserAddresses)

/**
 * 管理端积分管理（需要 users 权限）。
 *
 * 之前积分只能在用户侧查看自己的（/api/users/points/*），
 * 运营要补偿/纠错时**没有任何入口** —— 只能找开发改库。
 *
 * 权限沿用 users：积分挂在用户资产上，与「看/改用户」是同一件事，
 * 不另开一个权限位（角色表 ROLE_PERMISSIONS 里 operator/admin/super_admin 都有 users）。
 */
router.get('/points/overview', requirePermission('users'), AdminPointsController.getOverview)
router.get('/points/users', requirePermission('users'), AdminPointsController.listUserBalances)
router.get('/points/users/:userId/transactions', requirePermission('users'), AdminPointsController.listUserTransactions)
router.post('/points/users/:userId/adjust', requirePermission('users'), logOperation('adjust_user_points', 'user_points'), AdminPointsController.adjustUserPoints)

// 管理员管理路由（需要administrators权限）
router.get('/administrators', requirePermission('administrators'), AdministratorController.getAllAdministrators)
router.post('/administrators', requirePermission('administrators'), logOperation('create_administrator', 'administrator'), AdministratorController.createAdministrator)
router.put('/administrators/:id', requirePermission('administrators'), logOperation('update_administrator', 'administrator'), AdministratorController.updateAdministrator)
router.delete('/administrators/:id', requirePermission('administrators'), logOperation('delete_administrator', 'administrator'), AdministratorController.deleteAdministrator)
router.put('/administrators/:id/reset-password', requirePermission('administrators'), logOperation('reset_password', 'administrator'), AdministratorController.resetPassword)

// 商品类别（与产品共用 products 权限）
router.get('/product-categories', requirePermission('products'), ProductCategoryController.listAdmin)
router.post('/product-categories', requirePermission('products'), logOperation('create_product_category', 'product_category'), ProductCategoryController.create)
router.put('/product-categories/:id', requirePermission('products'), logOperation('update_product_category', 'product_category'), ProductCategoryController.update)
router.delete('/product-categories/:id', requirePermission('products'), logOperation('delete_product_category', 'product_category'), ProductCategoryController.remove)

// 促销活动（与产品共用 products 权限；P1 仅 threshold 满减）
router.get('/promotions', requirePermission('products'), PromotionController.list)
router.post('/promotions', requirePermission('products'), logOperation('create_promotion', 'promotion'), validate({ body: promotionPayloadSchema }), PromotionController.create)
router.put('/promotions/:id', requirePermission('products'), logOperation('update_promotion', 'promotion'), validate({ body: promotionPayloadSchema }), PromotionController.update)
router.put('/promotions/:id/status', requirePermission('products'), logOperation('update_promotion_status', 'promotion'), validate({ body: promotionStatusSchema }), PromotionController.updateStatus)
router.delete('/promotions/:id', requirePermission('products'), logOperation('delete_promotion', 'promotion'), PromotionController.remove)

// 抵扣券模板（P2 营销体系；与产品共用 products 权限）
router.get('/coupon-templates', requirePermission('products'), CouponAdminController.list)
router.post('/coupon-templates', requirePermission('products'), logOperation('create_coupon_template', 'coupon_template'), validate({ body: couponTemplatePayloadSchema }), CouponAdminController.create)
router.put('/coupon-templates/:id', requirePermission('products'), logOperation('update_coupon_template', 'coupon_template'), validate({ body: couponTemplatePayloadSchema }), CouponAdminController.update)
router.put('/coupon-templates/:id/status', requirePermission('products'), logOperation('update_coupon_template_status', 'coupon_template'), validate({ body: couponTemplateStatusSchema }), CouponAdminController.updateStatus)
router.get('/coupon-templates/:id/instances', requirePermission('products'), CouponAdminController.instances)
router.delete('/coupon-templates/:id', requirePermission('products'), logOperation('delete_coupon_template', 'coupon_template'), CouponAdminController.remove)
// 定向发券 / 作废券（与券模板同权限、同属 P2 营销体系；发放口径见 couponService）
router.post('/coupons/grant', requirePermission('products'), logOperation('grant_coupon_instance', 'coupon_instance'), validate({ body: couponGrantSchema }), CouponAdminController.grant)
router.post('/coupons/instances/:id/void', requirePermission('products'), logOperation('void_coupon_instance', 'coupon_instance'), validate({ body: couponVoidSchema }), CouponAdminController.voidInstance)

// 固定组合包（P4；与产品共用 products 权限）
router.get('/bundles', requirePermission('products'), BundleAdminController.list)
router.post('/bundles', requirePermission('products'), logOperation('create_bundle', 'bundle'), validate({ body: bundlePayloadSchema }), BundleAdminController.create)
router.put('/bundles/:id', requirePermission('products'), logOperation('update_bundle', 'bundle'), validate({ body: bundlePayloadSchema }), BundleAdminController.update)
router.put('/bundles/:id/status', requirePermission('products'), logOperation('update_bundle_status', 'bundle'), validate({ body: bundleStatusSchema }), BundleAdminController.updateStatus)
router.delete('/bundles/:id', requirePermission('products'), logOperation('delete_bundle', 'bundle'), BundleAdminController.remove)

// 操作日志路由（仅超级管理员）
router.get('/operation-logs', requireSuperAdmin, AdministratorController.getOperationLogs)
/**
 * 行为审计日志（第 46 轮）：用户与合作方的行为（登录/下单/改密…）。
 * 之前 AuditLog 只写不读 → 合作方的行为在运营侧完全无痕。
 * 权限与操作日志一致（super_admin —— 这是审计数据，含 IP 与 UA）。
 */
router.get('/audit-logs', requireSuperAdmin, AdministratorController.getAuditLogs)
/**
 * 支付对账台账（第 51 轮）
 * =========================
 *
 * 超时未支付被清扫掉的订单，单据在 `payment_reconciliation_records` 留了完整快照，
 * 运营在这里逐单核对"这笔钱到底收没收到"。
 *
 * 权限用**独立的 reconciliation 资源**（不给 operator）：
 * 标记「已收款」是财务动作，普通操作员不该有权标 —— 误标会让财务对账失真。
 *
 * ⚠️ 静态路径 `export` 必须排在 `/:id` 之前 —— 否则会被当成 id 解析掉。
 */
router.get('/reconciliation/export', requirePermission('reconciliation'), exportLimiter, logOperation('export', 'reconciliation'), ReconciliationController.exportRecords)
router.get('/reconciliation', requirePermission('reconciliation'), ReconciliationController.list)
router.get('/reconciliation/:id', requirePermission('reconciliation'), ReconciliationController.detail)
router.put('/reconciliation/:id', requirePermission('reconciliation'), writeLimiter, logOperation('review_reconciliation', 'payment_reconciliation_record'), ReconciliationController.update)
/**
 * 导出操作日志 CSV（第 46 轮）：之前只能看不能导 —— 留证/交给审计时只能截图。
 * 口径与列表一致（同一套筛选条件 → 同一批数据）。
 */
router.get('/operation-logs/export.csv', requireSuperAdmin, exportLimiter, AdministratorController.exportOperationLogs)
// 第 49 轮：单条详情（带 old_data/new_data 快照）—— 列表不再带这两个大字段
router.get('/operation-logs/:id', requireSuperAdmin, AdministratorController.getOperationLogDetail)
router.get('/metrics', requireSuperAdmin, (req, res) => {
  res.json({ success: true, data: getRuntimeMetrics() })
})

export default router
