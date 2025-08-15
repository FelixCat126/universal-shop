import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import sequelize from './config/database.js'
import productRoutes from './routes/productRoutes.js'
import uploadRoutes from './routes/uploadRoutes.js'
import userRoutes from './routes/userRoutes.js'
import cartRoutes from './routes/cartRoutes.js'
import orderRoutes from './routes/orderRoutes.js'
import addressRoutes from './routes/addressRoutes.js'
import adminRoutes from './routes/adminRoutes.js'
import exportRoutes from './routes/exportRoutes.js'
import statisticsRoutes from './routes/statisticsRoutes.js'
import systemConfigRoutes from './routes/systemConfigRoutes.js'

// 导入模型以确保数据库同步
import './models/User.js'
import './models/Product.js'
import './models/Cart.js'
import './models/Order.js'
import './models/OrderItem.js'
import './models/Address.js'
import './models/Administrator.js'
import './models/OperationLog.js'
import './models/SystemConfig.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

// 中间件
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// 设置正确的Content-Type
app.use((req, res, next) => {
  // 为静态资源设置正确的Content-Type
  if (req.path.endsWith('.js')) {
    res.setHeader('Content-Type', 'application/javascript; charset=UTF-8')
  } else if (req.path.endsWith('.css')) {
    res.setHeader('Content-Type', 'text/css; charset=UTF-8')
  } else if (req.path.endsWith('.json')) {
    res.setHeader('Content-Type', 'application/json; charset=UTF-8')
  }
  next()
})

// 静态文件服务 - 上传文件
app.use('/uploads', express.static(path.join(__dirname, '../../public/uploads'), {
  maxAge: '30d',
  etag: true
}))

// 前端静态文件服务
const portalDir = path.join(__dirname, '../../dist/portal')
const adminDir = path.join(__dirname, '../../dist/admin')

// Portal静态资源
app.use('/portal/assets', express.static(path.join(portalDir, 'assets'), {
  immutable: true,
  maxAge: '7d',
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8')
    } else if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=UTF-8')
    }
  }
}))

app.use('/portal', express.static(portalDir, {
  maxAge: '1d',
  etag: true,
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8')
    } else if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=UTF-8')
    }
  }
}))

// Admin静态资源
app.use('/admin/assets', express.static(path.join(adminDir, 'assets'), {
  immutable: true,
  maxAge: '7d',
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8')
    } else if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=UTF-8')
    }
  }
}))

app.use('/admin', express.static(adminDir, {
  maxAge: '1d',
  etag: true,
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8')
    } else if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=UTF-8')
    }
  }
}))

// API路由
app.use('/api/products', productRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/users', userRoutes)
app.use('/api/cart', cartRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/addresses', addressRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/export', exportRoutes)
app.use('/api/statistics', statisticsRoutes)
app.use('/api/system-config', systemConfigRoutes)
// 认证路由（兼容前端调用）
app.use('/api/auth', userRoutes)

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: '服务器运行正常 (HTTP)',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    protocol: 'HTTP'
  })
})

// SPA路由处理 - 只对HTML请求生效，不影响静态资源
app.get('/portal/*', (req, res, next) => {
  // 如果是静态资源请求，跳过SPA路由处理
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)$/)) {
    return next()
  }
  // 对于HTML请求，返回index.html
  res.sendFile(path.join(portalDir, 'index.html'))
})

app.get('/admin/*', (req, res, next) => {
  // 如果是静态资源请求，跳过SPA路由处理
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)$/)) {
    return next()
  }
  // 对于HTML请求，返回index.html
  res.sendFile(path.join(adminDir, 'index.html'))
})

// 根路径重定向到门户
app.get('/', (req, res) => {
  res.redirect('/portal')
})

// 404处理 - API
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API接口不存在'
  })
})

// 404处理 - 其他
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: '页面未找到',
    path: req.originalUrl
  })
})

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err)
  res.status(500).json({
    success: false,
    message: '服务器内部错误',
    error: process.env.NODE_ENV === 'development' ? err.message : '服务器错误'
  })
})

// 数据库连接和启动服务器
export async function startServer() {
  try {
    // 测试数据库连接
    await sequelize.authenticate()
    console.log('✅ 数据库连接成功')

    // 同步数据库表
    await sequelize.sync({ force: false })
    console.log('✅ 数据库表同步成功')

    // 启动服务器
    app.listen(PORT, '0.0.0.0', () => {
      console.log('')
      console.log('🎉 Universal Shop 启动成功！(HTTP模式)')
      console.log('================================================')
      console.log(`🌐 HTTP服务器: http://0.0.0.0:${PORT}`)
      console.log(`📱 用户门户: http://localhost:${PORT}/portal`)
      console.log(`🔧 管理后台: http://localhost:${PORT}/admin`)
      console.log(`📡 API接口: http://localhost:${PORT}/api`)
      console.log('================================================')
      console.log('🔐 默认账户:')
      console.log('├── 管理员: admin / 123456')
      console.log('└── 测试用户: 13800138001 / 123456')
      console.log('================================================')
      console.log('💡 提示: 按 Ctrl+C 停止服务')
      console.log('')
    })

  } catch (error) {
    console.error('❌ 服务器启动失败:', error)
    process.exit(1)
  }
}

export default app
