import jwt from 'jsonwebtoken'
import Partner from '../models/Partner.js'
import { JWT_SECRET } from '../config/jwtSecret.js'

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
      decoded = jwt.verify(token, JWT_SECRET)
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
    console.error('authenticatePartner:', e)
    return res.status(500).json({ success: false, message: '认证失败' })
  }
}
