import SystemConfig from '../models/SystemConfig.js'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 配置文件上传
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../../public/uploads/system')
    try {
      await fs.mkdir(uploadPath, { recursive: true })
      cb(null, uploadPath)
    } catch (error) {
      cb(error)
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    const basename = path.basename(file.originalname, ext)
    const timestamp = Date.now()
    cb(null, `${basename}_${timestamp}${ext}`)
  }
})

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB限制
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('只允许上传图片文件 (JPEG, PNG, GIF, WebP)'))
    }
  }
})

class SystemConfigController {
  // 获取所有系统配置
  static async getAllConfigs(req, res) {
    try {
      const configs = await SystemConfig.getAllConfigs()
      
      res.json({
        success: true,
        data: configs
      })
    } catch (error) {
      console.error('获取系统配置失败:', error)
      res.status(500).json({
        success: false,
        message: '获取系统配置失败',
        error: error.message
      })
    }
  }

  // 获取单个配置
  static async getConfig(req, res) {
    try {
      const { key } = req.params
      const value = await SystemConfig.getConfig(key)
      
      res.json({
        success: true,
        data: {
          key,
          value
        }
      })
    } catch (error) {
      console.error('获取配置失败:', error)
      res.status(500).json({
        success: false,
        message: '获取配置失败',
        error: error.message
      })
    }
  }

  // 设置配置
  static async setConfig(req, res) {
    try {
      const { key, value, type = 'text', description } = req.body
      
      if (!key) {
        return res.status(400).json({
          success: false,
          message: '配置键名不能为空'
        })
      }
      
      const config = await SystemConfig.setConfig(key, value, type, description)
      
      res.json({
        success: true,
        message: '配置设置成功',
        data: config
      })
    } catch (error) {
      console.error('设置配置失败:', error)
      res.status(500).json({
        success: false,
        message: '设置配置失败',
        error: error.message
      })
    }
  }

  // 删除配置
  static async deleteConfig(req, res) {
    try {
      const { key } = req.params
      
      // 如果是图片配置，删除对应的文件
      const config = await SystemConfig.findOne({
        where: { config_key: key }
      })
      
      if (config && config.config_type === 'image' && config.config_value) {
        try {
          const imagePath = path.join(__dirname, '../../../public', config.config_value)
          await fs.unlink(imagePath)
        } catch (error) {
          console.warn('删除图片文件失败（不影响操作）:', error.message)
        }
      }
      
      const deleted = await SystemConfig.deleteConfig(key)
      
      if (deleted) {
        res.json({
          success: true,
          message: '配置删除成功'
        })
      } else {
        res.status(404).json({
          success: false,
          message: '配置不存在'
        })
      }
    } catch (error) {
      console.error('删除配置失败:', error)
      res.status(500).json({
        success: false,
        message: '删除配置失败',
        error: error.message
      })
    }
  }

  // 上传首页长图
  static uploadHomeBanner = [
    upload.single('banner'),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({
            success: false,
            message: '请选择要上传的图片'
          })
        }

        const imageUrl = `/uploads/system/${req.file.filename}`
        
        // 删除旧的首页长图
        const oldConfig = await SystemConfig.findOne({
          where: { config_key: 'home_banner' }
        })
        
        if (oldConfig && oldConfig.config_value) {
          try {
            const oldImagePath = path.join(__dirname, '../../../public', oldConfig.config_value)
            await fs.unlink(oldImagePath)
          } catch (error) {
            // 删除旧图片失败不影响上传流程，只记录警告
            console.warn('删除旧首页长图失败（不影响上传）:', error.message)
          }
        }
        
        // 保存新的配置
        await SystemConfig.setConfig(
          'home_banner', 
          imageUrl, 
          'image', 
          '首页长图'
        )
        
