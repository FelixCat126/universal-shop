<template>
  <div class="page-container">
    <!-- 顶部导航栏 -->
    <header class="bg-white shadow-soft safe-area-top">
      <div class="content-container">
        <div class="flex items-center justify-between h-16">
          <!-- 网站标题 -->
          <div class="flex items-center">
            <h1 class="text-xl font-bold text-gray-900">
              商城首页
            </h1>
          </div>
          
          <!-- 右侧操作 -->
          <div class="flex items-center space-x-4">
            <!-- 语言切换 -->
            <select 
              v-model="currentLanguage"
              @change="changeLanguage"
              class="text-sm border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="zh-CN">中文</option>
              <option value="th-TH">ไทย</option>
            </select>
            
            <!-- 用户菜单 -->
            <div class="flex items-center space-x-2">
              <!-- 购物车 -->
              <router-link
                to="/cart"
                class="relative p-2 text-gray-400 hover:text-gray-500"
              >
                <ShoppingCartIcon class="h-6 w-6" />
                <span 
                  class="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center"
                >
                  0
                </span>
              </router-link>
              
              <!-- 用户操作 -->
              <router-link
                to="/profile"
                class="btn btn-outline text-sm"
              >
                个人中心
              </router-link>
              
              <router-link
                to="/login"
                class="btn btn-outline text-sm"
              >
                登录
              </router-link>
              <router-link
                to="/register"
                class="btn btn-primary text-sm"
              >
                注册
              </router-link>
            </div>
          </div>
        </div>
      </div>
    </header>
    
    <!-- 主内容区域 -->
    <main class="content-container py-8">
      <!-- 页面标题 -->
      <div class="mb-8">
        <h2 class="text-2xl font-bold text-gray-900 mb-2">
          商品列表
        </h2>
        <p class="text-gray-600">
          发现优质商品，享受便捷购物体验
        </p>
      </div>
      
      <!-- 搜索栏 -->
      <div class="mb-6">
        <div class="relative max-w-md">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索商品..."
            class="input pl-10 pr-4"
          >
          <MagnifyingGlassIcon class="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
        </div>
      </div>
      
      <!-- 加载状态 -->
      <div v-if="isLoading" class="flex justify-center py-12">
        <div class="loading-spinner"></div>
      </div>
      
      <!-- 产品网格 -->
      <div v-else-if="products.length > 0" class="product-grid">
        <div
          v-for="product in filteredProducts"
          :key="product.id"
          class="product-card"
          @click="goToProductDetail(product.id)"
        >
          <!-- 产品图片 -->
          <div class="aspect-w-1 aspect-h-1 w-full bg-gray-200 rounded-t-xl overflow-hidden">
            <img
              :src="product.image_url || '/placeholder-product.jpg'"
              :alt="product.name"
              class="w-full h-48 object-cover"
              loading="lazy"
            >
          </div>
          
          <!-- 产品信息 -->
          <div class="p-4">
            <h3 class="text-lg font-semibold text-gray-900 mb-2 text-ellipsis-2">
              {{ getCurrentLanguageValue(product, 'name') }}
            </h3>
            
            <p class="text-gray-600 text-sm mb-3 text-ellipsis-2">
              {{ getCurrentLanguageValue(product, 'description') }}
            </p>
            
            <!-- 价格和库存 -->
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-2">
                <span class="text-xl font-bold text-primary-600">
                  ¥{{ product.price }}
                </span>
                <span v-if="product.original_price && product.original_price > product.price" 
                      class="text-sm text-gray-400 line-through">
                  ¥{{ product.original_price }}
                </span>
              </div>
              
              <div class="text-xs">
                <span 
                  v-if="product.stock > 10"
                  class="text-green-600"
                >
                  有库存
                </span>
                <span 
                  v-else-if="product.stock > 0"
                  class="text-yellow-600"
                >
                  库存紧张
                </span>
                <span 
                  v-else
                  class="text-red-600"
                >
                  已售完
                </span>
              </div>
            </div>
            
            <!-- 操作按钮 -->
            <div class="mt-4 flex space-x-2">
              <button
                @click.stop="addToCart(product)"
                :disabled="product.stock === 0"
                class="flex-1 btn btn-outline text-sm"
                :class="{ 'opacity-50 cursor-not-allowed': product.stock === 0 }"
              >
                加入购物车
              </button>
              <button
                @click.stop="buyNow(product)"
                :disabled="product.stock === 0"
                class="flex-1 btn btn-primary text-sm"
                :class="{ 'opacity-50 cursor-not-allowed': product.stock === 0 }"
              >
                立即购买
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 空状态 -->
      <div v-else class="text-center py-12">
        <div class="mx-auto h-24 w-24 text-gray-400 mb-4">
          <ShoppingBagIcon class="h-full w-full" />
        </div>
        <h3 class="text-lg font-medium text-gray-900 mb-2">
          暂无商品
        </h3>
        <p class="text-gray-500">
          暂时没有商品，请稍后再来看看
        </p>
      </div>
      
      <!-- 分页 -->
      <div v-if="totalPages > 1" class="mt-8 flex justify-center">
        <nav class="flex items-center space-x-2">
          <button
            @click="goToPage(currentPage - 1)"
            :disabled="currentPage === 1"
            class="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            上一页
          </button>
          
          <span class="px-3 py-2 text-sm text-gray-700">
            {{ currentPage }} / {{ totalPages }}
          </span>
          
          <button
            @click="goToPage(currentPage + 1)"
            :disabled="currentPage === totalPages"
            class="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            下一页
          </button>
        </nav>
      </div>
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
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '../../stores/user.js'
import { useCartStore } from '../../stores/cart.js'
import {
  ShoppingCartIcon,
  ShoppingBagIcon,
  MagnifyingGlassIcon
} from '@heroicons/vue/24/outline'
import { useToast } from '../../composables/useToast.js'

