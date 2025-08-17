<template>
  <div class="min-h-screen bg-gray-50">
    <!-- 导航栏 -->
    <header class="bg-white shadow-sm border-b">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <button 
            @click="goBack"
            class="flex items-center text-gray-600 hover:text-gray-900"
          >
            <ArrowLeftIcon class="h-5 w-5 mr-2" />
            {{ t('product.back') }}
          </button>
          
          <h1 class="text-lg font-semibold">{{ t('product.productDetail') }}</h1>
          
          <!-- 购物车图标 -->
          <router-link 
            to="/cart"
            class="relative p-2 text-gray-400 hover:text-gray-500"
          >
            <ShoppingCartIcon class="h-6 w-6" />
            <span 
              v-if="cartStore.itemCount > 0" 
              class="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center"
            >
              {{ cartStore.itemCount }}
            </span>
          </router-link>
        </div>
      </div>
    </header>

    <!-- 加载状态 -->
    <div v-if="isLoading" class="flex justify-center py-12">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>

    <!-- 产品详情内容 -->
    <div v-else-if="product" class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="lg:grid lg:grid-cols-2 lg:gap-x-8 lg:items-start">
        <!-- 产品图片区域 -->
        <div class="flex flex-col-reverse">
          <!-- 主图片 -->
          <div class="aspect-w-1 aspect-h-1 w-full">
            <img
              :src="product.image_url || defaultImage"
              :alt="getCurrentLanguageValue(product, 'name')"
              class="w-full h-96 object-cover rounded-lg cursor-pointer"
              @click="showImageModal = true"
              @error="handleImageError"
              @load="handleImageLoad"
            >
          </div>
        </div>

        <!-- 产品信息区域 -->
        <div class="mt-10 px-4 sm:px-0 sm:mt-16 lg:mt-0">
          <!-- 产品名称 -->
          <h1 class="text-3xl font-bold tracking-tight text-gray-900">
            {{ getCurrentLanguageValue(product, 'name') }}
          </h1>

          <!-- 价格 -->
          <div class="mt-3">
            <h2 class="sr-only">{{ t('product.productPrice') }}</h2>
            <div class="flex items-center space-x-3">
              <!-- 有折扣时显示折扣价 -->
              <div v-if="product.discount && product.discount > 0" class="flex items-center space-x-3">
                <p class="text-3xl font-bold text-red-600">{{ t('common.currency') }}{{ getDiscountPrice(product) }}</p>
                <p class="text-xl text-gray-400 line-through">{{ t('common.currency') }}{{ product.price }}</p>
                <span class="px-2 py-1 text-sm bg-red-100 text-red-600 rounded-md font-medium">
                  {{ product.discount }}%
                </span>
              </div>
              <!-- 无折扣时显示正常价格 -->
              <div v-else>
                <p class="text-3xl font-bold text-blue-600">{{ t('common.currency') }}{{ product.price }}</p>
              </div>
            </div>
          </div>

          <!-- 库存状态 -->
          <div class="mt-6">
            <div class="flex items-center">
              <span class="text-sm text-gray-600 mr-2">{{ t('product.stockStatus') }}:</span>
              <span 
                :class="getStockStatusClass(product.stock)"
                class="px-2 py-1 text-xs font-medium rounded-full"
              >
                {{ getStockStatusText(product.stock) }}
              </span>
            </div>
            <p v-if="product.stock > 0 && product.stock <= 10" class="text-sm text-orange-600 mt-1">
              {{ t('product.stockRemaining', { stock: product.stock }) }}
            </p>
          </div>

          <!-- 产品描述 -->
          <div class="mt-6">
            <h3 class="text-sm font-medium text-gray-900">{{ t('product.productDescription') }}</h3>
            <div class="mt-4 prose prose-sm text-gray-500">
              <p>{{ getCurrentLanguageValue(product, 'description') }}</p>
            </div>
          </div>

          <!-- 数量选择器和操作按钮 -->
          <div v-if="product.stock > 0" class="mt-10">
            <!-- 数量选择 -->
            <div class="flex items-center mb-6">
              <label class="text-sm font-medium text-gray-900 mr-4">{{ t('product.quantityLabel') }}:</label>
              <div class="flex items-center border border-gray-300 rounded-md">
                <button
                  @click="decreaseQuantity"
                  :disabled="quantity <= 1"
                  class="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <MinusIcon class="h-4 w-4" />
                </button>
                <span class="w-16 text-center border-x border-gray-300 py-2">{{ quantity }}</span>
                <button
                  @click="increaseQuantity"
                  :disabled="quantity >= product.stock"
                  class="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <PlusIcon class="h-4 w-4" />
                </button>
              </div>
              <span class="ml-4 text-sm text-gray-500">
                {{ t('product.stockInfo', { stock: product.stock }) }}
              </span>
            </div>

            <!-- 操作按钮 -->
            <div class="flex space-x-4">
              <button
                @click="handleAddToCart"
                :disabled="addingToCart"
                class="flex-1 bg-blue-600 border border-transparent rounded-md py-3 px-8 flex items-center justify-center text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ShoppingCartIcon v-if="!addingToCart" class="h-5 w-5 mr-2" />
                <div v-else class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                {{ addingToCart ? t('product.addingToCart') : t('product.addToCart') }}
              </button>
              
              <button
                @click="handleBuyNow"
                :disabled="buyingNow"
                class="flex-1 bg-orange-600 border border-transparent rounded-md py-3 px-8 flex items-center justify-center text-base font-medium text-white hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div v-if="buyingNow" class="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                {{ buyingNow ? t('product.processing') : t('product.buyNow') }}
              </button>
            </div>
          </div>

          <!-- 缺货提示 -->
          <div v-else class="mt-10">
            <div class="border border-red-200 rounded-md p-4 bg-red-50">
              <p class="text-red-800 text-center">{{ t('product.outOfStockMessage') }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 产品不存在 -->
    <div v-else-if="!isLoading" class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
      <h2 class="text-2xl font-bold text-gray-900 mb-4">{{ t('product.productNotFound') }}</h2>
      <p class="text-gray-600 mb-6">{{ t('product.productNotFoundDesc') }}</p>
      <router-link 
        to="/" 
        class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
      >
        {{ t('product.backToHome') }}
      </router-link>
    </div>

    <!-- 图片预览模态框 -->
    <div 
      v-if="showImageModal" 
      class="fixed inset-0 z-50 overflow-y-auto"
      @click="showImageModal = false"
    >
      <div class="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div class="fixed inset-0 bg-black bg-opacity-75 transition-opacity"></div>
        
        <div class="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full">
          <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <img
              :src="product.image_url || defaultImage"
              :alt="getCurrentLanguageValue(product, 'name')"
              class="w-full h-auto"
              @error="handleImageError"
            >
          </div>
          <div class="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              @click="showImageModal = false"
              class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-gray-600 text-base font-medium text-white hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 sm:ml-3 sm:w-auto sm:text-sm"
            >
              {{ t('product.close') }}
            </button>
          </div>
        </div>
      </div>
    </div>

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
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useCartStore } from '../../stores/cart.js'
import { useUserStore } from '../../stores/user.js'
import { productAPI } from '../../api/products.js'
import { 
  ArrowLeftIcon, 
  ShoppingCartIcon, 
  MinusIcon, 
  PlusIcon 
} from '@heroicons/vue/24/outline'

