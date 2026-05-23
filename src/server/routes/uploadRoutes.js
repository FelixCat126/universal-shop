import express from 'express'
import UploadController from '../controllers/uploadController.js'
import { authenticateToken } from '../middlewares/authMiddleware.js'
import { authenticateAdmin, requirePermission } from '../middlewares/adminAuthMiddleware.js'

const router = express.Router()

router.post(
  '/avatar',
  authenticateToken,
  UploadController.uploadUserAvatar,
  UploadController.handleUserAvatarUpload
)

// 商品图片上传/删除：仅限管理员（修复 P0 任意上传/删除空洞）
router.post(
  '/product-image',
  authenticateAdmin,
  requirePermission('products'),
  UploadController.uploadProductImage,
  UploadController.handleProductImageUpload
)
router.delete(
  '/product-image/:filename',
  authenticateAdmin,
  requirePermission('products'),
  UploadController.deleteProductImage
)

export default router