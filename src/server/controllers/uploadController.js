import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 配置multer存储（商品图）
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../../../public/uploads/products')
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true })
    }
    cb(null, uploadPath)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const ext = path.extname(file.originalname)
    cb(null, 'product_' + uniqueSuffix + ext)
  }
})

const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../../../public/uploads/avatars')
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true })
    }
    cb(null, uploadPath)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const ext = path.extname(file.originalname)
    cb(null, 'avatar_' + uniqueSuffix + ext)
  }
})

// 文件过滤器 - 增强安全检查
const fileFilter = (req, file, cb) => {
  // 允许的MIME类型
  const allowedMimes = [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/gif',
    'image/webp'
  ]
  
  // 允许的文件扩展名
  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
  
  // 检查MIME类型
  if (!allowedMimes.includes(file.mimetype)) {
    return cb(new Error('不支持的文件类型，仅支持 JPG, PNG, GIF, WebP 格式图片'), false)
  }
  
  // 检查文件扩展名
  const ext = path.extname(file.originalname).toLowerCase()
  if (!allowedExts.includes(ext)) {
    return cb(new Error('不支持的文件扩展名'), false)
  }
  
  // 检查文件名安全性（防止路径遍历）
  if (file.originalname.includes('..') || file.originalname.includes('/') || file.originalname.includes('\\')) {
    return cb(new Error('文件名包含非法字符'), false)
  }
  
  cb(null, true)
}

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB
  },
  fileFilter: fileFilter
})

const avatarUpload = multer({
  storage: avatarStorage,
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
  fileFilter: fileFilter
})

class UploadController {
  static uploadProductImage = upload.single('image')
  static uploadUserAvatar = avatarUpload.single('avatar')

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

  static async handleUserAvatarUpload(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: '没有上传文件'
        })
      }

      const fileUrl = `/uploads/avatars/${req.file.filename}`

      res.json({
        success: true,
        message: '头像上传成功',
        data: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          url: fileUrl,
          size: req.file.size
        }
      })
    } catch (error) {
      console.error('上传头像失败:', error)
      res.status(500).json({
        success: false,
        message: '上传头像失败',
        error: error.message
      })
    }
  }

  // 删除产品图片
  static async deleteProductImage(req, res) {
    try {
      const { filename } = req.params
      
      // 验证文件名安全性，防止路径遍历攻击
      if (!filename || 
          filename.includes('..') || 
          filename.includes('/') || 
          filename.includes('\\') ||
          filename.startsWith('.') ||
          !/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|gif|webp)$/i.test(filename)) {
        return res.status(400).json({
          success: false,
          message: '无效的文件名'
        })
      }
      
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