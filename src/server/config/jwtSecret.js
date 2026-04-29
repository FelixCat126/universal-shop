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

export const JWT_SECRET = resolveJwtSecret()
