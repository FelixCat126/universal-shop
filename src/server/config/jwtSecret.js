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

function resolveScopedSecret (rawValue, fallback, envName) {
  const raw = rawValue == null ? '' : String(rawValue).trim()
  if (raw && raw !== 'your-secret-key-here' && raw.length >= 32) return raw
  if (process.env.NODE_ENV !== 'production') {
    return `${fallback}-${envName.toLowerCase().replace(/_/g, '-')}`
  }
  console.warn(`⚠️ ${envName} 未配置，暂时回退到 JWT_SECRET；公测/生产建议独立配置以隔离密钥用途`)
  return fallback
}

export const JWT_SECRET = resolveJwtSecret()
export const JWT_ADMIN_SECRET = resolveScopedSecret(process.env.JWT_ADMIN_SECRET, JWT_SECRET, 'JWT_ADMIN_SECRET')
export const JWT_PARTNER_SECRET = resolveScopedSecret(process.env.JWT_PARTNER_SECRET, JWT_SECRET, 'JWT_PARTNER_SECRET')
