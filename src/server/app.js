import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sequelize from './config/database.js'
import { DataTypes } from 'sequelize'
import { prepareSchema } from './utils/schemaEnsures.js'
import {
  buildCorsOptions,
  globalLimiter,
  loginLimiter
} from './middlewares/security.js'
import { authenticateAdmin, requireSuperAdmin } from './middlewares/adminAuthMiddleware.js'
import { logger, requestLogger } from './utils/logger.js'
import { observabilityMiddleware, getRuntimeMetrics } from './middlewares/observability.js'
import productRoutes from './routes/productRoutes.js'
import productCategoryRoutes from './routes/productCategoryRoutes.js'
import uploadRoutes from './routes/uploadRoutes.js'
import userRoutes from './routes/userRoutes.js'
import cartRoutes from './routes/cartRoutes.js'
import orderRoutes from './routes/orderRoutes.js'
import addressRoutes from './routes/addressRoutes.js'
import adminRoutes from './routes/adminRoutes.js'
import exportRoutes from './routes/exportRoutes.js'
import statisticsRoutes from './routes/statisticsRoutes.js'
import systemConfigRoutes from './routes/systemConfigRoutes.js'
import administrativeRegionsRoutes from './routes/administrativeRegions.js'
import partnerRoutes from './routes/partnerRoutes.js'
import couponRoutes from './routes/couponRoutes.js'
import bundleRoutes from './routes/bundleRoutes.js'
import securityRoutes from './routes/securityRoutes.js'
import { startOrderTimeoutSweeper } from './services/orderTimeoutService.js'
import { startGuestAccountCleanup } from './services/guestAccountCleanup.js'
import { startRetentionCleanup } from './services/retentionService.js'

// 导入模型以确保数据库同步
import './models/User.js'
import './models/ProductCategory.js'
import './models/Product.js'
import './models/Cart.js'
import './models/Order.js'
import './models/OrderItem.js'
import './models/Address.js'
import './models/Administrator.js'
import './models/AdministrativeRegion.js'
import './models/OperationLog.js'
import './models/SystemConfig.js'
import SystemConfig from './models/SystemConfig.js'
import './models/UserPointBalance.js'
import './models/PointTransaction.js'
import './models/Partner.js'
import './models/PartnerOrder.js'
import './models/PartnerOrderItem.js'
import './models/PartnerAddress.js'
import './models/Promotion.js'
import './models/OrderPromotion.js'
import './models/CouponTemplate.js'
import './models/UserCoupon.js'
import './models/Bundle.js'
import './models/BundleItem.js'
import './models/AfterSale.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const projectRoot = path.join(__dirname, '../..')
const portalDir = path.join(projectRoot, 'dist/portal')
const adminDir = path.join(projectRoot, 'dist/admin')
const partnerDir = path.join(projectRoot, 'dist/partner')

const app = express()
const PORT = process.env.PORT || 3000

console.log('🚀 Universal Shop 服务器启动中...')
console.log('📍 工作目录:', __dirname)

/**
 * 反代场景下取真实客户端 IP（用于限流/日志/审计）
 * 通过 TRUST_PROXY 环境变量配置；默认为 'loopback' 安全策略
 */
const trustProxyRaw = process.env.TRUST_PROXY
if (trustProxyRaw != null && trustProxyRaw !== '') {
  const n = Number(trustProxyRaw)
  if (Number.isFinite(n)) app.set('trust proxy', n)
  else if (trustProxyRaw === 'true') app.set('trust proxy', true)
  else if (trustProxyRaw === 'false') app.set('trust proxy', false)
  else app.set('trust proxy', trustProxyRaw)
} else {
  app.set('trust proxy', 'loopback')
}

/**
 * Helmet 安全响应头：
 * - 开发环境关闭 CSP，便于调试；
 * - 生产环境严格 CSP（保留 'unsafe-inline' 是为兼容当前 SPA 内联脚本/样式，
 *   后续若改为 nonce/SRI 可下调）；
 * - HSTS 长期开启，需在 Nginx/SSL 终端 + HTTPS 才会生效；
 * - 支持通过环境变量追加 CDN/支付域，免改码：
 *     CSP_EXTRA_SCRIPT_SRC, CSP_EXTRA_STYLE_SRC, CSP_EXTRA_IMG_SRC,
 *     CSP_EXTRA_CONNECT_SRC, CSP_EXTRA_FRAME_SRC, CSP_EXTRA_FONT_SRC
 *   值为空格分隔的来源。
 */
