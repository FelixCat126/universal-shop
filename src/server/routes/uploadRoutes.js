import express from 'express'
import UploadController from '../controllers/uploadController.js'
import { authenticateToken } from '../middlewares/authMiddleware.js'
import { authenticateAdmin, requirePermission } from '../middlewares/adminAuthMiddleware.js'
import { writeLimiter } from '../middlewares/security.js'

const router = express.Router()

router.post(
  '/avatar',
  authenticateToken,
  writeLimiter,
  UploadController.uploadUserAvatar,
  UploadController.handleUserAvatarUpload
)

// 商品图片上传/删除：仅限管理员（修复 P0 任意上传/删除空洞）
router.post(
  '/product-image',
  authenticateAdmin,
  requirePermission('products'),
  writeLimiter,
  UploadController.uploadProductImage,
  UploadController.handleProductImageUpload
)
router.delete(
  '/product-image/:filename',
  authenticateAdmin,
  requirePermission('products'),
  writeLimiter,
  UploadController.deleteProductImage
)

export default router