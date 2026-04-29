<template>
  <div class="min-h-screen bg-gray-50">
    <!-- 主内容区域 -->
    <main
      class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
    >
      <!-- 页面标题 -->
      <div v-if="!homeBanner" class="mb-8">
        <h2 class="text-2xl font-bold text-gray-900 mb-2">
          {{ t('product.productList') }}
        </h2>
        <p class="text-gray-600">
          {{ t('product.searchPlaceholder') }}
        </p>
      </div>

      <!-- 首页长图 -->
      <div v-if="homeBanner" class="mb-6">
        <div class="w-full max-w-4xl mx-auto">
          <img
            :src="getImageUrl(homeBanner)"
            alt="首页横幅"
            class="w-full h-auto rounded-lg shadow-sm object-cover"
            style="max-height: 300px;"
            @error="handleBannerError"
          >
        </div>
      </div>
      
      <!-- 搜索栏 -->
      <div class="mb-6">
        <div class="relative max-w-md">
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="t('product.searchPlaceholder')"
            class="w-full min-w-0 pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
          >
          <svg class="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 shrink-0 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      <!-- 分类 Tab：横向滑动仅滚动本区域；下移出视口时粘在视窗顶部 -->
      <div
        v-if="categories.length"
        class="sticky top-0 z-30 -mx-4 mb-5 px-4 py-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 bg-gray-50/95 backdrop-blur-md border-b border-gray-200/90 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
      >
        <div
          class="flex gap-2 overflow-x-auto overflow-y-hidden pb-1 -mx-1 px-1 touch-pan-x [scrollbar-width:thin]"
        >
          <button
            v-for="c in categories"
            :key="c.id"
            type="button"
            class="shrink-0 px-4 py-2 rounded-full text-sm font-medium border transition-colors whitespace-nowrap"
            :class="selectedCategoryId === c.id
              ? 'bg-blue-600 text-white border-blue-600 shadow'
              : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'"
            @click="selectCategory(c.id)"
          >
            {{ c.name }}
          </button>
        </div>
      </div>

      <!-- 商品列表区：左右滑动切换分类（Tab 条自身仅横向滚动，不绑此手势） -->
      <section
        class="product-swipe-zone min-h-[8rem]"
        @touchstart.passive="onProductAreaTouchStart"
        @touchend.passive="onProductAreaTouchEnd"
      >
      <!-- 首次加载 -->
      <div v-if="isLoading && !products.length" class="flex justify-center py-12">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
      
      <!-- 产品网格（卡片等高，按钮贴底） -->
      <div
        v-else-if="products.length > 0"
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-stretch"
      >
        <div
          v-for="product in products"
          :key="product.id"
          class="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200 cursor-pointer transform hover:scale-[1.02] flex flex-col h-full min-h-0"
          @click="goToProductDetail(product.id)"
        >
          <div class="aspect-w-1 aspect-h-1 w-full bg-gray-200 rounded-t-xl overflow-hidden relative shrink-0">
            <div
              v-if="product.points > 0"
              class="pointer-events-none absolute right-0 top-0 z-10 h-16 w-16 select-none overflow-visible"
              role="presentation"
            >
              <!-- 直角在图片右上角、沿右下与左上的斜边为斜边的三角区 -->
              <div
                aria-hidden="true"
                class="absolute inset-0 shadow-[2px_3px_10px_rgba(0,0,0,0.28)] [clip-path:polygon(100%_0,100%_100%,0_0)]"
              >
                <div class="absolute inset-0 bg-gradient-to-br from-amber-500 via-amber-600 to-amber-950" />
                <div class="absolute inset-0 bg-gradient-to-tl from-white/10 to-transparent" />
                <div class="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/25" />
              </div>
              <span
                class="absolute left-[67%] top-[31%] z-[1] inline-block min-w-max -translate-x-1/2 -translate-y-1/2 rotate-45 origin-center text-[11px] font-extrabold uppercase leading-none tracking-normal text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.7)] whitespace-nowrap [word-break:keep-all] antialiased xs:text-[12px]"
              >
                {{ t('product.pointsExchangeBadge') }}
              </span>
            </div>
            <img
              :src="product.image_url || defaultImage"
              :alt="getCurrentLanguageValue(product, 'name')"
              class="w-full h-48 object-cover"
              loading="lazy"
              @error="handleImageError"
              @load="handleImageLoad"
            >
          </div>
          
          <div class="p-4 flex flex-col flex-1 min-h-0">
            <h3 class="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">
              {{ getCurrentLanguageValue(product, 'name') }}
            </h3>
            
            <p class="text-gray-600 text-sm mb-3 line-clamp-2 shrink-0">
              {{ getCurrentLanguageValue(product, 'description') }}
            </p>
            
            <div class="mt-auto pt-2 border-t border-gray-100">
              <div class="mb-4 space-y-2">
                <!-- 主价居左；有积分则所需积分居右（同一行） -->
                <div class="flex justify-between items-baseline gap-x-3 gap-y-1">
                  <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
                    <template v-if="product.discount && product.discount > 0">
                      <span class="text-xl font-bold text-red-600">
                        {{ portalCurrency.formatThb(getDiscountPrice(product)) }}
                      </span>
                      <span class="text-sm text-gray-400 line-through">
                        {{ portalCurrency.formatThb(product.price) }}
                      </span>
                    </template>
                    <template v-else>
                      <span class="text-xl font-bold text-blue-600">
                        {{ portalCurrency.formatThb(product.price) }}
                      </span>
                    </template>
                  </div>
                  <span
                    v-if="product.points > 0"
                    class="shrink-0 text-right text-xs leading-tight font-medium text-amber-900 tabular-nums sm:text-sm sm:leading-normal"
                  >
                    {{ t('product.pointsValue', { points: product.points }) }}
                  </span>
                </div>

                <!-- 库存数量（原绿/黄/红档位不变） -->
                <div class="flex justify-between items-start gap-3 text-xs">
                  <div class="min-w-0 shrink text-left">
                    <span
                      class="tabular-nums"
                      :class="product.stock > 10
                        ? 'text-green-600'
                        : product.stock > 0
                          ? 'text-yellow-600'
                          : 'text-red-600'"
                    >
                      {{ t('product.stockCount', { count: product.stock }) }}
                    </span>
                  </div>
                </div>
              </div>
              
              <div class="flex space-x-2">
                <button
                  @click.stop="addToCart(product)"
                  :disabled="product.stock === 0"
                  class="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {{ t('product.addToCart') }}
                </button>
                <button
                  @click.stop="buyNow(product)"
                  :disabled="product.stock === 0"
                  class="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {{ t('product.buyNow') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 空状态 -->
      <div v-else class="text-center py-12">
        <svg class="mx-auto h-24 w-24 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
        <h3 class="text-lg font-medium text-gray-900 mb-2">
          {{ t('product.noProducts') }}
        </h3>
        <p class="text-gray-500">
          {{ t('cart.emptyDesc') }}
        </p>
      </div>

      <!-- 触底加载：延后触发便于在列表底部看到加载态 -->
      <div
        v-show="products.length > 0 && hasMore"
        ref="loadMoreSentinel"
        class="flex min-h-[5rem] w-full shrink-0 flex-col items-center justify-center gap-2 py-4 touch-manipulation"
        role="status"
        :aria-busy="loadingMore"
      >
        <template v-if="loadingMore">
          <div class="flex items-center gap-3 text-gray-600">
            <div
              class="h-8 w-8 shrink-0 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
              aria-hidden="true"
            />
            <span class="text-sm font-medium">{{ t('product.loadMore') }}</span>
          </div>
        </template>
      </div>
      <p
        v-if="products.length > 0 && !hasMore && !loadingMore && !isLoading"
        class="text-center text-sm text-gray-500 py-6"
      >
        {{ t('product.noMoreProducts') }}
      </p>
      </section>
    </main>

    <!-- 消息提示 -->
    <Transition name="fade">
      <div 
        v-if="showMessage" 
        :class="messageClass"
        class="fixed top-20 left-1/2 transform -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg z-40"
      >
        {{ message }}
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useCartStore } from '../stores/cart.js'
import { useUserStore } from '../stores/user.js'
import { productAPI } from '../api/products.js'
import config from '../../config/index.js'
import { useToast } from '../composables/useToast.js'
import { usePortalCurrencyStore } from '../stores/portalCurrency.js'

