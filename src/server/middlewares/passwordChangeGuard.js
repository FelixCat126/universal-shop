/**
 * 强制改密守卫
 *
 * 背景：账号的初始密码是**系统随机生成**的（游客自动注册、运营批量导入客户）。
 * 用户自己都不知道那个密码 —— 也就是说这个账号实际上没有密码保护：
 * 拿到数据库哈希的人就能登录。
 *
 * 之前的处理只是门户顶部一条**横幅**，用户可以完全无视它继续用随机密码。
 * 要真正生效，得在 **API 层**拦住。
 *
 * ⚠️ **只拦账号级操作，不拦购物流程**。
 *
 * 游客自动注册的账号也会带 must_reset_password=true（密码是系统随机的，
 * 用户自己都不知道）。如果连"加购/下单"都拦，回头客第二次下单会被挡住 ——
 * 那是在赶走顾客，不是保护账号。
 *
 * 真正危险的只有**凭据级**操作：密码未知 = 可能被别人拿到密码后
 * 改掉资料、换掉邮箱、注销账号。所以只拦这两个：
 *   - PUT  /api/users/profile             改资料（含邮箱/昵称）
 *   - POST /api/users/me/delete          注销账号
 *
 * ⚠️ **订单级操作（售后、确认支付）不拦**。
 * 游客自动注册的账号密码也是随机的（用户自己都不知道），
 * 而"下单 → 用 token 确认支付"是**游客在线支付的正常流程** ——
 * 拦了它等于把在线支付这个功能对游客关掉了（实测会挂）。
 * 订单级操作还需要订单 id + 有效会话令牌，风险面小得多。
 *
 * 放行的：加购 / 下单 / 看订单 / 售后 / 确认支付 / 看资料 / 改密 / 登出。
 *
 * 响应用 403 + code=PASSWORD_CHANGE_REQUIRED，前端据此**自动弹出改密框**
 * （而不是让用户自己猜"我该去哪改密码"）。
 */
import User from '../models/User.js'
import { createSharedStore } from '../utils/sharedState.js'

/**
 * 改密标记的短缓存（与 authMiddleware 的用户状态缓存同一套思路）：
 * 每次请求都查一次 users 表太浪费，而这个标记**只有两种值**且只在改密时变。
 * TTL 5s：改密后最多 5s 才生效（改密接口本身会主动清缓存）。
 */
const resetFlagCache = createSharedStore('must-reset-password')

export function _clearResetFlagCacheForTests () {
  return resetFlagCache.clear()
}

/** 改密成功后调用：立刻让标记失效 */
export async function invalidateResetFlagCache (userId) {
  await resetFlagCache.delete(String(userId))
}

/**
 * 需要被拦的路径（账号级操作）。
 *
 * 用"路径匹配"而不是白名单：购物流程要放行，
 * 白名单式会把将来新增的接口默认拦掉（那是更危险的方向 ——
 * 默认拦 = 新功能上线即报错；默认放行 = 新功能默默绕过保护）。
 */
const GUARDED = [
  { method: 'PUT', pattern: /^\/api\/users\/profile$/ },
  { method: 'POST', pattern: /^\/api\/users\/me\/delete$/ }
]

/** 是否命中需要拦的路径 */
function needsGuard (method, path) {
  return GUARDED.some(g => g.method === method && g.pattern.test(path))
}

/**
 * 强制改密中间件。
 * 挂在 authenticateToken 之后（需要 req.user 才知道是谁）。
 */
export async function requirePasswordChange (req, res, next) {
  try {
    const userId = req.user?.userId
    if (!userId) return next()

    /**
     * 用 originalUrl 而不是 req.path：
     * 路由被挂到子路径上后（app.use('/api/users', router)），
     * req.path 是**挂载点之后**的那一段（'/profile'），
     * req.baseUrl 才是挂载点 —— 两者拼起来才是完整路径。
     * originalUrl 最直接（原始请求路径，含查询串，要自己切掉）。
     */
    const path = String(req.originalUrl || '').split('?')[0].replace(/\/+$/, '') || '/'
    if (!needsGuard(req.method, path)) return next()

    // 读缓存
    const key = String(userId)
    let needReset = await resetFlagCache.get(key)
    if (needReset === undefined || needReset === null) {
      const user = await User.findByPk(userId, { attributes: ['must_reset_password'] })
      needReset = user?.must_reset_password === true
      await resetFlagCache.set(key, needReset, 5_000)
    }
    if (!needReset) return next()

    return res.status(403).json({
      success: false,
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: '请先设置一个新密码，再继续使用'
    })
  } catch (e) {
    // 守卫本身出错**不能**把用户挡在门外（宁可放行，也不能因为守卫挂了而全站不可用）
    next()
  }
}
