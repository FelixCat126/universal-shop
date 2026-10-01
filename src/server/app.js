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
import { ensureProductCategoriesMigrate } from './utils/ensureProductCategoriesMigrate.js'
import {
  buildCorsOptions,
  globalLimiter,
  loginLimiter
} from './middlewares/security.js'
import { logger, requestLogger } from './utils/logger.js'
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

async function ensureUserAvatarUrlColumn () {
  const qi = sequelize.getQueryInterface()
  const desc = await qi.describeTable('users')
  if (!desc.avatar_url) {
    await qi.addColumn('users', 'avatar_url', {
      type: DataTypes.STRING(512),
      allowNull: true
    })
    console.log('✅ 已为 users 表添加 avatar_url 字段')
  }
  if (!desc.must_reset_password) {
    await qi.addColumn('users', 'must_reset_password', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    })
    console.log('✅ 已为 users 表添加 must_reset_password 字段')
  }
}

async function ensureProductPointsColumn () {
  const qi = sequelize.getQueryInterface()
  const desc = await qi.describeTable('products')
  if (!desc.points) {
    await qi.addColumn('products', 'points', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    })
    console.log('✅ 已为 products 表添加 points 字段')
  }
  if (!desc.name_th) {
    await qi.addColumn('products', 'name_th', {
      type: DataTypes.STRING(200),
      allowNull: true
    })
    console.log('✅ 已为 products 表添加 name_th 字段')
  }
}

async function ensureOrderBillingColumns () {
  const qi = sequelize.getQueryInterface()
  const desc = await qi.describeTable('orders')
  if (!desc.currency_code) {
    await qi.addColumn('orders', 'currency_code', {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'THB'
    })
    await sequelize.query(`UPDATE orders SET currency_code = 'THB' WHERE currency_code IS NULL OR currency_code = ''`)
    console.log('✅ 已为 orders 表添加 currency_code 字段')
  }
  if (!desc.total_amount_thb) {
    await qi.addColumn('orders', 'total_amount_thb', {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    })
    await sequelize.query(`UPDATE orders SET total_amount_thb = total_amount WHERE total_amount_thb IS NULL`)
    console.log('✅ 已为 orders 表添加 total_amount_thb（并由原 total_amount 回填泰铢）')
  }
}

async function ensureOrderPointsRedeemedColumn () {
  const qi = sequelize.getQueryInterface()
  const desc = await qi.describeTable('orders')
  if (!desc.points_redeemed) {
    await qi.addColumn('orders', 'points_redeemed', {
      type: DataTypes.INTEGER,
      allowNull: true
    })
    console.log('✅ 已为 orders 表添加 points_redeemed 字段')
  }
}

async function ensureOrderItemPointsLineCostColumn () {
  const qi = sequelize.getQueryInterface()
  const desc = await qi.describeTable('order_items')
  if (!desc.points_line_cost) {
    await qi.addColumn('order_items', 'points_line_cost', {
      type: DataTypes.INTEGER,
      allowNull: true
    })
    console.log('✅ 已为 order_items 表添加 points_line_cost 字段')
  }
}

/** 订单促销补列：discount_amount（订单级减免合计）/ order_items.discount_allocated（行分摊优惠），IF NOT EXISTS 幂等 */
async function ensurePromotionColumns () {
  await sequelize.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0')
  await sequelize.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS discount_allocated DECIMAL(10,2) NOT NULL DEFAULT 0')
}

/** P3 买多赠一补列：order_items.is_gift（赠品行标识），IF NOT EXISTS 幂等 */
async function ensureOrderItemIsGiftColumn () {
  await sequelize.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS is_gift BOOLEAN NOT NULL DEFAULT false')
}

/**
 * P4 组合包补列与索引（全部幂等）：
 * - carts.bundle_id（组合包行）、carts.product_id 放开 NOT NULL（组合包行 product_id 为 NULL；
 *   DROP NOT NULL 在 PG 下天然幂等，重复执行无副作用）；
 * - order_items.bundle_id（组合包展开组件行的来源标记）；
 * - carts 两个 bundle 部分唯一索引（与模型 indexes 同名，sync 已建则 IF NOT EXISTS 跳过）
 */
async function ensureBundleColumns () {
  await sequelize.query('ALTER TABLE carts ADD COLUMN IF NOT EXISTS bundle_id INTEGER NULL')
  await sequelize.query('ALTER TABLE carts ALTER COLUMN product_id DROP NOT NULL')
  await sequelize.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS bundle_id INTEGER NULL')
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS unique_user_bundle ON carts (user_id, bundle_id) WHERE bundle_id IS NOT NULL')
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS unique_session_bundle_guest ON carts (session_id, bundle_id) WHERE user_id IS NULL AND bundle_id IS NOT NULL')
}