const isProd = process.env.NODE_ENV === 'production'
const splitOrigins = (raw) => (raw || '').split(/\s+/).map(s => s.trim()).filter(Boolean)

app.use(helmet({
  contentSecurityPolicy: isProd
    ? {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'base-uri': ["'self'"],
          'object-src': ["'none'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'self'"],
          'upgrade-insecure-requests': [],
          'img-src': ["'self'", 'data:', 'blob:', ...splitOrigins(process.env.CSP_EXTRA_IMG_SRC)],
          'font-src': ["'self'", 'data:', ...splitOrigins(process.env.CSP_EXTRA_FONT_SRC)],
          // 'unsafe-eval' 兼容 echarts / element-plus / vue-i18n 内部 new Function 用法；
          // 没有它会让前端整页白屏。等切换到 strict-dynamic + nonce 后可下调。
          'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", ...splitOrigins(process.env.CSP_EXTRA_SCRIPT_SRC)],
          'style-src': ["'self'", "'unsafe-inline'", ...splitOrigins(process.env.CSP_EXTRA_STYLE_SRC)],
          // 支持 wss/ws（websocket 实时刷新），data: blob: 用于部分 SDK
          'connect-src': ["'self'", 'ws:', 'wss:', 'data:', 'blob:', ...splitOrigins(process.env.CSP_EXTRA_CONNECT_SRC)],
          'frame-src': ["'self'", ...splitOrigins(process.env.CSP_EXTRA_FRAME_SRC)],
          'worker-src': ["'self'", 'blob:']
        }
      }
    : false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: isProd
    ? { maxAge: 60 * 60 * 24 * 365, includeSubDomains: true, preload: false }
    : false,
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true
}))

/** 显式追加 Permissions-Policy，限制不必要的浏览器特性以减少 0day 暴露面 */
app.use((req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'usb=()',
      'magnetometer=()',
      'accelerometer=()',
      'gyroscope=()',
      'payment=(self)',
      'fullscreen=(self)',
      'autoplay=(self)'
    ].join(', ')
  )
  next()
})

app.use(compression())
app.use(cors(buildCorsOptions()))

/** 1MB 兜底：上传走 multer 路径；JSON/表单不应超过 1MB */
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))

/** 全站兜底限流（CC/扫描时拦截爆点；正常用户无感知） */
app.use('/api', globalLimiter)
/** 登录类聚焦限流（先 narrow 再放行） */
app.use(['/api/admin/login', '/api/users/login', '/api/auth/login', '/api/partner/login'], loginLimiter)

// 请求日志中间件（生产用 winston 落盘；开发/测试用控制台）
app.use(observabilityMiddleware)
app.use(requestLogger())

// Content-Type修复中间件
app.use((req, res, next) => {
  if (req.path.endsWith('.js')) {
    res.setHeader('Content-Type', 'application/javascript; charset=UTF-8')
  } else if (req.path.endsWith('.css')) {
    res.setHeader('Content-Type', 'text/css; charset=UTF-8')
  } else if (req.path.endsWith('.json')) {
    res.setHeader('Content-Type', 'application/json; charset=UTF-8')
  }
  next()
})

