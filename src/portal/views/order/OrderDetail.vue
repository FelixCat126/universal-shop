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
          
          <h1 class="text-base sm:text-lg font-semibold">{{ t('order.orderDetail') }}</h1>
          
          <div class="w-16"></div>
        </div>
      </div>
    </header>

    <!-- 加载状态 -->
    <div v-if="loading" class="flex justify-center py-12">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="error" class="text-center py-12">
      <ExclamationTriangleIcon class="mx-auto h-12 w-12 text-gray-400 mb-4" />
      <h3 class="text-lg font-medium text-gray-900 mb-2">{{ t('error.loadFailed') }}</h3>
      <p class="text-gray-500 mb-4">{{ error }}</p>
      <button
        @click="loadOrderDetail"
        class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
      >
        {{ t('common.retry') }}
      </button>
    </div>

    <!-- 订单详情内容 -->
    <div v-else-if="order" class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
      <!-- 订单状态卡片 -->
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 mb-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h2 class="text-xl font-bold text-gray-900">{{ t('order.title') }} #{{ order.order_no }}</h2>
            <p class="text-sm text-gray-500 mt-1">
              {{ t('order.orderTime') }}: {{ formatDateTime(order.created_at) }}
            </p>
          </div>
          <div class="text-right">
            <span 
              :class="[
                'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium',
                getStatusStyle(order.status)
              ]"
            >
              {{ getStatusText(order.status) }}
            </span>
            <div class="mt-3 flex flex-wrap gap-2 justify-end">
              <button
                v-if="order.payment_method === 'online' && order.status === 'pending'"
                type="button"
                class="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium text-white bg-green-600 hover:bg-green-700"
                @click="openOnlinePayDetail"
              >
                {{ t('order.goPay') }}
              </button>
            </div>
            <div class="mt-2">
              <template v-if="order.payment_method === 'points'">
                <p class="text-lg font-bold text-amber-900">{{ t('payment.pointsRedeemedShort', { points: order.points_redeemed }) }}</p>
              </template>
              <template v-else-if="order.payment_method === 'online'">
                <div class="text-lg font-bold text-blue-600">{{ formattedOrder.mainLabel }}</div>
                <div class="text-sm text-green-600">≈ {{ usdtFromOrder }} USDT</div>
                <div v-if="formattedOrder.amountThb != null && order.currency_code !== 'THB'" class="text-sm text-gray-500">
                  (≈ {{ t('product.currencyThbSymbol') }}{{ formattedOrder.amountThb.toFixed(2) }} THB)
                </div>
              </template>
              <template v-else>
                <p class="text-lg font-bold text-blue-600">{{ formattedOrder.mainLabel }}</p>
                <div v-if="formattedOrder.amountThb != null && order.currency_code !== 'THB'" class="text-sm text-gray-500">
                  (≈ {{ t('product.currencyThbSymbol') }}{{ formattedOrder.amountThb.toFixed(2) }} THB)
                </div>
              </template>
            </div>
          </div>
        </div>


      </div>

      <!-- 收货信息 -->
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 mb-6">
        <h3 class="text-lg font-semibold mb-4 flex items-center">
          <MapPinIcon class="h-5 w-5 mr-2 text-blue-600" />
          {{ t('order.shippingInfo') }}
        </h3>
        
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span class="font-medium text-gray-700">{{ t('order.recipient') }}:</span>
            <span class="ml-2 text-gray-900">{{ order.contact_name }}</span>
          </div>
          <div>
            <span class="font-medium text-gray-700">{{ t('order.contactPhone') }}:</span>
            <span class="ml-2 text-gray-900">{{ order.contact_phone }}</span>
          </div>
          <div class="sm:col-span-2">
            <span class="font-medium text-gray-700">{{ t('order.shippingAddress') }}:</span>
            <span class="ml-2 text-gray-900">{{ order.delivery_address }}</span>
          </div>
          <div v-if="order.postal_code">
            <span class="font-medium text-gray-700">{{ t('address.postalCode') || '邮编' }}:</span>
            <span class="ml-2 text-gray-900">{{ order.postal_code }}</span>
          </div>
          <div>
            <span class="font-medium text-gray-700">{{ t('order.deliveryMode') }}:</span>
            <span class="ml-2 text-gray-900">{{ getDeliveryModeText(order.delivery_mode) }}</span>
          </div>
          <div v-if="order.notes">
            <span class="font-medium text-gray-700">{{ t('order.notes') }}:</span>
            <span class="ml-2 text-gray-900">{{ order.notes }}</span>
          </div>
        </div>
      </div>

      <!-- 商品列表 -->
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
        <h3 class="text-lg font-semibold mb-4 flex items-center">
          <ShoppingBagIcon class="h-5 w-5 mr-2 text-blue-600" />
          {{ t('order.items') }}
        </h3>

        <div class="space-y-4">
          <div
            v-for="item in order.items"
            :key="item.id"
            class="flex items-center space-x-4 p-3 bg-gray-50 rounded-lg"
          >
            <!-- 商品图片 -->
            <div class="flex-shrink-0">
              <img
                :src="getImageUrl(item.product?.image_url) || defaultImage"
                :alt="item.product_name_zh || item.product?.name_zh"
                class="h-16 w-16 sm:h-20 sm:w-20 rounded-md object-cover"
                @error="handleImageError"
              />
            </div>

            <!-- 商品信息 -->
            <div class="flex-1 min-w-0">
              <h4 class="text-sm sm:text-base font-medium text-gray-900 line-clamp-2">
                {{ item.product_name || item.product?.name }}
              </h4>
              <div class="flex items-center justify-between mt-2">
                <div class="text-xs sm:text-sm text-gray-500">
                  <template v-if="order.payment_method === 'points' && item.points_line_cost != null">
                    {{ t('order.linePointsRow', { points: item.points_line_cost }) }} × {{ item.quantity }}
                  </template>
                  <template v-else>
                    {{ t('cart.price') }}: {{ formatLineRecordedFromThb(order, item.price) }} × {{ item.quantity }}
                  </template>
                </div>
                <div class="text-sm sm:text-base font-bold text-gray-900">
                  <template v-if="order.payment_method === 'points' && item.points_line_cost != null">
                    {{ t('order.linePointsSum', { points: Number(item.points_line_cost) * Number(item.quantity) }) }}
                  </template>
                  <template v-else>
                    {{ formatLineRecordedFromThb(order, item.price * item.quantity) }}
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 订单汇总 -->
        <div class="mt-6 pt-6 border-t border-gray-200">
          <div class="flex justify-between items-center">
            <span class="text-lg font-semibold text-gray-900">{{ t('order.total') }}</span>
            <template v-if="order.payment_method === 'points'">
              <span class="text-xl font-bold text-amber-900">{{ t('payment.pointsRedeemedShort', { points: order.points_redeemed }) }}</span>
            </template>
            <div v-else-if="order.payment_method === 'online'" class="text-right">
              <div class="text-xl font-bold text-blue-600">{{ formattedOrder.mainLabel }}</div>
              <div class="text-sm text-green-600">≈ {{ usdtFromOrder }} USDT</div>
            </div>
            <div v-else class="text-right">
              <span class="text-xl font-bold text-blue-600">{{ formattedOrder.mainLabel }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>



    <!-- 待支付在线单：再次扫码确认 -->
    <div v-if="onlinePayModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="fixed inset-0 bg-black bg-opacity-50" @click="closeOnlinePayDetail"></div>
      <div class="bg-white p-6 rounded-lg shadow-xl z-10 w-full max-w-md">
        <div class="text-center">
          <h3 class="text-lg font-medium mb-4">{{ t('payment.scanToPay') }}</h3>
          <div class="mb-4 p-4 bg-gray-50 rounded-lg">
            <div class="mb-3">
              <div class="text-sm text-gray-600">{{ t('order.amount') }}</div>
              <div class="text-2xl font-bold text-blue-600">{{ portalCurrency.formatThb(onlinePayThbFmt) }}</div>
            </div>
            <div class="pt-3 border-t border-gray-200">
              <div class="text-sm text-gray-600">{{ t('payment.usdtAmount') }}</div>
              <div class="text-xl font-semibold text-green-600">{{ onlinePayUsdt }} USDT</div>
            </div>
          </div>
          <div class="mb-6 p-4 bg-gray-50 rounded-lg">
            <div class="w-48 h-48 mx-auto bg-white rounded-lg flex items-center justify-center border-2 border-dashed border-gray-300">
              <div v-if="onlinePayQr" class="w-full h-full flex items-center justify-center">
                <img
                  :src="config.buildStaticUrl(onlinePayQr)"
                  alt=""
                  class="max-w-full max-h-full object-contain rounded-lg"
                  @error="onlinePayQr = null"
                />
              </div>
              <div v-else class="text-center">
                <div class="text-6xl mb-2">📱</div>
                <div class="text-sm text-gray-500">{{ t('payment.scanToPay') }}</div>
              </div>
            </div>
          </div>
          <div class="flex space-x-3">
            <button
              type="button"
              class="flex-1 px-4 py-2 border border-gray-300 rounded-md disabled:opacity-50"
              :disabled="onlinePayBusy"
              @click="closeOnlinePayDetail"
            >
              {{ t('payment.cancel') }}
            </button>
            <button
              type="button"
              class="flex-1 px-4 py-2 bg-green-600 text-white rounded-md disabled:opacity-50"
              :disabled="onlinePayBusy"
              @click="confirmOnlinePayDetail"
            >
              {{ onlinePayBusy ? t('common.submitting') : t('payment.complete') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 成功/错误消息 -->
    <div 
      v-if="message.show"
      :class="[
        'fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-sm',
        message.type === 'success' ? 'bg-green-100 border border-green-400 text-green-700' : 'bg-red-100 border border-red-400 text-red-700'
      ]"
    >
      <div class="flex">
        <CheckCircleIcon v-if="message.type === 'success'" class="h-5 w-5 mr-2" />
        <ExclamationCircleIcon v-else class="h-5 w-5 mr-2" />
        <span>{{ message.text }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getOrderDetail, confirmOnlinePayment as confirmOnlinePaymentApi } from '../../api/orders.js'
import {
  ArrowLeftIcon,
  ShoppingBagIcon,
  MapPinIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon
} from '@heroicons/vue/24/outline'
import getCurrentLanguageValue from '../../utils/language.js'
import config from '../../../config/index.js'
import { formatRecordedOrderAmount, formatLineRecordedFromThb } from '../../utils/orderBillingDisplay.js'
import { usePortalCurrencyStore } from '../../stores/portalCurrency.js'

const router = useRouter()
const route = useRoute()

// 国际化
const { t } = useI18n()

const portalCurrency = usePortalCurrencyStore()

// 响应式数据
const loading = ref(true)
const error = ref('')
const order = ref(null)

const onlinePayModalOpen = ref(false)
const onlinePayQr = ref(null)
const onlinePayRate = ref(0)
const onlinePayBusy = ref(false)

const onlinePayThbFmt = computed(() => {
  const o = order.value
  if (!o) return '0.00'
  const x = parseFloat(o.total_amount_thb)
  return Number.isFinite(x) ? x.toFixed(2) : '0.00'
})

const onlinePayUsdt = computed(() => {
  const thb = parseFloat(onlinePayThbFmt.value)
  const t0 = Number.isFinite(thb) ? thb : 0
  return (t0 * onlinePayRate.value).toFixed(2)
})

// 默认图片
const defaultImage = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik02MCA2MEgxNDBWMTQwSDYwVjYwWiIgc3Ryb2tlPSIjOUI5QkEwIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiLz4KPGNpcmNsZSBjeD0iODAiIGN5PSI4MCIgcj0iMTAiIGZpbGw9IiM5QjlCQTAiLz4KPHBhdGggZD0iTTkwIDEwMEwxMjAgNzBMMTMwIDgwTDEyMCAxMDBMOTAgMTAwWiIgZmlsbD0iIzlCOUJBMCIvPgo8L3N2Zz4K'

// 消息提示
const message = reactive({
  show: false,
  type: 'success',
  text: ''
})

// 显示消息
const showMessage = (text, type = 'success') => {
  message.text = text
  message.type = type
  message.show = true
  
  setTimeout(() => {
    message.show = false
  }, 5000)
}

// 获取订单状态样式
const getStatusStyle = (status) => {
  const styles = {
    pending: 'bg-yellow-100 text-yellow-800',
    paid: 'bg-blue-100 text-blue-800',
    shipped: 'bg-purple-100 text-purple-800',
    shipping: 'bg-blue-100 text-blue-800',
    delivered: 'bg-green-100 text-green-800',
    completed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800'
  }
  return styles[status] || 'bg-gray-100 text-gray-800'
}

// 获取订单状态文本
const getStatusText = (status) => {
  const statusMap = {
    pending: t('order.status.pending'),
    shipping: t('order.status.shipping'),
    shipped: t('order.status.shipped'),
    completed: t('order.status.completed'),
    cancelled: t('order.status.cancelled')
  }
  return statusMap[status] ?? (status != null && status !== '' ? String(status) : '—')
}

async function loadOnlinePayCfg () {
  try {
    const response = await fetch(config.buildApiUrl('/api/system-config/public'))
    if (!response.ok) return
    const data = await response.json()
    if (data.success && data.data) {
      onlinePayQr.value = data.data.payment_qrcode
      onlinePayRate.value = parseFloat(data.data.exchange_rate || '0.00')
    }
  } catch {
    /* silent */
  }
}

function openOnlinePayDetail () {
  if (!order.value || order.value.payment_method !== 'online' || order.value.status !== 'pending') return
  loadOnlinePayCfg()
  onlinePayModalOpen.value = true
}

function closeOnlinePayDetail () {
  if (onlinePayBusy.value) return
  onlinePayModalOpen.value = false
}

async function confirmOnlinePayDetail () {
  const id = order.value?.id
  if (!id) return
  onlinePayBusy.value = true
  try {
    const response = await confirmOnlinePaymentApi(id)
    if (!response.data?.success) {
      showMessage(response.data?.message || t('order.submitFailed'), 'error')
      return
    }
    onlinePayModalOpen.value = false
    showMessage(t('order.payConfirmOk'), 'success')
    await loadOrderDetail()
  } catch (err) {
    showMessage(err.response?.data?.message || t('order.loadDetailFailed'), 'error')
  } finally {
    onlinePayBusy.value = false
  }
}
const getDeliveryModeText = (mode) => {
  const texts = {
    standard: t('order.standardDelivery'),
    express: t('order.expressDelivery')
  }
  return texts[mode] || t('order.standardDelivery')
}

// 格式化日期时间
const formatDateTime = (dateString) => {
  if (!dateString) return ''
  
  const date = new Date(dateString)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  
  const timeStr = date.toLocaleTimeString('zh-CN', { 
    hour: '2-digit', 
    minute: '2-digit' 
  })
  
  if (targetDate.getTime() === today.getTime()) {
    return `${t('order.today')} ${timeStr}`
  } else if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}-${date.getDate()} ${timeStr}`
  } else {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${timeStr}`
  }
}

