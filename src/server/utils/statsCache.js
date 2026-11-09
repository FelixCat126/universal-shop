/**
 * 统计类聚合的短缓存（订单/用户维度的全表聚合）
 *
 * 背景：dashboard 与订单列表的统计卡片（总营收 / 今日营收 / 已完成数 / 总用户数）
 * 都是**全表聚合** —— SUM + FILTER 要扫全部命中行。
 * 实测 5 万订单约 5ms、10 万级约 10ms：扫描本身暂时不是瓶颈，
 * 但**每次刷新都重扫一遍**是浪费（运营反复刷新同一筛选条件、
 * 几个运营同时开着后台，都会重复扫同一批数据）。
 *
 * 所以做 15s 短缓存。关键在**失效**：
 *
 * 之前只有 TTL（写完最长 15s 读到旧值）。对"刚下单就刷新列表"的运营来说，
 * 那 15s 里看到的是**旧营收** —— 数字对不上会让人以为系统出问题。
 * 所以除了 TTL，还加了**写时失效**：任何订单/用户的写入立刻清缓存。
 *
 * 写时失效挂在**模型层**（Sequelize hook），而不是散在各个控制器里：
 *   - 控制器里手写清缓存 = 一定会漏某条写路径
 *     （之前就发生过：批量取消订单那条路没回补库存、也是靠漏改才出事）
 *   - 模型 hook 覆盖 create / update / destroy / bulkUpdate / bulkDestroy
 *     五种写法，**没有漏网的写路径**
 *
 * 测试环境默认旁路读取（测试库每个用例前清库，缓存会跨用例泄漏旧计数）；
 * 设 STATS_CACHE_ENABLED=1 可强制打开，好让缓存行为本身能被测。
 */
import { LRUCache } from 'lru-cache'

/** 总览统计（总订单数/总营收/总用户数/活跃用户数） */
const overviewCache = new LRUCache({ max: 20, ttl: 15_000 })

/** 订单列表的统计卡片，键 = 筛选条件（不含分页） */
const orderStatsCache = new LRUCache({ max: 100, ttl: 15_000 })

/**
 * 缓存是否启用。
 *
 * **运行时**读环境变量（不是模块加载时读一次）：
 *   - 测试可以在运行中打开缓存，专门测缓存行为本身
 *   - 线上出问题时可以用环境变量临时关掉，不用改代码重新构建
 */
export function statsCacheEnabled () {
  if (process.env.STATS_CACHE_ENABLED === '1') return true
  if (process.env.STATS_CACHE_ENABLED === '0') return false
  return process.env.NODE_ENV !== 'test'
}

/** 读：总览统计 */
export function getCachedOverview (key = 'overview') {
  if (!statsCacheEnabled()) return undefined
  return overviewCache.get(key)
}

/** 写：总览统计 */
export function setCachedOverview (value, key = 'overview') {
  if (!statsCacheEnabled()) return
  overviewCache.set(key, value)
}

/** 读：订单列表统计 */
export function getCachedOrderStats (key) {
  if (!statsCacheEnabled()) return undefined
  return orderStatsCache.get(key)
}

/** 写：订单列表统计 */
export function setCachedOrderStats (key, value) {
  if (!statsCacheEnabled()) return
  orderStatsCache.set(key, value)
}

/**
 * 清空统计缓存 —— 订单/用户发生任何写入时调用。
 *
 * 直接清空（而不是逐键删）：订单筛选组合很多，逐键删要维护键的集合，
 * 漏一个键就会读到旧统计；全清的成本只是"下一次读重新算一次"，可接受。
 */
export function invalidateStatsCaches () {
  overviewCache.clear()
  orderStatsCache.clear()
}

/**
 * 把统计缓存的失效挂到**单个模型**上。
 *
 * 在模型文件自己里调用（Order.js / User.js），而不是集中在 models/index.js ——
 * 因为**应用和控制器是直接 import 单个模型的**（`import Order from '../models/Order.js'`），
 * 只有 seeds 脚本才会 import models/index.js。
 * 集中注册的话，生产环境根本不会加载那个文件 → hook 从没注册过 →
 * 缓存永远不会被清 → "写时失效"变成一句空话（而且不报错，很难发现）。
 *
 * 覆盖五种写入方式（Sequelize v6 实测都会触发）：
 *   create          → afterCreate
 *   instance.update → afterUpdate
 *   Model.update    → afterBulkUpdate
 *   instance.destroy→ afterDestroy
 *   Model.destroy   → afterBulkDestroy
 */
export function registerModelStatsInvalidation (model) {
  if (!model) return
  const invalidate = () => invalidateStatsCaches()
  for (const hook of [
    'afterCreate',
    'afterUpdate',
    'afterDestroy',
    'afterBulkUpdate',
    'afterBulkDestroy'
  ]) {
    model.addHook(hook, invalidate)
  }
}
