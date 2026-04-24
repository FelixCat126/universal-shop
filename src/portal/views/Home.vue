<template>
  <div class="min-h-screen bg-gray-50">
    <!-- 主内容区域 -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
            class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
          <svg class="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>
      
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
              <div class="flex items-center justify-between mb-4">
                <div class="flex items-center space-x-2 flex-wrap gap-y-1">
                  <span v-if="product.discount && product.discount > 0" class="text-xl font-bold text-red-600">
                    {{ t('common.currency') }}{{ getDiscountPrice(product) }}
                  </span>
                  <span v-else class="text-xl font-bold text-blue-600">
                    {{ t('common.currency') }}{{ product.price }}
                  </span>
                  <span
                    v-if="product.discount && product.discount > 0"
                    class="text-sm text-gray-400 line-through"
                  >
                    {{ t('common.currency') }}{{ product.price }}
                  </span>
                  <span
                    v-if="product.discount && product.discount > 0"
                    class="px-2 py-1 text-xs bg-red-100 text-red-600 rounded"
                  >
                    {{ product.discount }}%
                  </span>
                </div>
                
                <div class="text-xs shrink-0 ml-2">
                  <span v-if="product.stock > 10" class="text-green-600">
                    {{ t('product.inStock') }}
                  </span>
                  <span v-else-if="product.stock > 0" class="text-yellow-600">
                    {{ t('product.lowStock') }}
                  </span>
                  <span v-else class="text-red-600">
                    {{ t('product.soldOut') }}
                  </span>
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

      <!-- 滚动加载：触底追加下一页 -->
      <div
        v-show="products.length > 0 && hasMore"
        ref="loadMoreSentinel"
        class="h-8 w-full shrink-0"
        aria-hidden="true"
      />
      <div v-if="loadingMore" class="flex justify-center py-6">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
      <p
        v-if="products.length > 0 && !hasMore && !loadingMore && !isLoading"
        class="text-center text-sm text-gray-500 py-6"
      >
        {{ t('product.noMoreProducts') }}
      </p>
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
const pageSize = 12
const homeBanner = ref(null)
const loadMoreSentinel = ref(null)
const loadMoreBusy = ref(false)
let loadMoreObserver = null
let searchDebounceTimer = null

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
  category: product.category,
  created_at: product.created_at
})

// 加载产品：append 为 true 时追加一页（无限滚动）
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
      name: searchQuery.value?.trim() || undefined
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

const attachInfiniteScroll = () => {
  loadMoreObserver?.disconnect()
  const el = loadMoreSentinel.value
  if (!el || !products.value.length || !hasMore.value) return

  loadMoreObserver = new IntersectionObserver(
    (entries) => {
      const hit = entries.some((e) => e.isIntersecting)
      if (hit) loadNextPage()
    },
    { root: null, rootMargin: '120px', threshold: 0 }
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
  await loadProducts({ append: false })
  await nextTick()
  attachInfiniteScroll()
})

onUnmounted(() => {
  loadMoreObserver?.disconnect()
  loadMoreObserver = null
  clearTimeout(searchDebounceTimer)
})
</script>

<style scoped>
/* 基础样式 */

/* 消息提示动画 */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>