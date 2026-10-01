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

let cache = null
let cachedAt = 0
let inFlight = null

export async function loadPublicConfig () {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      const response = await fetch(config.buildApiUrl('/api/system-config/public'))
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
