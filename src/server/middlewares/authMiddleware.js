import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { JWT_SECRET } from '../config/jwtSecret.js'

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

/**
 * 可选认证：若头部带 token 但无效/过期/账号停用，应返回 401 而非静默放行；
 * 这样下游若误用 req.user 不会触发 NPE，也避免"似登未登"的状态歧义。
 */
export const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return next()

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    if (decoded?.type === 'admin' || decoded?.type === 'partner') {
      // 不是普通用户态：当作未登录处理
      return next()
    }
    const user = await User.findByPk(decoded.userId)
    if (!user) return res.status(401).json({ success: false, message: '无效的认证令牌' })
    if (!user.is_active) return res.status(403).json({ success: false, message: '账户已被禁用' })
    req.user = decoded
    return next()
  } catch (error) {
    return res.status(401).json({ success: false, message: '认证令牌无效或已过期' })
  }
}