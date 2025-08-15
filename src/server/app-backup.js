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

// 静态文件服务
// 1) 上传目录（保持不变）
app.use('/uploads', express.static(path.join(__dirname, '../../public/uploads')));

// 2) Admin 静态资源：vite.admin.config.js 的 outDir = ../../public/admin
const adminDir = path.join(__dirname, '../../public/admin');
// 先挂 assets，确保返回正确 MIME（application/javascript / text/css）
app.use('/admin/assets', express.static(path.join(adminDir, 'assets'), {
  immutable: true,
  maxAge: '7d'
}));
// 再挂其余静态
app.use('/admin', express.static(adminDir));
// 单页应用回退：/admin 下的任意前端路由都回 index.html
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(adminDir, 'index.html'));
});

// 3) Portal 静态资源：vite.portal.config.js 的 outDir = ../../dist/portal
const portalDir = path.join(__dirname, '../../dist/portal');
// 同样先 assets → 再静态 → 再回退
app.use('/portal/assets', express.static(path.join(portalDir, 'assets'), {
  immutable: true,
  maxAge: '7d'
}));
app.use('/portal', express.static(portalDir));
app.get('/portal/*', (req, res) => {
  res.sendFile(path.join(portalDir, 'index.html'));
});

// API路由
app.use('/api/products', productRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/users', userRoutes)
app.use('/api/cart', cartRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/addresses', addressRoutes)
// 管理员路由
app.use('/api/admin', adminRoutes)
// 导出路由
app.use('/api/admin/export', exportRoutes)
// 统计路由
app.use('/api/admin/statistics', statisticsRoutes)
// 系统配置路由
app.use('/api/system-config', systemConfigRoutes)
// 认证路由（兼容前端调用）
app.use('/api/auth', userRoutes)

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ 
    success: true, 
    message: '服务器运行正常',
    timestamp: new Date().toISOString()
  })
})

// 404处理
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API接口不存在'
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
async function startServer() {
  try {
    // 测试数据库连接
    await sequelize.authenticate()
    console.log('✅ 数据库连接成功')

    // 同步数据库表
    await sequelize.sync({ force: false })
    console.log('✅ 数据库表同步成功')

    // 启动服务器
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 服务器启动成功，端口: ${PORT}`)
      console.log(`📍 API地址: http://localhost:${PORT}/api`)
      console.log(`💾 数据库: SQLite`)
    })
  } catch (error) {
    console.error('❌ 服务器启动失败:', error)
    process.exit(1)
  }
}

export default app
export { startServer }