const portalCurrency = usePortalCurrencyStore()

// Home.vue组件已加载

// 国际化
const { t, locale } = useI18n()

// 路由和状态管理
const router = useRouter()
const cartStore = useCartStore()
const userStore = useUserStore()
const { showError } = useToast()

// 响应式数据
const isLoading = ref(false)
const loadingMore = ref(false)
const products = ref([])
const searchQuery = ref('')
const currentPage = ref(1)
const totalPages = ref(1)
const pageSize = 8
const homeBanner = ref(null)
const loadMoreSentinel = ref(null)
const loadMoreBusy = ref(false)
let loadMoreObserver = null
let searchDebounceTimer = null
/** 移动端等环境下 IO 不可靠时：用 passive 滚动检测距文档底部距离 */
let scrollProximityRaf = null

const categories = ref([])
const selectedCategoryId = ref(null)

const hasMore = computed(() => currentPage.value < totalPages.value)

// 消息提示
const showMessage = ref(false)
const message = ref('')
const messageType = ref('success')

// 当前语言（从全局状态获取，暂时硬编码）
const currentLanguage = ref('zh-CN')

// 获取当前语言的值
const getCurrentLanguageValue = (item, field) => {
  const currentLang = currentLanguage.value
  if (currentLang === 'th-TH' && item[`${field}_th`]) {
    return item[`${field}_th`]
  }
  return item[field] || ''
}

