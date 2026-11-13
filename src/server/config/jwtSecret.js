import crypto from 'node:crypto'

/** 与测试环境一致的占位长度；仅开发环境在未配置时使用 */
const DEV_FALLBACK =
  'test-jwt-secret-key-for-testing-only-32-chars-long'

function resolveJwtSecret () {
  const raw = process.env.JWT_SECRET
  const s = raw == null ? '' : String(raw).trim()

  if (s && s !== 'your-secret-key-here' && s.length >= 32) {
    return s
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET 环境变量未设置或长度不足 32 字符（且不能为占位值），生产环境无法启动'
    )
  }

  console.warn(
    '⚠️ JWT_SECRET 未设置或未达标（≥32 字符），已使用本地开发占位密钥；正式部署请在 .env 中配置'
  )
  return DEV_FALLBACK
}

/**
 * 从主密钥派生一把**独立**的子密钥（HMAC-SHA256）。
 *
 * 为什么不能直接复用 JWT_SECRET：
 * 三把密钥相同时，"用户 / 管理端 / 合作方"这层隔离就只剩载荷里的 type 字段。
 * 一旦**某一域的密钥单独泄露**（.env 备份、日志、运维截图…），
 * 攻击者就能拿它签出**任意域**的令牌 —— 泄露合作方密钥即可伪造管理员令牌。
 * 派生出独立密钥后，某一域泄露只影响该域。
 *
 * 派生而不是随机：随机值需要持久化（多实例不一致 / 重启后全部令牌失效），
 * 派生是确定性的 —— 同一把主密钥永远派生出同一把子密钥，重启/扩容都不影响。
 */
function deriveScopedSecret (base, envName) {
  return crypto
    .createHmac('sha256', base)
    .update('universal-shop:' + envName)
    .digest('hex')
}

function resolveScopedSecret (rawValue, fallback, envName) {
  const raw = rawValue == null ? '' : String(rawValue).trim()
  if (raw && raw !== 'your-secret-key-here' && raw.length >= 32) return raw
  if (process.env.NODE_ENV !== 'production') {
    return `${fallback}-${envName.toLowerCase().replace(/_/g, '-')}`
  }
  /**
   * 生产回退：**派生出独立子密钥**，不再直接复用 JWT_SECRET。
   *
   * 旧实现直接返回 JWT_SECRET —— 那意味着"漏配一个环境变量"就悄悄把
   * 管理端/合作方的密钥边界抹平了，而日志只有一行 warn。
   * 派生之后边界依然存在，同时保留告警提醒运维去显式配置。
   */
  const derived = deriveScopedSecret(fallback, envName)
  console.warn(
    `⚠️ ${envName} 未配置，已从 JWT_SECRET 派生独立子密钥（密钥边界仍有效）；` +
    '公测/生产建议显式配置以支持单域轮换'
  )
  return derived
}

export const JWT_SECRET = resolveJwtSecret()
export const JWT_ADMIN_SECRET = resolveScopedSecret(process.env.JWT_ADMIN_SECRET, JWT_SECRET, 'JWT_ADMIN_SECRET')
export const JWT_PARTNER_SECRET = resolveScopedSecret(process.env.JWT_PARTNER_SECRET, JWT_SECRET, 'JWT_PARTNER_SECRET')

/**
 * 密钥域隔离状态（**不含任何密钥内容**，只有布尔结论）。
 *
 * 用途：让运维在管理端运行时指标里看到"三把密钥是否真的互不相同"，
 * 而不是只能靠翻日志。显式把 JWT_ADMIN_SECRET 配成 JWT_SECRET 的复制粘贴
 * 失误，也只有这样才看得见。
 */
export const JWT_SECRET_ISOLATION = {
  adminDistinctFromUser: JWT_ADMIN_SECRET !== JWT_SECRET,
  partnerDistinctFromUser: JWT_PARTNER_SECRET !== JWT_SECRET,
  adminDistinctFromPartner: JWT_ADMIN_SECRET !== JWT_PARTNER_SECRET
}