// 路由和状态
const route = useRoute()
const router = useRouter()
const { locale, t } = useI18n()
const cartStore = useCartStore()
const userStore = useUserStore()

// 响应式数据
const product = ref(null)
const isLoading = ref(true)
const quantity = ref(1)
const addingToCart = ref(false)
const buyingNow = ref(false)
const showImageModal = ref(false)
const showMessage = ref(false)
const message = ref('')
const messageType = ref('success')

// 默认图片（修复后的SVG格式）
const defaultImage = 'data:image/svg+xml,%3Csvg width="400" height="400" viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg"%3E%3Crect width="400" height="400" fill="%23F3F4F6"/%3E%3Cpath d="M120 140c0-8.284 6.716-15 15-15h130c8.284 0 15 6.716 15 15v120c0 8.284-6.716 15-15 15H135c-8.284 0-15-6.716-15-15V140z" fill="%23D1D5DB"/%3E%3Ccircle cx="160" cy="170" r="15" fill="%23909090"/%3E%3Cpath d="M120 230l40-50 40 25 60-70 80 95V140H120v90z" fill="%23909090"/%3E%3Ctext x="200" y="320" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="%23666"%3E%E6%97%A0%E5%9B%BE%E7%89%87%3C/text%3E%3C/svg%3E'

