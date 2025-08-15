import jwt from 'jsonwebtoken'
import User from '../models/User.js'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-here'

// 验证JWT token
export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: '访问被拒绝，缺少认证令牌'
      })
    }

    const decoded = jwt.verify(token, JWT_SECRET)
    
    // 验证用户是否存在
    const user = await User.findByPk(decoded.userId)
    if (!user) {
      return res.status(401).json({
        success: false,
        message: '无效的认证令牌'
      })
    }

    // 检查用户是否被禁用
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: '账户已被禁用，请联系管理员'
      })
    }

    req.user = decoded
    next()
  } catch (error) {
    console.error('Token验证失败:', error)
    return res.status(403).json({
      success: false,
      message: '无效的认证令牌'
    })
  }
}

// 可选的身份验证（不强制要求token）
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET)
      const user = await User.findByPk(decoded.userId)
      if (user && user.is_active) {
        req.user = decoded
      }
    }
    
    next()
  } catch (error) {
    // 忽略token验证错误，继续处理请求
    next()
  }
}