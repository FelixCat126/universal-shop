import express from 'express'
import UploadController from '../controllers/uploadController.js'
import { authenticateToken } from '../middlewares/authMiddleware.js'

const router = express.Router()

router.post(
  '/avatar',
  authenticateToken,
  UploadController.uploadUserAvatar,
  UploadController.handleUserAvatarUpload
)

// 上传产品图片
router.post('/product-image', UploadController.uploadProductImage, UploadController.handleProductImageUpload)

// 删除产品图片 
router.delete('/product-image/:filename', UploadController.deleteProductImage)

export default router