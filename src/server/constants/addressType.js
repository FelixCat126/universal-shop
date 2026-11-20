/**
 * 地址类型（address_type）的唯一口径（第 45 轮）
 * ==============================================
 *
 * ## 为什么要收口
 *
 * 模型注释写的是 `office-公司`，管理端展示映射也是 `office`，
 * 但**客户端表单提交的是 `company`** → 后端白名单 `['home','office','other']` 判它非法 →
 * **「编辑地址」每次都 400**（而"新建地址"没校验，所以能建出来，
 * 建出来之后就再也编辑不了 —— 用户会遇到"刚填好的地址保存不了第二次"）。
 *
 * 取值不统一还有一个更隐蔽的后果：**同一个含义在库里会有两种写法**，
 * 任何按 `address_type` 过滤/统计的地方都要写两遍条件，漏一处就是数据对不上。
 *
 * ## 口径
 *
 * - **规范值**：`home` / `office` / `other`（与模型注释、管理端展示一致）
 * - **兼容别名**：`company` → `office`（历史前端提交过的一批数据）
 *
 * 服务端一律**归一化后落库**，所以库里只会出现规范值。
 */

/** 规范取值（与模型注释、管理端展示映射一致） */
export const ADDRESS_TYPES = ['home', 'office', 'other']

/** 历史别名 → 规范值 */
const ADDRESS_TYPE_ALIASES = {
  company: 'office',
  office: 'office',
  home: 'home',
  other: 'other'
}

/**
 * 归一化地址类型。
 * @param {*} value 传入值（可能是规范值、别名、空）
 * @param {string} [fallback] 无法识别时的兜底（默认 'home'）
 * @returns {string} 规范值
 */
export function normalizeAddressType (value, fallback = 'home') {
  if (value == null || value === '') return fallback
  const key = String(value).trim().toLowerCase()
  return ADDRESS_TYPE_ALIASES[key] || fallback
}

/**
 * 是否是合法的地址类型（归一化之后）。
 * @param {*} value
 * @returns {boolean}
 */
export function isValidAddressType (value) {
  if (value == null || value === '') return true // 未传 → 用默认值
  const key = String(value).trim().toLowerCase()
  return Object.prototype.hasOwnProperty.call(ADDRESS_TYPE_ALIASES, key)
}
