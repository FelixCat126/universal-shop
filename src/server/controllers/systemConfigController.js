import SystemConfig from '../models/SystemConfig.js'
import { normalizeExchangeRates, FX_KEYS } from '../utils/exchangeRates.js'
import multer from 'multer'
import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { fileTypeFromFile } from 'file-type'
import { ApiError } from '../middlewares/errorHandler.js'
import { logger } from '../utils/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CURRENCY_CODES = ['THB', 'USD', 'CNY', 'MYR']

function normalizeCurrencyCodeForApi (raw) {
  if (raw == null || raw === '') return 'THB'
  const s = String(raw).trim()
  const u = s.toUpperCase()
  if (CURRENCY_CODES.includes(u)) return u
  if (s === '¥' || u === 'RMB' || s === '元') return 'CNY'
  if (s === '$' || s === '＄') return 'USD'
  if (s === '฿') return 'THB'
  return 'THB'
}

/** @param {{ [k: string]: { value?: unknown } } } configs SystemConfig.getAllConfigs 结果 */
function getNormalizedExchangeRatesForApi (configs) {
  const merged = configs.exchange_rates?.value
  if (merged && typeof merged === 'object') {
    return normalizeExchangeRates(merged)
  }
  const legacyStr = configs.exchange_rate?.value
  let usd = 0
  if (legacyStr != null && String(legacyStr).trim() !== '') {
    const n = parseFloat(legacyStr)
    if (Number.isFinite(n) && n >= 0) usd = Math.round(n * 100) / 100
  }
  return normalizeExchangeRates({ USD: usd.toFixed(2), CNY: '0.00', MYR: '0.00' })
}

function parseExchangeRatesBody (raw) {
  if (raw == null) return null
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw)
      return typeof j === 'object' && j !== null ? j : null
    } catch {
      return null
    }
  }
  return null
}
// 与 uploadController 保持一致的真实图片类型白名单（按魔法字节判定）
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/**
 * 通过读取文件魔法字节确认真实类型是否为白名单图片；
 * 不是则删除已写入的文件并抛出带 status=400 的错误。
 * 挂在 multer 写盘之后、业务处理之前执行，防止伪造 Content-Type / 改后缀上传。
 */
