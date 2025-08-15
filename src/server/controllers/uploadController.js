import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 配置multer存储
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../../../public/uploads/products')
    // 确保目录存在
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true })
    }
    cb(null, uploadPath)
  },
  filename: function (req, file, cb) {
    // 生成唯一文件名：时间戳_随机数.扩展名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const ext = path.extname(file.originalname)
    cb(null, 'product_' + uniqueSuffix + ext)
  }
})

// 文件过滤器
const fileFilter = (req, file, cb) => {
  // 检查文件类型
  if (file.mimetype.startsWith('image/')) {
    cb(null, true)
  } else {
    cb(new Error('只允许上传图片文件！'), false)
  }
}

// 创建multer实例
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB
  },
  fileFilter: fileFilter
})

class UploadController {
  // 上传产品图片
  static uploadProductImage = upload.single('image')

  static async handleProductImageUpload(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: '没有上传文件'
        })
      }

      // 构建文件URL
      const fileUrl = `/uploads/products/${req.file.filename}`

      res.json({
        success: true,
        message: '图片上传成功',
        data: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          url: fileUrl,
          size: req.file.size
        }
      })
    } catch (error) {
      console.error('上传图片失败:', error)
      res.status(500).json({
        success: false,
        message: '上传图片失败',
        error: error.message
      })
    }
  }

  // 删除产品图片
  static async deleteProductImage(req, res) {
    try {
      const { filename } = req.params
      const filePath = path.join(__dirname, '../../../public/uploads/products', filename)

      // 检查文件是否存在
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        res.json({
          success: true,
          message: '图片删除成功'
        })
      } else {
        res.status(404).json({
          success: false,
          message: '文件不存在'
        })
      }
    } catch (error) {
      console.error('删除图片失败:', error)
      res.status(500).json({
        success: false,
        message: '删除图片失败',
        error: error.message
      })
    }
  }
}

export default UploadController