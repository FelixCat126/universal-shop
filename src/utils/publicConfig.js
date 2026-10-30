/**
 * /api/system-config/public 共享拉取（模块级单例，按应用生效）
 *
 * 全站多处需要同一份公开配置（home_banner / payment_qrcode / exchange_rate / exchange_rates /
 * currency_code），历史上各自 fetch 造成重复请求。这里统一收口：
 * - 成功后缓存 30s，期内直接返回缓存不再请求
 * - 并发调用共享同一个 in-flight Promise
 * - 失败不缓存（下次调用自然重试），返回最近一次成功的缓存或 null，由调用方兜底
 */
import config from '../config/index.js'

const CACHE_TTL_MS = 30 * 1000
/** 公开配置请求超时（ms）：超时后按"无配置"降级，不阻塞首屏渲染 */
const PUBLIC_CONFIG_TIMEOUT_MS = 5000

let cache = null
let cachedAt = 0
let inFlight = null

export async function loadPublicConfig () {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      /**
       * 带超时：admin 端首屏 mount 依赖这个请求的 finally，
       * 后端「连接通但不响应」时会永远挂住 → 整页白屏（连登录页都出不来）。
       */
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), PUBLIC_CONFIG_TIMEOUT_MS)
      let response
      try {
        response = await fetch(config.buildApiUrl('/api/system-config/public'), { signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
      const json = await response.json()
      if (json?.success && json.data) {
        cache = json.data
        cachedAt = Date.now()
      }
    } catch (e) {
      console.warn('加载系统公开配置失败:', e)
    } finally {
      inFlight = null
    }
    return cache
  })()
  return inFlight
}

/** 清空缓存（测试与强制刷新场景使用） */
export function resetPublicConfigCache () {
  cache = null
  cachedAt = 0
}
