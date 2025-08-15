#!/usr/bin/env node
/**
 * HTTPS生产环境启动脚本 - 自签名证书版本
 * 解决现代浏览器安全头限制问题
 */

import express from 'express'
import cors from 'cors'
import https from 'https'
import http from 'http'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import compression from 'compression'
import sequelize from './src/server/config/database.js'

// 导入后端路由
import productRoutes from './src/server/routes/productRoutes.js'
import uploadRoutes from './src/server/routes/uploadRoutes.js'
import userRoutes from './src/server/routes/userRoutes.js'
import cartRoutes from './src/server/routes/cartRoutes.js'
import orderRoutes from './src/server/routes/orderRoutes.js'
import addressRoutes from './src/server/routes/addressRoutes.js'
import adminRoutes from './src/server/routes/adminRoutes.js'
import exportRoutes from './src/server/routes/exportRoutes.js'
import statisticsRoutes from './src/server/routes/statisticsRoutes.js'
import systemConfigRoutes from './src/server/routes/systemConfigRoutes.js'

// 导入模型
import './src/server/models/User.js'
import './src/server/models/Product.js'
import './src/server/models/Cart.js'
import './src/server/models/Order.js'
import './src/server/models/OrderItem.js'
import './src/server/models/Address.js'
import './src/server/models/Administrator.js'
import './src/server/models/OperationLog.js'
import './src/server/models/SystemConfig.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const HTTP_PORT = process.env.PORT || 3000
const HTTPS_PORT = process.env.HTTPS_PORT || 3443

// 基础中间件
app.use(compression())
app.use(cors({
  origin: true,
  credentials: true
}))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// HTTPS重定向中间件
app.use((req, res, next) => {
  // 如果是HTTP请求，重定向到HTTPS
  if (req.header('x-forwarded-proto') !== 'https' && !req.secure) {
    const httpsUrl = `https://${req.get('host').replace(`:${HTTP_PORT}`, `:${HTTPS_PORT}`)}${req.url}`
    return res.redirect(301, httpsUrl)
  }
  next()
})

// 静态文件服务
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), {
  maxAge: '30d',
  etag: true
}))

// 前端静态文件服务 - 优先处理静态资源
app.use('/portal', express.static(path.join(__dirname, 'dist/portal'), {
  maxAge: '1d',
  etag: true,
  index: false  // 禁用目录索引，让SPA路由处理
}))

app.use('/admin', express.static(path.join(__dirname, 'dist/admin'), {
  maxAge: '1d', 
  etag: true,
  index: false  // 禁用目录索引，让SPA路由处理
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

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: '服务器运行正常 (HTTPS)',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    protocol: req.secure ? 'HTTPS' : 'HTTP'
  })
})

// SPA路由处理 - 排除静态资源
app.get('/portal/*', (req, res, next) => {
  // 如果请求的是静态资源文件，跳过SPA路由处理
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
    return next()
  }
  res.sendFile(path.join(__dirname, 'dist/portal/index.html'))
})

app.get('/admin/*', (req, res, next) => {
  // 如果请求的是静态资源文件，跳过SPA路由处理
  if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
    return next()
  }
  res.sendFile(path.join(__dirname, 'dist/admin/index.html'))
})

// 根路径重定向到门户
app.get('/', (req, res) => {
  res.redirect('/portal')
})

// 404处理
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: '页面未找到',
    path: req.originalUrl
  })
})

// 错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err)
  res.status(500).json({
    success: false,
    message: '服务器内部错误'
  })
})

// 读取SSL证书
function loadSSLCertificates() {
  const certDir = path.join(__dirname, 'ssl')
  const keyPath = path.join(certDir, 'server.key')
  const certPath = path.join(certDir, 'server.crt')
  
  try {
    const key = fs.readFileSync(keyPath, 'utf8')
    const cert = fs.readFileSync(certPath, 'utf8')
    
    return { key, cert }
  } catch (error) {
    console.error('❌ SSL证书加载失败:', error.message)
    console.error('请确保SSL证书文件存在：')
    console.error(`- ${keyPath}`)
    console.error(`- ${certPath}`)
    process.exit(1)
  }
}

// 启动服务器
async function startServer() {
  try {
    // 数据库连接测试
    await sequelize.authenticate()
    console.log('✅ 数据库连接成功')

    // 同步数据库表
    await sequelize.sync({ force: false })
    console.log('✅ 数据库表同步成功')

    // 加载SSL证书
    const sslOptions = loadSSLCertificates()
    
    // 启动HTTP服务器（用于重定向）
    const httpServer = http.createServer(app)
    httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
      console.log(`🔓 HTTP服务器启动: http://0.0.0.0:${HTTP_PORT} (重定向到HTTPS)`)
    })

    // 启动HTTPS服务器（主服务）
    const httpsServer = https.createServer(sslOptions, app)
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log('')
      console.log('🎉 轻量化商城系统启动成功！(HTTPS)')
      console.log('================================================')
      console.log(`🔐 HTTPS服务器: https://0.0.0.0:${HTTPS_PORT}`)
      console.log(`📱 用户门户: https://localhost:${HTTPS_PORT}/portal`)
      console.log(`🔧 管理后台: https://localhost:${HTTPS_PORT}/admin`)
      console.log(`📡 API接口: https://localhost:${HTTPS_PORT}/api`)
      console.log('================================================')
      console.log('⚠️  证书警告说明:')
      console.log('├── 首次访问会显示"不安全"警告')
      console.log('├── 这是正常的，因为使用了自签名证书')
      console.log('├── 点击"高级" → "继续访问" 即可')
      console.log('└── 功能完全正常，数据传输加密')
      console.log('================================================')
      console.log('🔐 默认账户:')
      console.log('├── 管理员: admin / 123456')
      console.log('└── 测试用户: 13800138001 / 123456')
      console.log('================================================')
      console.log('💡 提示: 按 Ctrl+C 停止服务')
      console.log('')
    })

    // 优雅关闭
    const gracefulShutdown = (signal) => {
      console.log(`\n收到${signal}信号，正在关闭服务器...`)
      
      httpsServer.close(() => {
        console.log('✅ HTTPS服务器已关闭')
        httpServer.close(() => {
          console.log('✅ HTTP服务器已关闭')
          process.exit(0)
        })
      })
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
    process.on('SIGINT', () => gracefulShutdown('SIGINT'))

  } catch (error) {
    console.error('❌ 服务器启动失败:', error)
    process.exit(1)
  }
}

startServer()