/**
 * P2 抵扣券补列：order_promotions.user_coupon_id（券快照行）；
 * promotion_id 放开 NOT NULL（券快照行 promotion_id 为 NULL；
 * DROP NOT NULL 在 PG 下天然幂等，重复执行无副作用）
 */
async function ensureCouponColumns () {
  await sequelize.query('ALTER TABLE order_promotions ADD COLUMN IF NOT EXISTS user_coupon_id INTEGER NULL')
  await sequelize.query('ALTER TABLE order_promotions ALTER COLUMN promotion_id DROP NOT NULL')
}

/**
 * user_coupons.used_by_order_id 索引（与模型 indexes 同名，sync 已建则 IF NOT EXISTS 跳过）：
 * 订单取消/删除/超时清扫时 restoreOrderResources 按 used_by_order_id 条件 UPDATE 释放券，无索引会全表扫
 */
async function ensureUserCouponUsedByOrderIndex () {
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_user_coupons_used_by_order ON user_coupons (used_by_order_id)')
}

/** 旧库仅执行过 029 时缺列会导致合作方订单查询报错，启动时对齐模型字段 */
async function ensurePartnerOrderSchemaColumns () {
  const qi = sequelize.getQueryInterface()
  const orderDesc = await qi.describeTable('partner_orders').catch(() => null)
  if (!orderDesc) return

  if (!orderDesc.partner_address_id) {
    await qi.addColumn('partner_orders', 'partner_address_id', {
      type: DataTypes.INTEGER,
      allowNull: true
    })
    console.log('✅ 已为 partner_orders 添加 partner_address_id')
  }

  if (!orderDesc.online_paid_at) {
    await qi.addColumn('partner_orders', 'online_paid_at', {
      type: DataTypes.DATE,
      allowNull: true
    })
    console.log('✅ 已为 partner_orders 添加 online_paid_at（支付幂等）')
  }

  const itemDesc = await qi.describeTable('partner_order_items').catch(() => null)
  if (!itemDesc) return

  if (!itemDesc.product_image_snapshot) {
    await qi.addColumn('partner_order_items', 'product_image_snapshot', {
      type: DataTypes.STRING(512),
      allowNull: true
    })
    console.log('✅ 已为 partner_order_items 添加 product_image_snapshot')
  }
}

/** Order 表补列：online_paid_at（用于支付确认幂等） */
async function ensureOrderOnlinePaidAtColumn () {
  const qi = sequelize.getQueryInterface()
  const desc = await qi.describeTable('orders').catch(() => null)
  if (!desc) return
  if (!desc.online_paid_at) {
    await qi.addColumn('orders', 'online_paid_at', {
      type: DataTypes.DATE,
      allowNull: true
    })
    console.log('✅ 已为 orders 表添加 online_paid_at（支付幂等）')
  }
}

/**
 * orders / partner_orders 补 client_order_key（客户端幂等键）列与部分唯一索引：
 * - 列可空，仅非 NULL 的行参与唯一约束，历史数据与未带 key 的下单不受影响；
 * - 部分唯一索引兜底并发双击：同用户/同合作方 + 同 key 只允许落一张订单；
 * - partner 侧写入由合作方下单控制器负责，此处只负责两侧 DDL；
 * - CREATE UNIQUE INDEX IF NOT EXISTS 保证重复启动幂等
 */
async function ensureClientOrderKeyColumns () {
  const qi = sequelize.getQueryInterface()

  const orderDesc = await qi.describeTable('orders').catch(() => null)
  if (orderDesc && !orderDesc.client_order_key) {
    await qi.addColumn('orders', 'client_order_key', {
      type: DataTypes.STRING(64),
      allowNull: true
    })
    console.log('✅ 已为 orders 表添加 client_order_key 字段（客户端幂等键）')
  }

  const partnerOrderDesc = await qi.describeTable('partner_orders').catch(() => null)
  if (partnerOrderDesc && !partnerOrderDesc.client_order_key) {
    await qi.addColumn('partner_orders', 'client_order_key', {
      type: DataTypes.STRING(64),
      allowNull: true
    })
    console.log('✅ 已为 partner_orders 表添加 client_order_key 字段（客户端幂等键）')
  }

  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_user_client_key ON orders (user_id, client_order_key) WHERE client_order_key IS NOT NULL')
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS uniq_partner_orders_partner_client_key ON partner_orders (partner_id, client_order_key) WHERE client_order_key IS NOT NULL')
}