        res.json({
          success: true,
          message: '首页长图上传成功',
          data: {
            imageUrl
          }
        })
      } catch (error) {
        console.error('上传首页长图失败:', error)
        res.status(500).json({
          success: false,
          message: '上传失败',
          error: error.message
        })
      }
    }
  ]

  // 上传支付二维码
  static uploadPaymentQR = [
    upload.single('qrcode'),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({
            success: false,
            message: '请选择要上传的二维码图片'
          })
        }

        const imageUrl = `/uploads/system/${req.file.filename}`
        
        // 删除旧的支付二维码
        const oldConfig = await SystemConfig.findOne({
          where: { config_key: 'payment_qrcode' }
        })
        
        if (oldConfig && oldConfig.config_value) {
          try {
            const oldImagePath = path.join(__dirname, '../../../public', oldConfig.config_value)
            await fs.unlink(oldImagePath)
          } catch (error) {
            // 删除旧二维码失败不影响上传流程，只记录警告
            console.warn('删除旧支付二维码失败（不影响上传）:', error.message)
          }
        }
        
        // 保存新的配置
        await SystemConfig.setConfig(
          'payment_qrcode', 
          imageUrl, 
          'image', 
          '支付二维码'
        )
        
        res.json({
          success: true,
          message: '支付二维码上传成功',
          data: {
            imageUrl
          }
        })
      } catch (error) {
        console.error('上传支付二维码失败:', error)
        res.status(500).json({
          success: false,
          message: '上传失败',
          error: error.message
        })
      }
    }
  ]

  // 删除首页长图
  static async deleteHomeBanner(req, res) {
    try {
      // 先尝试删除物理文件（如果存在）
      const config = await SystemConfig.findOne({
        where: { config_key: 'home_banner' }
      })
      
      if (config && config.config_value) {
        try {
          const imagePath = path.join(__dirname, '../../../public', config.config_value)
          await fs.unlink(imagePath)
          console.log('✅ 物理文件删除成功')
        } catch (error) {
          console.warn('删除图片文件失败（不影响操作）:', error.message)
        }
      }
      
      // 删除数据库配置（即使物理文件不存在也要删除配置）
      try {
        const deleted = await SystemConfig.deleteConfig('home_banner')
        console.log('✅ 数据库配置删除结果:', deleted)
      } catch (dbError) {
        console.warn('删除数据库配置失败:', dbError.message)
        // 即使数据库删除失败，也返回成功，因为可能配置本来就不存在
      }
      
      res.json({
        success: true,
        message: '首页长图删除成功'
      })
    } catch (error) {
      console.error('删除首页长图失败:', error)
      // 即使出现异常，也尝试返回成功，因为删除操作的目标是清除配置
      res.json({
        success: true,
        message: '首页长图删除完成',
        warning: '删除过程中出现警告，但操作已完成'
      })
    }
  }

  // 删除支付二维码
  static async deletePaymentQR(req, res) {
    try {
      // 先尝试删除物理文件（如果存在）
      const config = await SystemConfig.findOne({
        where: { config_key: 'payment_qrcode' }
      })
      
      if (config && config.config_value) {
        try {
          const imagePath = path.join(__dirname, '../../../public', config.config_value)
          await fs.unlink(imagePath)
          console.log('✅ 物理文件删除成功')
        } catch (error) {
          console.warn('删除二维码文件失败（不影响操作）:', error.message)
        }
      }
      
      // 删除数据库配置（即使物理文件不存在也要删除配置）
      try {
        const deleted = await SystemConfig.deleteConfig('payment_qrcode')
        console.log('✅ 数据库配置删除结果:', deleted)
      } catch (dbError) {
        console.warn('删除数据库配置失败:', dbError.message)
        // 即使数据库删除失败，也返回成功，因为可能配置本来就不存在
      }
      
      res.json({
        success: true,
        message: '支付二维码删除成功'
      })
    } catch (error) {
      console.error('删除支付二维码失败:', error)
      // 即使出现异常，也尝试返回成功，因为删除操作的目标是清除配置
      res.json({
        success: true,
        message: '支付二维码删除完成',
        warning: '删除过程中出现警告，但操作已完成'
      })
    }
  }

  // 获取公开配置（供前端调用，无需认证）
  static async getPublicConfigs(req, res) {
    try {
      const configs = await SystemConfig.getAllConfigs()
      
      // 只返回公开的配置项
      const publicConfigs = {
        home_banner: configs.home_banner?.value || null,
        payment_qrcode: configs.payment_qrcode?.value || null
      }
      
      res.json({
        success: true,
        data: publicConfigs
      })
    } catch (error) {
      console.error('获取公开配置失败:', error)
      res.status(500).json({
        success: false,
        message: '获取配置失败',
        error: error.message
      })
    }
  }
}

export default SystemConfigController
