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
            {{ t('common.back') }}
          </button>
          
          <h1 class="text-base sm:text-lg font-semibold">{{ t('cart.title') }} ({{ cartStore.itemCount }})</h1>
          
          <!-- 清空购物车按钮 -->
          <button
            v-if="!cartStore.isEmpty"
            @click="showClearModal = true"
            class="text-sm text-red-600 hover:text-red-700"
          >
            {{ t('cart.clear') }}
          </button>
          <div v-else class="w-8"></div>
        </div>
      </div>
    </header>

    <!-- 加载状态 -->
    <div v-if="cartStore.isLoading" class="flex justify-center py-12">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>

    <!-- 购物车内容 -->
    <div v-else class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
      <!-- 空购物车状态 -->
      <div v-if="cartStore.isEmpty" class="text-center py-8 sm:py-12">
        <div class="mx-auto h-24 w-24 text-gray-400 mb-4">
          <ShoppingCartIcon class="h-full w-full" />
        </div>
        <h3 class="text-lg font-medium text-gray-900 mb-2">
          {{ t('cart.empty') }}
        </h3>
        <p class="text-gray-500 mb-6">
          {{ t('cart.emptyDesc') }}
        </p>
        <router-link 
          to="/"
          class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
        >
          {{ t('cart.continue') }}
        </router-link>
      </div>

      <!-- 购物车商品列表 -->
      <div v-else class="lg:grid lg:grid-cols-12 lg:gap-x-12 lg:items-start">
        <!-- 商品列表区域 -->
        <div class="lg:col-span-7">
          <div class="space-y-4">
            <TransitionGroup name="cart-item" tag="div">
              <div
                v-for="item in cartStore.items"
                :key="item.id"
                class="bg-white rounded-lg shadow-sm p-4 sm:p-6 border border-gray-200"
              >
                <!-- 桌面端布局 -->
                <div class="hidden sm:flex sm:items-center sm:space-x-4">
                  <!-- 商品图片 -->
                  <div class="flex-shrink-0">
                    <img
                      :src="item.product.image_url || defaultImage"
                      :alt="item.product.name"
                      class="h-20 w-20 rounded-md object-cover"
                    />
                  </div>

                  <!-- 商品信息 -->
                  <div class="flex-1 min-w-0">
                    <h3 class="text-lg font-medium text-gray-900 truncate">
                      {{ item.product.name }}
                    </h3>
                    <p class="text-sm text-gray-500 mt-1 line-clamp-2">
                      {{ item.product.description }}
                    </p>
                    <div class="flex items-center mt-2">
                      <!-- 有折扣时显示折扣价格 -->
                      <div v-if="item.product.discount && item.product.discount > 0" class="flex items-center space-x-2">
                        <span class="text-lg font-bold text-red-600">{{ t('common.currency') }}{{ item.price }}</span>
                        <span class="text-sm text-gray-400 line-through">{{ t('common.currency') }}{{ item.product.price }}</span>
                        <span class="px-1 py-0.5 text-xs bg-red-100 text-red-600 rounded">{{ item.product.discount }}%</span>
                      </div>
                      <!-- 无折扣时显示正常价格 -->
                      <div v-else>
                        <span class="text-lg font-bold text-blue-600">{{ t('common.currency') }}{{ item.price }}</span>
                      </div>
                      <span v-if="item.product.stock <= 10" class="ml-2 text-xs text-orange-600">
                        {{ t('product.lowStock') }}
                      </span>
                    </div>
                  </div>

                  <!-- 数量操作 -->
                  <div class="flex items-center space-x-2">
                    <button
                      @click="decreaseQuantity(item)"
                      :disabled="item.quantity <= 1 || updating.has(item.id)"
                      class="w-8 h-8 flex items-center justify-center border border-gray-300 rounded-md text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <MinusIcon class="h-4 w-4" />
                    </button>
                    
                    <span class="w-12 text-center font-medium">
                      {{ item.quantity }}
                    </span>
                    
                    <button
                      @click="increaseQuantity(item)"
                      :disabled="item.quantity >= item.product.stock || updating.has(item.id)"
                      class="w-8 h-8 flex items-center justify-center border border-gray-300 rounded-md text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <PlusIcon class="h-4 w-4" />
                    </button>
                  </div>

                  <!-- 小计和删除 -->
                  <div class="flex flex-col items-end space-y-2">
                    <span class="text-lg font-bold text-gray-900">
                      {{ t('common.currency') }}{{ (item.price * item.quantity).toFixed(2) }}
                    </span>
                    <button
                      @click="removeItem(item)"
                      :disabled="updating.has(item.id)"
                      class="text-red-600 hover:text-red-700 text-sm disabled:opacity-50"
                    >
                      <TrashIcon class="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <!-- 移动端布局 -->
                <div class="sm:hidden">
                  <!-- 商品基本信息 -->
                  <div class="flex space-x-3">
                    <!-- 商品图片 -->
                    <div class="flex-shrink-0">
                      <img
                        :src="item.product.image_url || defaultImage"
                        :alt="item.product.name"
                        class="h-16 w-16 rounded-md object-cover"
                      />
                    </div>

                    <!-- 商品信息 -->
                    <div class="flex-1 min-w-0">
                      <h3 class="text-base font-medium text-gray-900 line-clamp-2">
                        {{ item.product.name }}
                      </h3>
                      <div class="flex items-center mt-1">
                        <!-- 有折扣时显示折扣价格 -->
                        <div v-if="item.product.discount && item.product.discount > 0" class="flex items-center space-x-1">
                          <span class="text-base font-bold text-red-600">{{ t('common.currency') }}{{ item.price }}</span>
                          <span class="text-xs text-gray-400 line-through">{{ t('common.currency') }}{{ item.product.price }}</span>
                          <span class="px-1 py-0.5 text-xs bg-red-100 text-red-600 rounded">{{ item.product.discount }}%</span>
                        </div>
                        <!-- 无折扣时显示正常价格 -->
                        <div v-else>
                          <span class="text-base font-bold text-blue-600">{{ t('common.currency') }}{{ item.price }}</span>
                        </div>
                        <span v-if="item.product.stock <= 10" class="ml-2 text-xs text-orange-600">
                          {{ t('product.lowStock') }}
                        </span>
                      </div>
                    </div>

                    <!-- 删除按钮 -->
                    <div class="flex-shrink-0">
                      <button
                        @click="removeItem(item)"
                        :disabled="updating.has(item.id)"
                        class="p-1 text-red-600 hover:text-red-700 disabled:opacity-50"
                      >
                        <TrashIcon class="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  <!-- 数量控制和小计 -->
                  <div class="flex items-center justify-between mt-4">
                    <!-- 数量操作 -->
                    <div class="flex items-center space-x-2">
                      <span class="text-sm text-gray-600">{{ t('product.quantity') }}:</span>
                      <button
                        @click="decreaseQuantity(item)"
                        :disabled="item.quantity <= 1 || updating.has(item.id)"
                        class="w-8 h-8 flex items-center justify-center border border-gray-300 rounded-md text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <MinusIcon class="h-4 w-4" />
                      </button>
                      
                      <span class="w-10 text-center font-medium text-sm">
                        {{ item.quantity }}
                      </span>
                      
                      <button
                        @click="increaseQuantity(item)"
                        :disabled="item.quantity >= item.product.stock || updating.has(item.id)"
                        class="w-8 h-8 flex items-center justify-center border border-gray-300 rounded-md text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <PlusIcon class="h-4 w-4" />
                      </button>
                    </div>

                    <!-- 小计 -->
                    <div class="text-right">
                      <span class="text-sm text-gray-600">{{ t('cart.subtotal') }}:</span>
                      <span class="ml-1 text-lg font-bold text-gray-900">
                        {{ t('common.currency') }}{{ (item.price * item.quantity).toFixed(2) }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- 库存不足提示 -->
                <div v-if="item.quantity > item.product.stock" class="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-md">
                  <div class="flex">
                    <ExclamationTriangleIcon class="h-5 w-5 text-orange-400" />
                    <div class="ml-3">
                      <p class="text-sm text-orange-800">
                        {{ t('product.outOfStock') }}，{{ t('product.stock') }} {{ item.product.stock }} {{ t('common.unit') }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </TransitionGroup>
          </div>
        </div>

        <!-- 订单摘要区域 -->
        <div class="mt-8 lg:mt-0 rounded-lg bg-white shadow-sm border border-gray-200 px-4 py-6 sm:p-6 lg:col-span-5 lg:p-8">
          <h2 class="text-lg font-medium text-gray-900">{{ t('order.summary') }}</h2>

          <div class="mt-6 space-y-4">
            <!-- 商品明细 -->
            <div class="flex items-center justify-between">
              <dt class="text-sm text-gray-600">{{ t('cart.itemCount') }}</dt>
              <dd class="text-sm font-medium text-gray-900">{{ cartStore.itemCount }} {{ t('common.unit') }}</dd>
            </div>

            <div class="flex items-center justify-between">
              <dt class="text-sm text-gray-600">{{ t('cart.subtotal') }}</dt>
              <dd class="text-sm font-medium text-gray-900">{{ t('common.currency') }}{{ cartStore.totalAmount.toFixed(2) }}</dd>
            </div>

            <div class="flex items-center justify-between">
              <dt class="text-sm text-gray-600">{{ t('order.deliveryMode') }}</dt>
              <dd class="text-sm font-medium text-gray-900">{{ t('common.free') }}</dd>
            </div>

            <div class="border-t border-gray-200 pt-4 flex items-center justify-between">
              <dt class="text-lg font-medium text-gray-900">{{ t('cart.total') }}</dt>
              <dd class="text-lg font-bold text-blue-600">{{ t('common.currency') }}{{ cartStore.totalAmount.toFixed(2) }}</dd>
            </div>
          </div>

          <!-- 结算按钮 -->
          <div class="mt-6">
            <button
              @click="goToCheckout"
              :disabled="cartStore.isEmpty || hasStockIssues"
              class="w-full bg-blue-600 border border-transparent rounded-md shadow-sm py-3 px-4 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ hasStockIssues ? t('cart.stockIssue') : t('cart.checkout') }}
            </button>
          </div>

          <!-- 继续购物 -->
          <div class="mt-6 text-center">
            <router-link
              to="/"
              class="text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              {{ t('cart.continue') }}
              <span aria-hidden="true"> &rarr;</span>
            </router-link>
          </div>
        </div>
      </div>
    </div>

    <!-- 清空购物车确认模态框 -->
    <div 
      v-if="showClearModal" 
      class="fixed inset-0 z-50 overflow-y-auto"
      @click="showClearModal = false"
    >
      <div class="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div class="fixed inset-0 bg-black bg-opacity-50 transition-opacity"></div>
        
        <div class="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
          <div class="sm:flex sm:items-start">
            <div class="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
              <ExclamationTriangleIcon class="h-6 w-6 text-red-600" />
            </div>
            <div class="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
              <h3 class="text-lg leading-6 font-medium text-gray-900">
                {{ t('cart.clear') }}
              </h3>
              <div class="mt-2">
                <p class="text-sm text-gray-500">
                  {{ t('cart.confirmClearMessage') }}
                </p>
              </div>
            </div>
          </div>
          <div class="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
            <button
              @click="confirmClearCart"
              :disabled="clearing"
              class="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
            >
              {{ clearing ? t('cart.clearing') : t('cart.confirmClear') }}
            </button>
            <button
              @click="showClearModal = false"
              class="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:w-auto sm:text-sm"
            >
              {{ t('common.cancel') }}
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
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useCartStore } from '../../stores/cart.js'
import { 
  ArrowLeftIcon, 
  ShoppingCartIcon, 
  MinusIcon, 
  PlusIcon,
  TrashIcon,
  ExclamationTriangleIcon
} from '@heroicons/vue/24/outline'

// 国际化
const { t, locale } = useI18n()

// 路由和状态
const router = useRouter()
const cartStore = useCartStore()

// 响应式数据
const updating = ref(new Set())
const showClearModal = ref(false)
const clearing = ref(false)
const showMessage = ref(false)
const message = ref('')
const messageType = ref('success')

// 默认图片
const defaultImage = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjMwMCIgdmlld0JveD0iMCAwIDMwMCAzMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0xNTAgMTAwVjIwME0xMDAgMTUwSDIwMCIgc3Ryb2tlPSIjRDREMEQ4IiBzdHJva2Utd2lkdGg9IjQiLz4KPHN2Zz4K'

// 计算属性
const messageClass = computed(() => {
  return messageType.value === 'success' 
    ? 'bg-green-500 text-white' 
    : 'bg-red-500 text-white'
})

const hasStockIssues = computed(() => {
  return cartStore.items.some(item => item.quantity > item.product.stock)
})

// 获取当前语言的值
const getCurrentLanguageValue = (item, field) => {
  const currentLang = locale.value
  if (currentLang === 'th-TH' && item[`${field}_th`]) {
    return item[`${field}_th`]
  }
  return item[field] || ''
}

// 增加数量
const increaseQuantity = async (item) => {
  if (updating.value.has(item.id)) return
  
  updating.value.add(item.id)
  try {
    const result = await cartStore.updateQuantity(item.id, item.quantity + 1)
    if (!result.success) {
      showMessageToast(result.message, 'error')
    }
  } finally {
    updating.value.delete(item.id)
  }
}

// 减少数量
const decreaseQuantity = async (item) => {
  if (updating.value.has(item.id)) return
  
  updating.value.add(item.id)
  try {
    const result = await cartStore.updateQuantity(item.id, item.quantity - 1)
    if (!result.success) {
      showMessageToast(result.message, 'error')
    }
  } finally {
    updating.value.delete(item.id)
  }
}

// 移除商品
const removeItem = async (item) => {
  if (updating.value.has(item.id)) return
  
  updating.value.add(item.id)
  try {
    const result = await cartStore.removeFromCart(item.id)
    if (result.success) {
      showMessageToast(result.message, 'success')
    } else {
      showMessageToast(result.message, 'error')
    }
  } finally {
    updating.value.delete(item.id)
  }
}

// 确认清空购物车
const confirmClearCart = async () => {
  if (clearing.value) return
  
  try {
    clearing.value = true
    const result = await cartStore.clearCart()
    
    if (result.success) {
      showMessageToast(t('cart.clearSuccess'), 'success')
      showClearModal.value = false
    } else {
      showMessageToast(t('cart.clearFailed'), 'error')
    }
  } finally {
    clearing.value = false
  }
}

// 去结算
const goToCheckout = () => {
  if (cartStore.isEmpty || hasStockIssues.value) return
  router.push('/checkout')
}

// 返回上一页
const goBack = () => {
  router.go(-1)
}

// 显示消息提示
const showMessageToast = (msg, type = 'success') => {
  // 如果消息是键名，则进行国际化转换
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
    'updateSuccess': t('cart.updateSuccess'),
    'updateFailed': t('cart.updateFailed'),
    'removeSuccess': t('cart.removeSuccess'),
    'removeFailed': t('cart.removeFailed'),
    'clearSuccess': t('cart.clearSuccess'),
    'clearFailed': t('cart.clearFailed'),
    'itemNotFound': t('cart.itemNotFound')
  }
  
  return messageMap[key] || key
}

// 组件挂载时加载购物车数据
onMounted(async () => {
  await cartStore.loadCart()
  // 检查库存状态
  await cartStore.checkStock()
})
</script>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

.cart-item-enter-active, .cart-item-leave-active {
  transition: all 0.3s ease;
}

.cart-item-enter-from, .cart-item-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}

.cart-item-move {
  transition: transform 0.3s ease;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>