async function ensurePartnerAddressSchemaColumns () {
  const qi = sequelize.getQueryInterface()
  const desc = await qi.describeTable('partner_addresses').catch(() => null)
  if (!desc) return
  if (!desc.city) {
    await qi.addColumn('partner_addresses', 'city', {
      type: DataTypes.STRING(100),
      allowNull: true
    })
    console.log('✅ 已为 partner_addresses 添加 city')
  }
  if (!desc.postal_code) {
    await qi.addColumn('partner_addresses', 'postal_code', {
      type: DataTypes.STRING(10),
      allowNull: true
    })
    console.log('✅ 已为 partner_addresses 添加 postal_code')
  }
  if (!desc.phone_country_code) {
    await qi.addColumn('partner_addresses', 'phone_country_code', {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: '+66'
    })
    console.log('✅ 已为 partner_addresses 添加 phone_country_code')
  }
}

/** 旧库仅有 exchange_rate：补全 exchange_rates（JSON），不覆盖已有 exchange_rates */
async function ensureExchangeRatesConfig () {
  const existing = await SystemConfig.findOne({ where: { config_key: 'exchange_rates' } })
  if (existing) return
  const legacy = await SystemConfig.findOne({ where: { config_key: 'exchange_rate' } })
  let usd = 0
  if (legacy?.config_value != null && String(legacy.config_value).trim() !== '') {
    const n = parseFloat(legacy.config_value)
    if (Number.isFinite(n) && n >= 0) usd = Math.round(n * 100) / 100
  }
  const obj = normalizeExchangeRates({ USD: usd.toFixed(2), CNY: '0.00', MYR: '0.00' })
  await SystemConfig.setConfig('exchange_rates', obj, 'json', '多币种汇算（相对泰铢标价：金额×比例）')
  console.log('✅ 已补全 exchange_rates 配置（由旧 exchange_rate 迁移）')
}

// 数据库连接和同步（PostgreSQL）
// 测试环境由 TestDatabase 接管 sync，避免与 vitest setup 重复跑出"relation does not exist"
// dbReady/dbReadyState 供 startServer 等待、/api/health 上报就绪状态；
// 测试环境该链不执行，直接视为就绪，保证 import app 不受影响
let dbReady
let dbReadyState
if (process.env.NODE_ENV !== 'test') {
  dbReadyState = 'pending'
  dbReady = sequelize.authenticate()
    .then(() => {
      console.log('✅ 数据库连接成功')
      return sequelize.sync({ alter: false })
    })
    .then(() => ensureUserAvatarUrlColumn())
    .then(() => ensureProductPointsColumn())
    .then(() => ensureOrderBillingColumns())
    .then(() => ensureOrderPointsRedeemedColumn())
    .then(() => ensureOrderItemPointsLineCostColumn())
    .then(() => ensurePromotionColumns())
    .then(() => ensureCouponColumns())
    .then(() => ensureUserCouponUsedByOrderIndex())
    .then(() => ensureOrderItemIsGiftColumn())
    .then(() => ensureBundleColumns())
    .then(() => ensureOrderOnlinePaidAtColumn())
    .then(() => ensureClientOrderKeyColumns())
    .then(() => ensurePartnerOrderSchemaColumns())
    .then(() => ensurePartnerAddressSchemaColumns())
    .then(() => ensureExchangeRatesConfig())
    .then(() => ensureProductCategoriesMigrate())
    .then(() => {
      dbReadyState = 'ready'
      console.log('✅ 数据库模型同步成功')
    })
    .then(() => {
      // 启动 pending 在线支付订单超时清扫（默认 10 分钟未支付自动删单回补库存）
      // 测试环境整条链不执行；startOrderTimeoutSweeper 内部也有 NODE_ENV==='test' 双保险
      // try/catch 兜底：清扫器启动失败不影响 dbReadyState='ready'，避免 /api/health 误报 503
      try {
        startOrderTimeoutSweeper()
      } catch (err) {
        console.error('⚠️ 订单超时清扫器启动失败（不影响主服务）:', err.message)
      }
    })
    .catch(err => {
      dbReadyState = 'failed'
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
app.get('/api/portal-build', (req, res) => {
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
    res.status(500).json({ success: false, message: e.message })
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