// 数据库连接和同步（PostgreSQL）
// 测试环境由 TestDatabase 接管 sync，避免与 vitest setup 重复跑出"relation does not exist"
// dbReady/dbReadyState 供 startServer 等待、/api/health 上报就绪状态；
// 测试环境该链不执行，直接视为就绪，保证 import app 不受影响
let dbReady
let dbReadyState
if (process.env.NODE_ENV !== 'test') {
  dbReadyState = 'pending'
  dbReady = sequelize.authenticate()
    .then(async () => {
      console.log('✅ 数据库连接成功')
      // 与 production-deploy-setup.mjs 共用同一把锁，防止多实例/部署并发迁移
      await sequelize.query('SELECT pg_advisory_lock(862427113)')
      return sequelize.sync({ alter: false })
    })
    .then(() => prepareSchema())
    .then(async () => {
      dbReadyState = 'ready'
      console.log('✅ 数据库模型同步成功')
      await sequelize.query('SELECT pg_advisory_unlock(862427113)').catch(() => {})
    })
    .then(() => {
      // 启动 pending 在线支付订单超时清扫（默认 10 分钟未支付自动删单回补库存）
      // 测试环境整条链不执行；startOrderTimeoutSweeper 内部也有 NODE_ENV==='test' 双保险
      // try/catch 兜底：清扫器启动失败不影响 dbReadyState='ready'，避免 /api/health 误报 503
      try {
        startOrderTimeoutSweeper()
        startGuestAccountCleanup()
        startRetentionCleanup()
      } catch (err) {
        console.error('⚠️ 订单超时清扫器启动失败（不影响主服务）:', err.message)
      }
    })
    .catch(async err => {
      dbReadyState = 'failed'
      await sequelize.query('SELECT pg_advisory_unlock(862427113)').catch(() => {})
      console.error('❌ 数据库连接或同步失败:', err.message)
      console.error('📋 详细错误信息:', err)
      if (err.sql) {
        console.error('📝 SQL语句:', err.sql)
      }
      // 保留原有错误输出后继续抛出，startServer 据此拒绝启动
      throw err
    })
} else {
  dbReadyState = 'ready'
  dbReady = Promise.resolve()
}

// API路由
console.log('🔧 注册API路由...')
app.use('/api/products', productRoutes)
app.use('/api/product-categories', productCategoryRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/users', userRoutes)
app.use('/api/cart', cartRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/addresses', addressRoutes)
app.use('/api/administrative-regions', administrativeRegionsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/admin/export', exportRoutes)
app.use('/api/admin/statistics', statisticsRoutes)
app.use('/api/system-config', systemConfigRoutes)
app.use('/api/auth', userRoutes)
app.use('/api/partner', partnerRoutes)
app.use('/api/coupons', couponRoutes)
app.use('/api/bundles', bundleRoutes)
app.use('/api/security', securityRoutes)

console.log('✅ API路由注册完成')

// 健康检查（必须在API 404处理之前）
app.get('/api/health', (req, res) => {
  // 数据库未就绪时返回 503，供探活/负载均衡摘流，避免冷启动窗口请求打到未同步的表
  if (dbReadyState !== 'ready') {
    return res.status(503).json({
      success: false,
      ready: false,
      message: '数据库未就绪',
      timestamp: new Date().toISOString(),
      port: PORT
    })
  }
  res.json({
    success: true,
    ready: true,
    message: '服务器运行正常 (HTTP模式)',
    timestamp: new Date().toISOString(),
    port: PORT
  })
})

/** 排查部署：返回 package 版本与 dist/portal/index.html 修改时间（确认是否已同步新前端；不暴露服务器绝对路径） */
app.get('/api/portal-build', authenticateAdmin, requireSuperAdmin, (req, res) => {
  try {
    const pkgPath = path.join(projectRoot, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const idx = path.join(portalDir, 'index.html')
    const st = fs.statSync(idx)
    res.json({
      success: true,
      appVersion: pkg.version,
      portalIndexModified: st.mtime.toISOString(),
      hint: '若公网仍为旧界面：对比 portalIndexModified 是否为本次部署时间；过旧则多为 Nginx/OSS 未指向本机 dist，或 CDN 缓存未刷新'
    })
  } catch (e) {
    logger.error('portal-build 读取失败', { err: e?.message, stack: e?.stack })
    res.status(500).json({ success: false, message: '读取构建信息失败', code: 'INTERNAL_SERVER_ERROR' })
  }
})

// API 404处理
app.use('/api/*', (req, res) => {
  console.log('❌ API 404:', req.originalUrl)
  res.status(404).json({
    success: false,
    message: 'API接口不存在',
    path: req.originalUrl
  })
})

// 静态文件服务
console.log('📁 Portal目录:', portalDir)
console.log('📁 Admin目录:', adminDir)
console.log('📁 Partner目录:', partnerDir)

/** 避免浏览器长期缓存 SPA 的 index.html，否则部署后仍引用旧 hash 的 JS/CSS */
function setNoCacheHtml (res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

// 上传文件
app.use('/uploads', express.static(path.join(projectRoot, 'public/uploads'), {
  maxAge: '30d'
}))

// Portal静态资源
app.use('/portal/assets', express.static(path.join(portalDir, 'assets'), {
  immutable: true,
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8')
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=UTF-8')
    }
  }
}))

app.use('/portal', express.static(portalDir, {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      setNoCacheHtml(res)
    }
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8')
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=UTF-8')
    }
  }
}))