// 获取完整的图片URL - 使用配置管理器
const getImageUrl = (imagePath) => {
  return config.buildStaticUrl(imagePath)
}

// 显示消息提示
const showMessageToast = (msg, type = 'success', params = {}) => {
  const translatedMsg = getTranslatedMessage(msg, params)
  message.value = translatedMsg
  messageType.value = type
  showMessage.value = true
  
  setTimeout(() => {
    showMessage.value = false
  }, 3000)
}

// 获取国际化消息
const getTranslatedMessage = (key, params = {}) => {
  const messageMap = {
    'addSuccess': () => t('cart.addSuccess'),
    'addFailed': () => t('cart.addFailed'),
    'updateSuccess': () => t('cart.updateSuccess'),
    'updateFailed': () => t('cart.updateFailed'),
    'removeSuccess': () => t('cart.removeSuccess'),
    'removeFailed': () => t('cart.removeFailed'),
    'clearSuccess': () => t('cart.clearSuccess'),
    'clearFailed': () => t('cart.clearFailed'),
    'outOfStock': () => t('product.outOfStock'),
    // 简化库存不足提示
    'stockInsufficientSimple': () => t('cart.stockInsufficientSimple')
  }
  
  if (messageMap[key]) {
    return messageMap[key]()
  }
  
  return key
}

// 计算消息样式
const messageClass = computed(() => {
  return messageType.value === 'success' 
    ? 'bg-green-500 text-white' 
    : 'bg-red-500 text-white'
})

// 加载系统配置
const loadSystemConfig = async () => {
  try {
    const response = await fetch(config.buildApiUrl('/api/system-config/public'))
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        homeBanner.value = data.data.home_banner
      }
    }
  } catch (error) {
    console.warn('加载系统配置失败:', error)
    // 静默失败，不影响主要功能
  }
}

const mapProductRow = (product) => ({
  id: product.id,
  name: product.name,
  name_th: product.name_th,
  description: product.description,
  description_th: product.description_th,
  price: parseFloat(product.price),
  discount: product.discount,
  stock: product.stock,
  image_url: product.image || defaultImage,
  category_id: product.category_id,
  category: product.category,
  points: product.points != null ? Number(product.points) : 0,
})

const loadCategories = async () => {
  try {
    const res = await productAPI.getProductCategories()
    if (!res.data.success || !Array.isArray(res.data.data)) return
    categories.value = res.data.data
    if (categories.value.length) {
      const first = categories.value[0].id
      if (selectedCategoryId.value == null || !categories.value.some((c) => c.id === selectedCategoryId.value)) {
        selectedCategoryId.value = first
      }
    }
  } catch (e) {
    console.warn('加载分类失败', e)
  }
}

const selectCategory = async (id) => {
  const n = Number(id)
  if (Number.isNaN(n) || selectedCategoryId.value === n) return
  selectedCategoryId.value = n
  currentPage.value = 1
  loadMoreObserver?.disconnect()
  products.value = []
  await loadProducts({ append: false })
  await nextTick()
  attachInfiniteScroll()
}