async function assertImageMagicBytes (filePath) {
  const sig = await fileTypeFromFile(filePath).catch(() => null)
  const ok = sig && ALLOWED_IMAGE_MIMES.has(sig.mime)
  if (!ok) {
    try { await fs.unlink(filePath) } catch {}
    const err = new Error('文件内容并非允许的图片格式（魔法字节校验失败）')
    err.status = 400
    throw err
  }
}

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
  // fileFilter 的错误会进入全局 errorHandler：用 ApiError 携带 400，否则按默认分支落成 500
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp']

    // 检查MIME类型
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new ApiError('只允许上传图片文件 (JPEG, PNG, GIF, WebP)', 400), false)
    }

    // 检查文件扩展名
    const ext = path.extname(file.originalname).toLowerCase()
    if (!allowedExts.includes(ext)) {
      return cb(new ApiError('不支持的文件扩展名', 400), false)
    }

    // 检查文件名安全性（防止路径遍历）
    if (file.originalname.includes('..') || file.originalname.includes('/') || file.originalname.includes('\\')) {
      return cb(new ApiError('文件名包含非法字符', 400), false)
    }

    cb(null, true)
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
      logger.error('获取系统配置失败', { err: error?.message, stack: error?.stack })
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
      logger.error('获取配置失败', { err: error?.message, stack: error?.stack })
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
      
      // 货币单位：仅允许 THB / USD / CNY / MYR，默认泰铢
      if (key === 'currency_unit') {
        const raw = value == null ? '' : String(value).trim().toUpperCase()
        if (!CURRENCY_CODES.includes(raw)) {
          return res.status(400).json({
            success: false,
            message: '货币单位必须是 THB（泰铢）、USD（美元）、CNY（人民币）或 MYR（马来西亚令吉）之一'
          })
        }
        const config = await SystemConfig.setConfig(
          key,
          raw,
          type || 'text',
          description || '全站货币代码 THB|USD|CNY|MYR'
        )
        return res.json({
          success: true,
          message: '货币单位已保存',
          data: config
        })
      }

      // 多币种汇算（相对泰铢标价）
      if (key === 'exchange_rates') {
        const parsed = parseExchangeRatesBody(value)
        if (!parsed) {
          return res.status(400).json({
            success: false,
            message: 'exchange_rates 须为 JSON 对象，包含 USD、CNY、MYR'
          })
        }
        const normalized = normalizeExchangeRates(parsed)
        for (const k of FX_KEYS) {
          const rawV = parsed[k]
          if (rawV != null && rawV !== '') {
            // 只接受 string/number 标量；数组/对象/boolean 等直接拒绝，防止强转出脏值
            if (typeof rawV !== 'string' && typeof rawV !== 'number') {
              return res.status(400).json({
                success: false,
                message: `${k} 汇率必须是有效的数字`
              })
            }
            const n = Number(String(rawV).trim())
            if (!Number.isFinite(n) || n < 0) {
              return res.status(400).json({
                success: false,
                message: `${k} 汇率必须是 ≥ 0 的有限数字`
              })
            }
            // 先 trim 再拆小数位（与下方单笔 exchange_rate 路径一致），避免 "7.25 " 被误判超 2 位小数
            const dec = String(rawV).trim().split('.')
            if (dec.length > 1 && dec[1].length > 2) {
              return res.status(400).json({
                success: false,
                message: `${k} 汇率小数位数不能超过2位`
              })
            }
          }
        }
        await SystemConfig.setConfig(
          'exchange_rates',
          normalized,
          'json',
          description || '多币种汇算（相对泰铢标价：金额×比例；USD 等同 USDT）'
        )
        await SystemConfig.setConfig('exchange_rate', normalized.USD, 'text', '兼容字段：与 USD 同步')
        return res.json({
          success: true,
          message: '汇率配置已保存',
          data: { exchange_rates: normalized }
        })
      }

      // 积分获取比例：每实付 1 泰铢获得的积分（发积分口径 floor(实付THB × rate)）
      // 只接受 string/number 标量；有限数且 0 ≤ rate ≤ 1，字符串存储
      if (key === 'points_earn_rate') {
        if (typeof value !== 'string' && typeof value !== 'number') {
          return res.status(400).json({
            success: false,
            message: '积分获取比例必须是有效的数字'
          })
        }
        const text = typeof value === 'string' ? value.trim() : String(value)
        // Number('') / Number('   ') 会被强转为 0，空串按无效数字拒绝
        const numValue = text === '' ? NaN : Number(text)
        if (!Number.isFinite(numValue)) {
          return res.status(400).json({
            success: false,
            message: '积分获取比例必须是有效的数字'
          })
        }
        if (numValue < 0 || numValue > 1) {
          return res.status(400).json({
            success: false,
            message: '积分获取比例必须在 0 ~ 1 之间'
          })
        }
        const config = await SystemConfig.setConfig(
          key,
          String(numValue),
          'text',
          description || '积分获取比例：每实付 1 泰铢获得的积分（默认 0.01，即每 100 泰铢 1 积分）'
        )
        return res.json({
          success: true,
          message: '积分获取比例已保存',
          data: config
        })
      }

      // 兼容：单笔 exchange_rate 视为美元/USDT 比例，并写回 exchange_rates.USD
      if (key === 'exchange_rate') {
        // 只接受 string/number 标量；数组/对象/boolean 直接 400，防止 parseFloat 强转出脏值
        if (typeof value !== 'string' && typeof value !== 'number') {
          return res.status(400).json({
            success: false,
            message: '汇算比例必须是有效的数字'
          })
        }
        const text = typeof value === 'string' ? value.trim() : String(value)
        // Number('') / Number('   ') 会被强转为 0，空串按无效数字拒绝
        const numValue = text === '' ? NaN : Number(text)

        if (!Number.isFinite(numValue)) {
          return res.status(400).json({
            success: false,
            message: '汇算比例必须是有效的数字'
          })
        }

        if (numValue < 0) {
          return res.status(400).json({
            success: false,
            message: '汇算比例不能为负数'
          })
        }

        const decimalParts = text.split('.')
        if (decimalParts.length > 1 && decimalParts[1].length > 2) {
          return res.status(400).json({
            success: false,
            message: '汇算比例小数位数不能超过2位'
          })
        }

        const formattedValue = numValue.toFixed(2)
        const merged = await SystemConfig.getConfig('exchange_rates')
        const base = merged && typeof merged === 'object' ? merged : {}
        const next = normalizeExchangeRates({ ...base, USD: formattedValue })
        await SystemConfig.setConfig('exchange_rates', next, 'json', '多币种汇算（相对泰铢标价：金额×比例；USD 等同 USDT）')
        const config = await SystemConfig.setConfig(key, next.USD, type, description)

        res.json({
          success: true,
          message: '汇算比例设置成功',
          data: config
        })
      } else {
        // 其他配置项的常规处理
        const config = await SystemConfig.setConfig(key, value, type, description)
        
        res.json({
          success: true,
          message: '配置设置成功',
          data: config
        })
      }
    } catch (error) {
      logger.error('设置配置失败', { err: error?.message, stack: error?.stack })
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
          logger.warn('删除图片文件失败（不影响操作）:', error.message)
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
      logger.error('删除配置失败', { err: error?.message, stack: error?.stack })
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

        // 魔法字节校验（防止伪造 Content-Type / 改后缀名上传），失败时文件已被删除
        try {
          await assertImageMagicBytes(req.file.path)
        } catch (e) {
          return res.status(e.status || 400).json({ success: false, message: e.message })
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
            logger.warn('删除旧首页长图失败（不影响上传）:', error.message)
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
        logger.error('上传首页长图失败', { err: error?.message, stack: error?.stack })
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

        // 魔法字节校验（防止伪造 Content-Type / 改后缀名上传），失败时文件已被删除
        try {
          await assertImageMagicBytes(req.file.path)
        } catch (e) {
          return res.status(e.status || 400).json({ success: false, message: e.message })
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
            logger.warn('删除旧支付二维码失败（不影响上传）:', error.message)
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
        logger.error('上传支付二维码失败', { err: error?.message, stack: error?.stack })
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
          logger.info('✅ 物理文件删除成功')
        } catch (error) {
          logger.warn('删除图片文件失败（不影响操作）:', error.message)
        }
      }
      
      // 删除数据库配置（即使物理文件不存在也要删除配置）
      try {
        const deleted = await SystemConfig.deleteConfig('home_banner')
        logger.info('✅ 数据库配置删除结果:', deleted)
      } catch (dbError) {
        logger.warn('删除数据库配置失败:', dbError.message)
        // 即使数据库删除失败，也返回成功，因为可能配置本来就不存在
      }
      
      res.json({
        success: true,
        message: '首页长图删除成功'
      })
    } catch (error) {
      logger.error('删除首页长图失败', { err: error?.message, stack: error?.stack })
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
          logger.info('✅ 物理文件删除成功')
        } catch (error) {
          logger.warn('删除二维码文件失败（不影响操作）:', error.message)
        }
      }
      
      // 删除数据库配置（即使物理文件不存在也要删除配置）
      try {
        const deleted = await SystemConfig.deleteConfig('payment_qrcode')
        logger.info('✅ 数据库配置删除结果:', deleted)
      } catch (dbError) {
        logger.warn('删除数据库配置失败:', dbError.message)
        // 即使数据库删除失败，也返回成功，因为可能配置本来就不存在
      }
      
      res.json({
        success: true,
        message: '支付二维码删除成功'
      })
    } catch (error) {
      logger.error('删除支付二维码失败', { err: error?.message, stack: error?.stack })
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
      const code = normalizeCurrencyCodeForApi(configs.currency_unit?.value)
      const rates = getNormalizedExchangeRatesForApi(configs)
      const publicConfigs = {
        home_banner: configs.home_banner?.value || null,
        payment_qrcode: configs.payment_qrcode?.value || null,
        exchange_rates: rates,
        /** 兼容旧订单/结算：与 USD 相同，表示泰铢总额 × 比例 = USDT（美元）金额 */
        exchange_rate: rates.USD,
        currency_code: code,
        /** @deprecated 与 currency_code 相同，兼容旧前端 */
        currency_unit: code
      }
      
      res.json({
        success: true,
        data: publicConfigs
      })
    } catch (error) {
      logger.error('获取公开配置失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取配置失败',
        error: error.message
      })
    }
  }
}

export default SystemConfigController
