import { reactive, watch } from 'vue'

/**
 * 列表页筛选条件**持久化**。
 *
 * 运营的实际工作流：筛出一批（比如"上架中 + 缺货"）→ 导出/核对 → 刷新页面
 * 或切到别的页面再回来 → 筛选条件全没了 → 又要重新点一遍。
 * 这是每天重复好几次的摩擦，而且很容易点错（忘了哪个筛选没勾上，导出的数据就不对）。
 *
 * 现在：筛选条件存到 localStorage，刷新/切页回来都还在；
 * 点"重置"会同时清掉存储 ✓（用 clearPersistentFilters）。
 *
 * @param {string} key 存储键（页面唯一，如 'admin-products'）
 * @param {object} initial 初始值（同时作为字段白名单）
 * @returns {object} reactive 的筛选对象
 */
export function usePersistentFilters (key, initial) {
  const STORAGE_KEY = `admin_filters_${key}`

  let saved = {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) saved = JSON.parse(raw) || {}
  } catch (_) { /* 存储坏了就当没有 */ }

  // 只接受 initial 里声明过的字段（避免旧版本残留的字段混进来）
  const form = reactive({ ...initial })
  for (const field of Object.keys(initial)) {
    if (saved[field] !== undefined && saved[field] !== null) {
      form[field] = saved[field]
    }
  }

  // 变更即存（防抖一下，连续输入时别疯狂写 localStorage）
  let timer = null
  watch(form, () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(form))
      } catch (_) { /* 存不下就算了，不影响功能 */ }
    }, 300)
  }, { deep: true })

  return form
}

/**
 * 清掉某个页面的筛选条件（配合页面上的"重置"按钮用）。
 * @param {string} key
 */
export function clearPersistentFilters (key) {
  try {
    localStorage.removeItem(`admin_filters_${key}`)
  } catch (_) { /* ignore */ }
}
