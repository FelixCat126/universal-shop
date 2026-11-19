import { watch, onBeforeUnmount } from 'vue'

/**
 * 列表页「输入即搜」。
 *
 * ## 为什么后台也要改成输入即搜
 *
 * 运营一天要在几个列表页之间来回筛（"在售 + 缺货" → "已售罄" → "某客户近 30 天"），
 * 每个筛选条件都要"打字 → 再点一次搜索"，
 * 一天下来是几十次**纯多余**的点击，而且很容易漏点（以为已经搜过了）。
 *
 * 客户端与合作方端已经是输入即搜（第 31 / 39 轮），
 * 这里把后台统一到同一套行为 —— **同一个动作，在三个端应该一样顺手**。
 *
 * ## 用法
 *
 *   const searchForm = usePersistentFilters('admin-users', { email: '', phone: '' })
 *   const handleSearch = () => { currentPage.value = 1; loadUsers() }
 *   useAutoSearch(searchForm, handleSearch)
 *
 * ## 注意
 *
 * - debounce 300ms：避免逐字符发请求（后端还有分页 COUNT，代价不小）
 * - 「搜索」按钮**保留**：习惯用回车 / 点按钮的人不受影响
 * - 触发时会把页码重置为 1（否则在第 3 页搜会得到空列表）——
 *   所以回调里请自己重置页码，或直接调用已有的 handleSearch（它已经重置了）
 */
export function useAutoSearch (form, onSearch, { delay = 300 } = {}) {
  let timer = null

  watch(form, () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      try {
        onSearch()
      } catch (e) {
        // 搜索失败不应让整个页面崩掉（列表页通常已有 try/catch，这里再兜一层）
        console.error('自动搜索失败', e)
      }
    }, delay)
  }, { deep: true })

  onBeforeUnmount(() => clearTimeout(timer))

  return {
    /** 立即触发一次（供"重置"按钮用：清空后立即搜，而不是等 debounce） */
    triggerNow () {
      clearTimeout(timer)
      onSearch()
    }
  }
}