// Admin静态资源
app.use('/admin/assets', express.static(path.join(adminDir, 'assets'), {
  immutable: true,
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8')
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=UTF-8')
    }
  }
}))

app.use('/admin', express.static(adminDir, {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      setNoCacheHtml(res)
    }
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8')
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=UTF-8')
    }
  }
}))

// Partner（合作方门户 / 批发订货）静态资源
app.use('/partner/assets', express.static(path.join(partnerDir, 'assets'), {
  immutable: true,
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8')
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=UTF-8')
    }
  }
}))

app.use('/partner', express.static(partnerDir, {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      setNoCacheHtml(res)
    }
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8')
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=UTF-8')
    }
  }
}))


// SPA路由处理
app.get('/portal/*', (req, res, next) => {
  
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)$/)) {
    console.log('📄 静态资源，跳过SPA处理')
    return next()
  }
  
  console.log('📱 返回Portal index.html')
  setNoCacheHtml(res)
  res.sendFile(path.join(portalDir, 'index.html'))
})

app.get('/admin/*', (req, res, next) => {
  
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)$/)) {
    console.log('📄 静态资源，跳过SPA处理')
    return next()
  }
  
  console.log('🔧 返回Admin index.html')
  setNoCacheHtml(res)
  res.sendFile(path.join(adminDir, 'index.html'))
})

app.get('/partner/*', (req, res, next) => {
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)$/)) {
    return next()
  }
  setNoCacheHtml(res)
  res.sendFile(path.join(partnerDir, 'index.html'))
})

// 根路径重定向
app.get('/', (req, res) => {
  res.redirect('/portal/')
})

// 404处理和统一错误处理
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js'

app.use('*', notFoundHandler)
app.use(errorHandler)

// 启动服务器函数
export async function startServer() {
  // 先等待数据库就绪；失败即退出（非零码），避免冷启动窗口内请求打到未同步的表返回 500
  try {
    await dbReady
  } catch {
    console.error('❌ 数据库未就绪，服务器拒绝启动')
    process.exit(1)
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log('')
    console.log('🎉 Universal Shop 启动成功！')
    console.log('================================================')
    console.log(`🌐 HTTP服务器: http://0.0.0.0:${PORT}`)
    console.log(`📱 用户门户: http://localhost:${PORT}/portal/`)
    console.log(`🔧 管理后台: http://localhost:${PORT}/admin/`)
    console.log(`🤝 合作方门户: http://localhost:${PORT}/partner/`)
    console.log(`🩺 健康检查: http://localhost:${PORT}/api/health`)
    if (process.env.NODE_ENV !== 'production') {
      console.log('------------------------------------------------')
      console.log('🔥 开发热更新（改 Vue 源码后此处才即时生效）：')
      console.log('   门户 Dev  http://localhost:3001/        （vite.config.js）')
      console.log('   管理后台  http://localhost:3002/admin/  （vite.admin.config.js）')
      console.log('   合作方门户  http://localhost:3003/partner/ （vite.partner.config.js）')
      console.log('ℹ️  :3000 上的 /portal、/admin、/partner 来自 dist/** 构建文件；')
      console.log('   若在 :3000 打开后台没看到最新界面，请先访问 :3002，或执行 npm run build:admin')
      console.log('   合作方页面同理：:3003 或 npm run build:partner')
      console.log('------------------------------------------------')
    }
    console.log('================================================')
    console.log('💡 提示: 按 Ctrl+C 停止服务')
    console.log('')
  })
}

export default app