const formattedOrder = computed(() =>
  order.value ? formatRecordedOrderAmount(order.value) : { currencyCode: 'THB', mainLabel: '—', amountThb: null }
)

const usdtFromOrder = computed(() => {
  const o = order.value
  if (!o) return '0.00'
  const thb = parseFloat(o.total_amount_thb)
  const r = parseFloat(o.exchange_rate)
  if (!(Number.isFinite(thb) && Number.isFinite(r))) return '0.00'
  return (thb * r).toFixed(2)
})

// 加载订单详情
const loadOrderDetail = async () => {
  loading.value = true
  error.value = ''
  
  try {
    const orderId = route.params.id
    if (!orderId) {
      throw new Error(t('order.orderIdRequired'))
    }

    const response = await getOrderDetail(orderId)
    
    if (response.data.success) {
      order.value = response.data.data
    } else {
      error.value = response.data.message || t('order.loadDetailFailed')
    }

  } catch (err) {
    console.error('加载订单详情失败:', err)
    error.value = err.response?.data?.message || t('error.network')
  } finally {
    loading.value = false
  }
}



// 返回上一页
const goBack = () => {
  router.go(-1)
}

// 获取完整的图片URL - 使用配置管理器
const getImageUrl = (imagePath) => {
  return config.buildStaticUrl(imagePath)
}

// 处理图片加载错误
const handleImageError = (event) => {
  console.warn('图片加载失败:', event.target.src)
  event.target.src = defaultImage
}

// 页面初始化
onMounted(() => {
  loadOrderDetail()
})
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>