import express from 'express'
import UploadController from '../controllers/uploadController.js'

const router = express.Router()

// 上传产品图片
router.post('/product-image', UploadController.uploadProductImage, UploadController.handleProductImageUpload)

// 删除产品图片 
router.delete('/product-image/:filename', UploadController.deleteProductImage)

export default router