const router = useRouter()
const userStore = useUserStore()
const cartStore = useCartStore()
const { t } = useI18n()
const { showError } = useToast()

// 简化版本 - 用于调试
// ProductList组件已加载

// 响应式数据
const isLoading = ref(false)
const products = ref([])
const searchQuery = ref('')
const currentPage = ref(1)
const totalPages = ref(1)
const pageSize = 12

// 消息提示
const showMessage = ref(false)
const message = ref('')
const messageType = ref('success')

// 当前语言 - 简化版本
const currentLanguage = ref('zh-CN')

// 计算属性
const filteredProducts = computed(() => {
  if (!searchQuery.value) return products.value
  
  return products.value.filter(product => {
    const name = getCurrentLanguageValue(product, 'name')
    const description = getCurrentLanguageValue(product, 'description')
    const query = searchQuery.value.toLowerCase()
    
    return name.toLowerCase().includes(query) || 
           description.toLowerCase().includes(query)
  })
})

// 获取当前语言的值 - 简化版本
const getCurrentLanguageValue = (item, field) => {
  const currentLang = currentLanguage.value
  if (currentLang === 'th-TH' && item[`${field}_th`]) {
    return item[`${field}_th`]
  }
  return item[field] || ''
}

// 切换语言 - 简化版本
const changeLanguage = () => {
  localStorage.setItem('language', currentLanguage.value)
}

// 显示消息提示
const showMessageToast = (msg, type = 'success') => {
  const translatedMsg = getTranslatedMessage(msg)
  message.value = translatedMsg
  messageType.value = type
  showMessage.value = true
  
  setTimeout(() => {
    showMessage.value = false
  }, 3000)
}

// 获取国际化消息
const getTranslatedMessage = (key) => {
  const messageMap = {
    'addSuccess': t('cart.addSuccess'),
    'addFailed': t('cart.addFailed'),
    'outOfStock': t('product.outOfStock')
  }
  
  return messageMap[key] || key
}

// 计算消息样式
const messageClass = computed(() => {
  return messageType.value === 'success' 
    ? 'bg-green-500 text-white' 
    : 'bg-red-500 text-white'
})

// 模拟产品数据加载
const loadProducts = async () => {
  try {
    isLoading.value = true
    
    // 模拟API请求延迟
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // 模拟产品数据
    products.value = [
      {
        id: 1,
        name: '精美手机壳',
        name_th: 'เคสโทรศัพท์สวยงาม',
        description: '高品质硅胶材质，完美保护您的手机',
        description_th: 'ซิลิโคนคุณภาพสูง ปกป้องโทรศัพท์ของคุณได้อย่างสมบูรณ์แบบ',
        price: 29.99,
        original_price: 39.99,
        stock: 15,
        image_url: 'https://images.unsplash.com/photo-1556656793-08538906a9f8?w=400&h=400&fit=crop',
        category_id: 1
      },
      {
        id: 2,
        name: '无线蓝牙耳机',
        name_th: 'หูฟังบลูทูธไร้สาย',
        description: '高音质立体声，长续航时间',
        description_th: 'เสียงสเตอริโอคุณภาพสูง แบตเตอรี่ใช้งานได้นาน',
        price: 199.99,
        stock: 8,
        image_url: 'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=400&h=400&fit=crop',
        category_id: 2
      },
      {
        id: 3,
        name: '智能手表',
        name_th: 'นาฬิกาอัจฉริยะ',
        description: '多功能运动手表，健康监测',
        description_th: 'นาฬิกากีฬาอเนกประสงค์ ตรวจสอบสุขภาพ',
        price: 299.99,
        stock: 0,
        image_url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=400&fit=crop',
        category_id: 2
      }
    ]
    
    totalPages.value = Math.ceil(products.value.length / pageSize)
  } catch (error) {
    console.error('加载产品失败:', error)
    showError('加载产品失败')
  } finally {
    isLoading.value = false
  }
}

// 跳转到产品详情
const goToProductDetail = (productId) => {
  router.push({ name: 'ProductDetail', params: { id: productId } })
}

// 添加到购物车 - 游客可用
const addToCart = async (product) => {
  if (product.stock === 0) {
    showMessageToast('outOfStock', 'error')
    return
  }
  
  try {
    const result = await cartStore.addToCart(product)
    if (result.success) {
      showMessageToast(result.message, 'success')
      // 跳转到购物车页面
      router.push('/cart')
    } else {
      showMessageToast('addFailed', 'error')
    }
  } catch (error) {
    console.error('添加到购物车失败:', error)
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
    const result = await cartStore.addToCart(product)
    if (result.success) {
      // 直接跳转到结算页面
      router.push('/checkout')
    } else {
      showMessageToast('addFailed', 'error')
    }
  } catch (error) {
    console.error('立即购买失败:', error)
    showMessageToast('addFailed', 'error')
  }
}

// 分页
const goToPage = (page) => {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page
    // 这里可以重新加载数据
  }
}

// 组件挂载时加载数据
onMounted(() => {
  loadProducts()
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