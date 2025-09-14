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
import administrativeRegionsRoutes from './routes/administrativeRegions.js'

// 导入模型以确保数据库同步
import './models/User.js'
import './models/Product.js'
import './models/Cart.js'
import './models/Order.js'
import './models/OrderItem.js'
import './models/Address.js'
import './models/Administrator.js'
import './models/AdministrativeRegion.js'
import './models/OperationLog.js'
import './models/SystemConfig.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

// 数据库连接和同步
sequelize.authenticate()
  .then(() => {
    console.log('✅ 数据库连接成功')
    // 使用 alter: true 确保表结构能够自动更新
    return sequelize.sync({ alter: true })
  })
  .then(() => {
    console.log('✅ 数据库模型同步成功')
  })
  .catch(err => {
    console.error('❌ 数据库连接或同步失败:', err.message)
  })

// API路由
console.log('🔧 注册API路由...')
app.use('/api/products', productRoutes)
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
const portalDir = path.join(__dirname, '../../dist/portal')
const adminDir = path.join(__dirname, '../../dist/admin')

console.log('📁 Portal目录:', portalDir)
console.log('📁 Admin目录:', adminDir)

// 上传文件
app.use('/uploads', express.static(path.join(__dirname, '../../public/uploads'), {
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
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=UTF-8')
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=UTF-8')
    }
  }
}))

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: '服务器运行正常 (HTTP模式)',
    timestamp: new Date().toISOString(),
    port: PORT
  })
})

// SPA路由处理
app.get('/portal/*', (req, res, next) => {
  console.log('🔍 Portal路由检查:', req.path)
  
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)$/)) {
    console.log('📄 静态资源，跳过SPA处理')
    return next()
  }
  
  console.log('📱 返回Portal index.html')
  res.sendFile(path.join(portalDir, 'index.html'))
})

app.get('/admin/*', (req, res, next) => {
  console.log('🔍 Admin路由检查:', req.path)
  
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)$/)) {
    console.log('📄 静态资源，跳过SPA处理')
    return next()
  }
  
  console.log('🔧 返回Admin index.html')
  res.sendFile(path.join(adminDir, 'index.html'))
})

// 根路径重定向
app.get('/', (req, res) => {
  res.redirect('/portal/')
})

// 404处理
app.use('*', (req, res) => {
  console.log('❌ 404:', req.originalUrl)
  res.status(404).json({
    success: false,
    message: '页面未找到',
    path: req.originalUrl
  })
})

// 错误处理
app.use((err, req, res, next) => {
  console.error('💥 服务器错误:', err.stack || err.message)
  res.status(500).json({
    success: false,
    message: '服务器内部错误: ' + err.message
  })
})

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
    console.log('================================================')
    console.log('💡 提示: 按 Ctrl+C 停止服务')
    console.log('')
  })
}

export default app