/** 仅商品列表区域：左右滑切换分类（Tab 条仅横向滚动，事件不在此区域内） */
const productSwipeStart = ref({ x: 0, y: 0 })

const onProductAreaTouchStart = (e) => {
  const t = e.touches?.[0] ?? e.changedTouches?.[0]
  if (!t) return
  productSwipeStart.value = { x: t.clientX, y: t.clientY }
}

const onProductAreaTouchEnd = (e) => {
  if (categories.value.length < 2 || selectedCategoryId.value == null) return
  const t = e.changedTouches?.[0]
  if (!t) return
  const dx = t.clientX - productSwipeStart.value.x
  const dyAbs = Math.abs(t.clientY - productSwipeStart.value.y)
  if (Math.abs(dx) < 52 || dyAbs > 90) return
  const idx = categories.value.findIndex((c) => c.id === selectedCategoryId.value)
  if (idx < 0) return
  if (dx < 0 && idx < categories.value.length - 1) {
    selectCategory(categories.value[idx + 1].id)
  } else if (dx > 0 && idx > 0) {
    selectCategory(categories.value[idx - 1].id)
  }
}

const loadProducts = async ({ append = false } = {}) => {
  if (append) {
    loadingMore.value = true
  } else {
    isLoading.value = true
  }

  try {
    const params = {
      page: currentPage.value,
      pageSize,
      name: searchQuery.value?.trim() || undefined,
      ...(selectedCategoryId.value != null
        ? { category_id: selectedCategoryId.value }
        : {})
    }

    const response = await productAPI.getProducts(params)

    if (response.data.success) {
      const list = (response.data.data.products || []).map(mapProductRow)
      totalPages.value = response.data.data.totalPages || 1

      if (append) {
        const seen = new Set(products.value.map((p) => p.id))
        for (const p of list) {
          if (!seen.has(p.id)) {
            seen.add(p.id)
            products.value.push(p)
          }
        }
      } else {
        products.value = list
      }
    } else {
      console.error('加载产品失败:', response.data.message)
      showError('加载产品失败: ' + response.data.message)
    }
  } catch (error) {
    console.error('加载产品失败:', error)
    if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
      showError('无法连接到服务器，请确保后端服务已启动 (npm run dev:server)')
    } else {
      showError('加载产品失败: ' + (error.response?.data?.message || error.message))
    }
  } finally {
    isLoading.value = false
    loadingMore.value = false
  }
}

const loadNextPage = async () => {
  if (loadMoreBusy.value || loadingMore.value || isLoading.value || !hasMore.value) return
  loadMoreBusy.value = true
  try {
    currentPage.value += 1
    await loadProducts({ append: true })
  } finally {
    loadMoreBusy.value = false
  }
}

const checkScrollNearBottom = () => {
  if (!hasMore.value || loadingMore.value || isLoading.value || loadMoreBusy.value) return false
  if (typeof window === 'undefined' || typeof document === 'undefined') return false

  const docEl = document.documentElement
  const bodyEl = document.body
  const scrollTop = window.scrollY ?? docEl.scrollTop ?? bodyEl.scrollTop ?? 0
  const scrollHeight = Math.max(
    docEl.scrollHeight ?? 0,
    bodyEl.scrollHeight ?? 0,
    docEl.offsetHeight ?? 0
  )
  // 使用 innerHeight + scrollY 与 scrollHeight 对齐（与多数移动端浏览器行为一致）
  const innerH = window.innerHeight || docEl.clientHeight || 0
  const distanceToBottom = scrollHeight - (scrollTop + innerH)
  // 接近窗口底部时再加载（与 IO 延后策略一致）
  return distanceToBottom <= 72
}

const onWindowScrollProximity = () => {
  if (!hasMore.value) return
  if (scrollProximityRaf != null) return
  scrollProximityRaf = requestAnimationFrame(() => {
    scrollProximityRaf = null
    if (checkScrollNearBottom()) loadNextPage()
  })
}

const attachInfiniteScroll = () => {
  loadMoreObserver?.disconnect()
  const el = loadMoreSentinel.value
  if (!el || !products.value.length || !hasMore.value) return

  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      const hit = entries.some((e) => e.isIntersecting)
      if (hit) loadNextPage()
    },
    // 负值 bottom 缩小根矩形底部，需多滚一截才让哨兵算「进入视区」，避免过早加载
    { root: null, rootMargin: '0px 0px -72px 0px', threshold: 0 }
  )
  loadMoreObserver.observe(el)
}

