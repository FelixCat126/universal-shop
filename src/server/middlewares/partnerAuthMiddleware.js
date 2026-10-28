import jwt from 'jsonwebtoken'
import Partner from '../models/Partner.js'
import { JWT_PARTNER_SECRET } from '../config/jwtSecret.js'
import { logger } from '../utils/logger.js'

/**
 * 校验合作方 Bearer；payload 须含 type===partner、partnerId
 */
export async function authenticatePartner (req, res, next) {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader && authHeader.split(' ')[1]
    if (!token) {
      return res.status(401).json({ success: false, message: '缺少认证令牌' })
    }

    let decoded
    try {
      decoded = jwt.verify(token, JWT_PARTNER_SECRET, { algorithms: ['HS256'] })
    } catch {
      return res.status(403).json({ success: false, message: '无效的认证令牌' })
    }

    if (decoded.type !== 'partner' || decoded.partnerId == null) {
      return res.status(403).json({ success: false, message: '非合作方令牌' })
    }

    const partner = await Partner.findByPk(decoded.partnerId)
    if (!partner?.is_active) {
      return res.status(403).json({ success: false, message: '合作方账号不可用' })
    }
    if (Number(decoded.tv ?? 0) !== (Number(partner.token_version) || 0)) {
      return res.status(401).json({ success: false, message: '登录状态已失效，请重新登录' })
    }

    req.partner = {
      id: partner.id,
      login: partner.login,
      display_name: partner.display_name,
      discount_percent: parseFloat(partner.discount_percent) || 0,
      account_kind: partner.account_kind || 'dealer'
    }

    req.partnerFull = partner
    next()
  } catch (e) {
    logger.error('authenticatePartner', { err: e?.message, stack: e?.stack })
    return res.status(500).json({ success: false, message: '认证失败' })
  }
}
