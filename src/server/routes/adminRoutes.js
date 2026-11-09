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
import { getRuntimeMetrics } from '../middlewares/observability.js'
import { validate, promotionPayloadSchema, promotionStatusSchema, couponTemplatePayloadSchema, couponTemplateStatusSchema, bundlePayloadSchema, bundleStatusSchema } from '../middlewares/validate.js'

const router = express.Router()

// 管理员登录：限流 + 失败次数过阈值时强制验证码，防暴力破解
router.post('/login', loginLimiter, requireCaptchaAfterFailures(), AdministratorController.login)

/**
 * 初始化超级管理员：必须 INIT_SECRET 校验（控制器内强制）；
 * 同时保留每 IP 极低限速避免被持续探测
 */
router.post('/init', loginLimiter, AdministratorController.initSuperAdmin)

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
router.put('/after-sales/:id/status', requirePermission('orders'), logOperation('review_after_sale', 'after_sale'), AfterSaleController.review)

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
router.get('/users', requirePermission('users'), UserController.getAllUsers)
router.put('/users/:id/status', requirePermission('users'), logOperation('update_user_status', 'user'), UserController.updateUserStatus)
router.get('/users/:userId/addresses', requirePermission('users'), AddressController.getAdminUserAddresses)

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

// 固定组合包（P4；与产品共用 products 权限）
router.get('/bundles', requirePermission('products'), BundleAdminController.list)
router.post('/bundles', requirePermission('products'), logOperation('create_bundle', 'bundle'), validate({ body: bundlePayloadSchema }), BundleAdminController.create)
router.put('/bundles/:id', requirePermission('products'), logOperation('update_bundle', 'bundle'), validate({ body: bundlePayloadSchema }), BundleAdminController.update)
router.put('/bundles/:id/status', requirePermission('products'), logOperation('update_bundle_status', 'bundle'), validate({ body: bundleStatusSchema }), BundleAdminController.updateStatus)
router.delete('/bundles/:id', requirePermission('products'), logOperation('delete_bundle', 'bundle'), BundleAdminController.remove)

// 操作日志路由（仅超级管理员）
router.get('/operation-logs', requireSuperAdmin, AdministratorController.getOperationLogs)
router.get('/metrics', requireSuperAdmin, (req, res) => {
  res.json({ success: true, data: getRuntimeMetrics() })
})

export default router
