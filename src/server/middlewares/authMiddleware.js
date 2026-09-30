import jwt from 'jsonwebtoken'
import { LRUCache } from 'lru-cache'
import User from '../models/User.js'
import { JWT_SECRET } from '../config/jwtSecret.js'
import { logger } from '../utils/logger.js'

/**
 * 用户存活/启用状态短缓存：
 *   - key: userId
 *   - value: { exists, isActive }
 *   - TTL 5s：保护 DB（高频 cart/orders/profile 不必每次 findByPk）
 *     同时管理员禁用动作最多 5s 后生效，业务可接受
 *
 * 测试或外部需要"立即生效"时调 `_clearAuthCacheForTests()`。
 */
const userStatusCache = new LRUCache({ max: 5000, ttl: 5_000 })

export function _clearAuthCacheForTests () {
  userStatusCache.clear()
}

/** 当管理端禁用/启用用户、删用户后调一次，使缓存中的状态立即失效 */
export function invalidateAuthCache (userId) {
  userStatusCache.delete(userId)
}

async function loadUserStatus (userId) {
  const cached = userStatusCache.get(userId)
  if (cached) return cached
  const user = await User.findByPk(userId, { attributes: ['id', 'is_active'] })
  const status = user
    ? { exists: true, isActive: user.is_active !== false }
    : { exists: false, isActive: false }
  userStatusCache.set(userId, status)
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
    // 三套身份（user/admin/partner）共用 JWT_SECRET：拒绝 admin/partner token 进入用户接口；
    // type 为 undefined 的存量旧 token 放行，兼容已签发 token。
    // 返回 401 而非 403：与"用户不存在"分支及既有 API 契约（跨端 token 一律 401）保持一致
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

    req.user = decoded
    next()
  } catch (error) {
    logger.error('Token验证失败', { err: error?.message, stack: error?.stack })
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
    const status = await loadUserStatus(decoded.userId)
    if (!status.exists) return res.status(401).json({ success: false, message: '无效的认证令牌' })
    if (!status.isActive) return res.status(403).json({ success: false, message: '账户已被禁用' })
    req.user = decoded
    return next()
  } catch (error) {
    return res.status(401).json({ success: false, message: '认证令牌无效或已过期' })
  }
}