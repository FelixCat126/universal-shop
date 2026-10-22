import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { JWT_SECRET } from '../config/jwtSecret.js'
import { createSharedStore } from '../utils/sharedState.js'
import { logger } from '../utils/logger.js'

/**
 * 用户存活/启用状态短缓存：
 *   - key: userId
 *   - value: { exists, isActive, tokenVersion }
 *   - TTL 5s：保护 DB；配置 REDIS_URL 后跨实例共享
 */

const userStatusCache = createSharedStore('user-status')

export function _clearAuthCacheForTests () {
  return userStatusCache.clear()
}

/** 当管理端禁用/启用用户、删用户、改密后调一次，使缓存中的状态立即失效 */
export async function invalidateAuthCache (userId) {
  await userStatusCache.delete(userId)
}

async function loadUserStatus (userId) {
  const cached = await userStatusCache.get(userId)
  if (cached) return cached
  const user = await User.findByPk(userId, { attributes: ['id', 'is_active', 'token_version'] })
  const status = user
    ? { exists: true, isActive: user.is_active !== false, tokenVersion: Number(user.token_version) || 0 }
    : { exists: false, isActive: false, tokenVersion: 0 }
  await userStatusCache.set(userId, status, 5_000)
  return status
}

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
    // 三套身份分桶校验：拒绝 admin/partner token 进入用户接口
    if (decoded.type && decoded.type !== 'user') {
      return res.status(401).json({
        success: false,
        message: '无效的认证令牌'
      })
    }
    const status = await loadUserStatus(decoded.userId)
    if (!status.exists) {
      return res.status(401).json({ success: false, message: '无效的认证令牌' })
    }
    if (!status.isActive) {
      return res.status(403).json({ success: false, message: '账户已被禁用，请联系管理员' })
    }
    if (Number(decoded.tv ?? 0) !== status.tokenVersion) {
      return res.status(401).json({ success: false, message: '登录状态已失效，请重新登录' })
    }

    req.user = decoded
    next()
  } catch (error) {
    logger.error('Token验证失败', { err: error?.message, stack: error?.stack })
    return res.status(401).json({
      success: false,
      message: '无效的认证令牌'
    })
  }
}

/**
 * 可选认证：若头部带 token 但无效/过期/账号停用，应返回 401 而非静默放行。
 */
export const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return next()

  try {
    // 先读未验证 payload 的身份类型：admin/partner 在可选认证中本就按匿名处理，
    // 即使它们使用独立 secret 也不应被误判为用户态 401。
    const typeHint = jwt.decode(token)?.type
    if (typeHint === 'admin' || typeHint === 'partner') return next()

    const decoded = jwt.verify(token, JWT_SECRET)
    if (decoded?.type === 'admin' || decoded?.type === 'partner') {
      // 不是普通用户态：当作未登录处理
      return next()
    }
    const status = await loadUserStatus(decoded.userId)
    if (!status.exists) return res.status(401).json({ success: false, message: '无效的认证令牌' })
    if (!status.isActive) return res.status(403).json({ success: false, message: '账户已被禁用' })
    if (Number(decoded.tv ?? 0) !== status.tokenVersion) {
      return res.status(401).json({ success: false, message: '登录状态已失效，请重新登录' })
    }
    req.user = decoded
    return next()
  } catch (error) {
    return res.status(401).json({ success: false, message: '认证令牌无效或已过期' })
  }
}
