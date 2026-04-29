import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sequelize from './config/database.js'
import { DataTypes } from 'sequelize'
import { ensureProductCategoriesMigrate } from './utils/ensureProductCategoriesMigrate.js'
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

import './models/UserPointBalance.js'
import './models/PointTransaction.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const projectRoot = path.join(__dirname, '../..')
const portalDir = path.join(projectRoot, 'dist/portal')
const adminDir = path.join(projectRoot, 'dist/admin')

const app = express()
const PORT = process.env.PORT || 3000

console.log('🚀 Universal Shop 服务器启动中...')
console.log('📍 工作目录:', __dirname)

// 基础中间件
app.use(cors({
  origin: true,
  credentials: true
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// 请求日志中间件
app.use((req, res, next) => {
  console.log(`📝 ${new Date().toISOString()} - ${req.method} ${req.path}`)
  next()
})

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

/** SQLite：旧库 products 无 deleted_at 时先于 sync 补列，否则建索引会因缺列失败 */
async function ensureSqliteProductDeletedAtColumn () {
  if (sequelize.getDialect() !== 'sqlite') return

  const [tables] = await sequelize.query(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'products' LIMIT 1
  `)
  if (tables.length === 0) return

  const [cols] = await sequelize.query('PRAGMA table_info(products)')
  const hasDeletedAt = cols.some((c) => c.name === 'deleted_at')
  if (hasDeletedAt) return

  console.log('🔧 products 表缺少 deleted_at，正在执行 ALTER ADD COLUMN（软删除列）...')
  await sequelize.query('ALTER TABLE products ADD COLUMN deleted_at DATETIME')
  console.log('✅ 已为 products 表添加 deleted_at 字段')
}

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

// 数据库连接和同步（SQLite 须先补齐 deleted_at 再 sync，否则索引创建失败）
sequelize.authenticate()
  .then(() => ensureSqliteProductDeletedAtColumn())
  .then(() => {
    console.log('✅ 数据库连接成功')
    return sequelize.sync({ alter: false })
  })
  .then(() => ensureUserAvatarUrlColumn())
  .then(() => ensureProductPointsColumn())
  .then(() => ensureOrderBillingColumns())
  .then(() => ensureOrderPointsRedeemedColumn())
  .then(() => ensureOrderItemPointsLineCostColumn())
  .then(() => ensureExchangeRatesConfig())
  .then(() => ensureProductCategoriesMigrate())
  .then(() => {
    console.log('✅ 数据库模型同步成功')
  })
  .catch(err => {
    console.error('❌ 数据库连接或同步失败:', err.message)
    console.error('📋 详细错误信息:', err)
    if (err.sql) {
      console.error('📝 SQL语句:', err.sql)
    }
  })

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

console.log('✅ API路由注册完成')

// 健康检查（必须在API 404处理之前）
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: '服务器运行正常 (HTTP模式)',
    timestamp: new Date().toISOString(),
    port: PORT
  })
})

/** 排查部署：返回 package 版本与 dist/portal/index.html 修改时间（确认是否已同步新前端） */
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
      portalDir,
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

// 根路径重定向
app.get('/', (req, res) => {
  res.redirect('/portal/')
})

// 404处理和统一错误处理
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js'

app.use('*', notFoundHandler)
app.use(errorHandler)

// 启动服务器函数
export function startServer() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('')
    console.log('🎉 Universal Shop 启动成功！')
    console.log('================================================')
    console.log(`🌐 HTTP服务器: http://0.0.0.0:${PORT}`)
    console.log(`📱 用户门户: http://localhost:${PORT}/portal/`)
    console.log(`🔧 管理后台: http://localhost:${PORT}/admin/`)
    console.log(`🩺 健康检查: http://localhost:${PORT}/api/health`)
    if (process.env.NODE_ENV !== 'production') {
      console.log('------------------------------------------------')
      console.log('🔥 开发热更新（改 Vue 源码后此处才即时生效）：')
      console.log('   门户 Dev  http://localhost:3001/        （vite.config.js）')
      console.log('   管理后台  http://localhost:3002/admin/  （vite.admin.config.js）')
      console.log('ℹ️  :3000 上的 /portal、/admin 来自 dist/** 构建文件；')
      console.log('   若在 :3000 打开后台没看到最新界面，请先访问 :3002，或执行 npm run build:admin')
      console.log('------------------------------------------------')
    }
    console.log('================================================')
    console.log('💡 提示: 按 Ctrl+C 停止服务')
    console.log('')
  })
}

export default app