// 计算折扣价格
const getDiscountPrice = (product) => {
  if (!product.discount || product.discount <= 0) {
    return product.price
  }
  const discountPrice = product.price * (1 - product.discount / 100)
  return discountPrice.toFixed(2)
}

// 跳转到产品详情
const goToProductDetail = (productId) => {
  router.push(`/products/${productId}`)
}

// 添加到购物车 - 游客可用
const addToCart = async (product) => {
  if (product.stock === 0) {
    showMessageToast('outOfStock', 'error')
    return
  }
  
  try {
    const result = await cartStore.addToCart(product, 1)
    
    if (result.success) {
      showMessageToast(result.message, 'success', result.messageParams || {})
    } else {
      showMessageToast(result.message || 'addFailed', 'error', result.messageParams || {})
    }
  } catch (error) {
    showMessageToast('addFailed', 'error')
  }
}

// 立即购买 - 游客可用
const buyNow = async (product) => {
  if (product.stock === 0) {
    showMessageToast('outOfStock', 'error')
    return
  }
  
  try {
    const result = await cartStore.addToCart(product, 1)
    
    if (result.success) {
      // 直接跳转到结算页面
      router.push('/checkout')
    } else {
      showMessageToast(result.message || 'addFailed', 'error', result.messageParams || {})
    }
  } catch (error) {
    showMessageToast('addFailed', 'error')
  }
}

// 默认图片（使用data URI避免网络请求和console错误）
const defaultImage = 'data:image/svg+xml,%3Csvg width="400" height="400" viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg"%3E%3Crect width="400" height="400" fill="%23F3F4F6"/%3E%3Cpath d="M120 140c0-8.284 6.716-15 15-15h130c8.284 0 15 6.716 15 15v120c0 8.284-6.716 15-15 15H135c-8.284 0-15-6.716-15-15V140z" fill="%23D1D5DB"/%3E%3Ccircle cx="160" cy="170" r="15" fill="%23909090"/%3E%3Cpath d="M120 230l40-50 40 25 60-70 80 95V140H120v90z" fill="%23909090"/%3E%3Ctext x="200" y="320" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="%23666"%E6%97%A0%E5%9B%BE%E7%89%87%3C/text%3E%3C/svg%3E'

// 图片处理 - 静默处理错误，避免console报错
const handleImageError = (event) => {
  // 避免循环错误，只在不是默认图片时才替换
  if (event.target.src !== defaultImage) {
    event.target.src = defaultImage
  }
}

const handleImageLoad = (event) => {
  // 静默处理，不输出日志
}

// 处理长图加载错误
const handleBannerError = (event) => {
  console.warn('首页长图加载失败，隐藏长图显示')
  homeBanner.value = null
}

watch(
  () => searchQuery.value,
  () => {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = setTimeout(async () => {
      currentPage.value = 1
      await loadProducts({ append: false })
      await nextTick()
      attachInfiniteScroll()
    }, 400)
  }
)

watch(
  () => locale.value,
  (v) => {
    if (v) currentLanguage.value = v
  },
  { immediate: true }
)

watch(
  () => [products.value.length, hasMore.value],
  () => {
    nextTick(() => attachInfiniteScroll())
  }
)

// 组件挂载时加载数据
onMounted(async () => {
  loadSystemConfig()
  await loadCategories()
  await loadProducts({ append: false })
  await nextTick()
  attachInfiniteScroll()
  window.addEventListener('scroll', onWindowScrollProximity, { passive: true })
  window.visualViewport?.addEventListener?.('resize', onWindowScrollProximity)
})

onUnmounted(() => {
  loadMoreObserver?.disconnect()
  loadMoreObserver = null
  window.removeEventListener('scroll', onWindowScrollProximity, { passive: true })
  window.visualViewport?.removeEventListener?.('resize', onWindowScrollProximity)
  if (scrollProximityRaf != null) {
    cancelAnimationFrame(scrollProximityRaf)
    scrollProximityRaf = null
  }
  clearTimeout(searchDebounceTimer)
})
</script>

<style scoped>
/* 消息提示动画 */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>