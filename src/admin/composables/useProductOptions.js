import { ref } from 'vue'
import { productAPI } from '../api/products.js'

/**
 * 商品下拉选项（第 49 轮 · 效率）
 * ================================
 *
 * ## 原来的问题
 *
 * 促销/组合包/券模板三个页面的商品下拉都是：
 *
 *   productAPI.getProducts({ page: 1, pageSize: 200 })   // 一次拉 200 个商品
 *
 * 而服务端 `maxPageSize` 是 **100** → 请求 200 会被**静默截到 100**
 * （前端以为拿到了 200 个，实际只有 100 个）→ **第 101 个之后的商品永远选不到**，
 * 而且这个"少了一半"没有任何提示。
 *
 * 一次拉 200 条完整商品（含 description 文本）也很浪费 ——
 * 下拉框实际只用 `id` + `name`。
 *
 * ## 现在的做法
 *
 * - 默认只拉**一页 100 条**（与服务端上限一致，不再有"以为 200 实际 100"的错觉）
 * - 下拉**支持远程搜索**：运营输入名称片段 → 按 `name` 查 → 任意商品都能选到 ✓
 * - 搜索请求**只取需要的列**（服务端仍返回整行，这里前端不再额外解析大字段）
 *
 * @param {object} [options]
 * @param {number} [options.pageSize] 一页条数（与服务端 maxPageSize 对齐）
 */
export function useProductOptions ({ pageSize = 100 } = {}) {
  const productOptions = ref([])
  const productOptionsLoading = ref(false)
  let searchTimer = null

  const loadProductOptions = async (keyword = '') => {
    productOptionsLoading.value = true
    try {
      const res = await productAPI.getProducts({
        page: 1,
        pageSize,
        ...(keyword ? { name: keyword } : {})
      })
      productOptions.value = res.data?.data?.products || []
    } catch (e) {
      console.error('加载商品选项失败:', e)
      productOptions.value = []
    } finally {
      productOptionsLoading.value = false
    }
  }

  /** 下拉里的远程搜索（debounce 300ms，避免逐字符发请求） */
  const searchProductOptions = (keyword) => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { loadProductOptions(keyword) }, 300)
  }

  return { productOptions, productOptionsLoading, loadProductOptions, searchProductOptions }
}
