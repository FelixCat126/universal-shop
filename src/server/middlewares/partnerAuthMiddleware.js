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

    /**
     * 强制改密拦截。
     *
     * CSV 批量导入的账号拿到的是**系统生成的随机初始密码**（运营线下告知）。
     * 如果不拦，这个临时密码会一直有效 —— 谁拿到都能下单。
     *
     * 只放行两个接口：
     *   PUT /api/partner/me/password —— 改密本身
     *   GET  /api/partner/me         —— 门户要先拿到标记才能显示"请改密"提示
     * 其余一律 403。
     *
     * ⚠️ 用 req.originalUrl 而不是 req.path：
     * 这个中间件挂在 `/api/partner` 上，req.path 在这里是**去掉挂载前缀后的子路径**
     * （"/me/password"），而 req.originalUrl 是完整路径（"/api/partner/me/password"）。
     * 两种都能匹配，但混用最容易出错 —— 统一用 originalUrl。
     */
    if (partner.must_reset_password) {
      const path = String(req.originalUrl || '').split('?')[0]
      const allowed = path === '/api/partner/me' || path === '/api/partner/me/password'
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: '请先修改初始密码',
          code: 'MUST_RESET_PASSWORD'
        })
      }
    }

    req.partner = {
      id: partner.id,
      login: partner.login,
      display_name: partner.display_name,
      discount_percent: parseFloat(partner.discount_percent) || 0,
      account_kind: partner.account_kind || 'dealer',
      must_reset_password: !!partner.must_reset_password
    }

    req.partnerFull = partner
    next()
  } catch (e) {
    logger.error('authenticatePartner', { err: e?.message, stack: e?.stack })
    return res.status(500).json({ success: false, message: '认证失败' })
  }
}