// 计算属性
const messageClass = computed(() => {
  switch (messageType.value) {
    case 'success':
      return 'bg-green-500 text-white'
    case 'error':
      return 'bg-red-500 text-white'
    case 'info':
      return 'bg-blue-500 text-white'
    default:
      return 'bg-gray-500 text-white'
  }
})

// 加载产品详情
const loadProduct = async () => {
  try {
    isLoading.value = true
    const response = await productAPI.getProduct(route.params.id)
    
    if (response.data.success) {
      product.value = response.data.data
    } else {
      product.value = null
    }
  } catch (error) {
    console.error('Load product error:', error)
    product.value = null
  } finally {
    isLoading.value = false
  }
}

// 获取当前语言的值
const getCurrentLanguageValue = (item, field) => {
  const currentLang = locale.value
  if (currentLang === 'th-TH' && item[`${field}_th`]) {
    return item[`${field}_th`]
  }
  return item[field] || ''
}

// 计算折扣价格
const getDiscountPrice = (product) => {
  if (!product.discount || product.discount <= 0) {
    return product.price
  }
  const discountPrice = product.price * (1 - product.discount / 100)
  return discountPrice.toFixed(2)
}

// 获取库存状态样式
const getStockStatusClass = (stock) => {
  if (stock === 0) return 'bg-red-100 text-red-800'
  if (stock <= 10) return 'bg-orange-100 text-orange-800'
  return 'bg-green-100 text-green-800'
}

// 获取库存状态文本
const getStockStatusText = (stock) => {
  if (stock === 0) return t('product.stockStatuses.outOfStock')
  if (stock <= 10) return t('product.stockStatuses.lowStock')
  return t('product.stockStatuses.inStock')
}

// 数量操作
const increaseQuantity = () => {
  if (quantity.value < product.value.stock) {
    quantity.value++
  }
}

const decreaseQuantity = () => {
  if (quantity.value > 1) {
    quantity.value--
  }
}

// 加入购物车 - 游客可用
const handleAddToCart = async () => {
  if (!product.value || addingToCart.value) return
  
  try {
    addingToCart.value = true
    const result = await cartStore.addToCart(product.value, quantity.value)
    
    if (result.success) {
      showMessageToast(result.message, 'success', result.messageParams || {})
    } else {
      showMessageToast(result.message || 'addFailed', 'error', result.messageParams || {})
    }
  } catch (error) {
    showMessageToast(t('cart.addFailed'), 'error')
  } finally {
    addingToCart.value = false
  }
}

// 立即购买 - 游客可用
const handleBuyNow = async () => {
  if (!product.value || buyingNow.value) return
  
  try {
    buyingNow.value = true
    const result = await cartStore.addToCart(product.value, quantity.value)
    
    if (result.success) {
      // 直接跳转到结算页面
      router.push('/checkout')
    } else {
      showMessageToast(result.message || 'addFailed', 'error', result.messageParams || {})
    }
  } catch (error) {
    showMessageToast(t('cart.addFailed'), 'error')
  } finally {
    buyingNow.value = false
  }
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
    'itemNotFound': () => t('cart.itemNotFound'),
    // 简化库存不足提示
    'stockInsufficientSimple': () => t('cart.stockInsufficientSimple')
  }
  
  if (messageMap[key]) {
    return messageMap[key]()
  }
  
  return key
}

// 显示消息提示
const showMessageToast = (msg, type = 'success', params = {}) => {
  // 如果消息是键名，则进行国际化转换
  const translatedMsg = getTranslatedMessage(msg, params)
  message.value = translatedMsg
  messageType.value = type
  showMessage.value = true
  
  setTimeout(() => {
    showMessage.value = false
  }, 3000)
}

// 返回上一页
const goBack = () => {
  router.go(-1)
}

// 图片处理函数
const handleImageError = (event) => {
  // 避免循环错误，只在不是默认图片时才替换
  if (event.target.src !== defaultImage) {
    event.target.src = defaultImage
  }
}

const handleImageLoad = (event) => {
  // 图片加载成功，静默处理
}

// 组件挂载时加载数据
onMounted(() => {
  loadProduct()
})
</script>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>