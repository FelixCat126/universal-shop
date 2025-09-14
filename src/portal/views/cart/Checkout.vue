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
          
          <h1 class="text-base sm:text-lg font-semibold">{{ t('order.confirmOrder') }}</h1>
          
          <div class="w-16"></div>
        </div>
      </div>
    </header>

    <!-- 加载状态 -->
    <div v-if="loading" class="flex justify-center py-12">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>

    <!-- 订单确认内容 -->
    <div v-else class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
      <div class="lg:grid lg:grid-cols-12 lg:gap-x-12">
        <!-- 主要内容区域 -->
        <div class="lg:col-span-8">
          <!-- 订单商品列表 -->
          <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 mb-6">
            <h2 class="text-lg font-semibold mb-4 flex items-center">
              <ShoppingBagIcon class="h-5 w-5 mr-2 text-blue-600" />
              {{ t('order.items') }} ({{ cartStore.itemCount }} {{ t('common.unit') }})
            </h2>
            
            <div class="space-y-4">
              <div
                v-for="item in cartStore.items"
                :key="item.id"
                class="flex items-center space-x-4 p-3 bg-gray-50 rounded-lg"
              >
                <!-- 商品图片 -->
                <div class="flex-shrink-0">
                  <img
                    :src="item.product.image_url || defaultImage"
                    :alt="item.product.name"
                    class="h-16 w-16 sm:h-20 sm:w-20 rounded-md object-cover"
                  />
                </div>

                <!-- 商品信息 -->
                <div class="flex-1 min-w-0">
                  <h3 class="text-sm sm:text-base font-medium text-gray-900 line-clamp-2">
                    {{ item.product.name }}
                  </h3>
                  <div class="text-xs sm:text-sm text-gray-500 mt-1">
                    {{ t('cart.price') }}: {{ t('common.currency') }}{{ item.price }} × {{ item.quantity }}
                  </div>
                </div>

                <!-- 小计 -->
                <div class="text-right">
                  <span class="text-sm sm:text-base font-bold text-gray-900">
                    {{ t('common.currency') }}{{ (item.price * item.quantity).toFixed(2) }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- 收货信息 -->
          <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 mb-6">
            <h2 class="text-lg font-semibold mb-4 flex items-center">
              <MapPinIcon class="h-5 w-5 mr-2 text-blue-600" />
              {{ t('order.shippingInfo') }}
            </h2>
            
            <!-- 游客提示 -->
            <div v-if="!userStore.isLoggedIn" class="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div class="flex">
                <div class="flex-shrink-0">
                  <div class="text-yellow-400">ℹ️</div>
                </div>
                <div class="ml-3">
                  <p class="text-sm text-yellow-800">
                    {{ t('order.guestOrderHint') }}
                  </p>
                </div>
              </div>
            </div>
            
            <!-- 地址选择（仅登录用户） -->
            <div v-if="userStore.isLoggedIn" class="mb-6">
              <div class="flex items-center justify-between mb-3">
                <label class="block text-sm font-medium text-gray-700">
                  {{ t('order.selectAddress') }} <span class="text-red-500">*</span>
                </label>
                <button
                  @click="goToAddAddress"
                  class="text-sm text-blue-600 hover:text-blue-800"
                >
                  + {{ t('address.addNew') }}
                </button>
              </div>

              <!-- 加载地址中 -->
              <div v-if="loadingAddresses" class="text-center py-4">
                <div class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span class="ml-2 text-sm text-gray-500">{{ t('address.loading') }}</span>
              </div>

              <!-- 地址列表 -->
              <div v-else-if="addresses.length > 0" class="space-y-3">
                <div
                  v-for="address in addresses"
                  :key="address.id"
                  @click="selectAddress(address)"
                  class="border rounded-lg p-3 cursor-pointer transition-colors"
                  :class="{
                    'border-blue-500 bg-blue-50': selectedAddress?.id === address.id,
                    'border-gray-200 hover:border-gray-300': selectedAddress?.id !== address.id
                  }"
                >
                  <div class="flex items-start justify-between">
                    <div class="flex-1">
                      <div class="flex items-center mb-1">
                        <span class="font-medium text-gray-900">{{ address.contact_name }}</span>
                        <span class="ml-2 text-sm text-gray-600">{{ address.contact_country_code }}{{ address.contact_phone }}</span>
                        <span v-if="address.is_default" class="ml-2 px-2 py-1 text-xs bg-green-100 text-green-800 rounded">{{ t('address.default') }}</span>
                      </div>
                      <p class="text-sm text-gray-700">
                        {{ formatAddress(address) }}
                      </p>
                    </div>
                    <div class="ml-3">
                      <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                           :class="selectedAddress?.id === address.id ? 'border-blue-500' : 'border-gray-300'">
                        <div v-if="selectedAddress?.id === address.id" class="w-2 h-2 rounded-full bg-blue-500"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 登录用户无地址提示 -->
              <div v-else class="text-center py-12 border-2 border-dashed border-gray-300 rounded-lg">
                <div class="text-gray-400 mb-3">📍</div>
                <h3 class="text-lg font-medium text-gray-900 mb-2">{{ t('address.noAddresses') }}</h3>
                <p class="text-gray-500 mb-6">{{ t('address.pleaseAddFirst') }}</p>
                <button
                  @click="goToAddAddress"
                  class="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                  </svg>
                  {{ t('address.add') }}
                </button>
                <p class="text-sm text-gray-400 mt-4">{{ t('address.autoReturn') }}</p>
              </div>
            </div>



            <!-- 游客：显示收货信息表单 -->
            <div v-if="!userStore.isLoggedIn" class="border-t pt-4">
              <h3 class="text-sm font-medium text-gray-700 mb-3">{{ t('order.fillShippingInfo') }}</h3>
              
              <!-- 联系人信息 -->
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-4">
                <!-- 联系人 -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {{ t('order.contactName') || '联系人' }} <span class="text-red-500">*</span>
                  </label>
                  <input
                    v-model="orderForm.contact_name"
                    type="text"
                    class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    :class="{ 'border-red-500': errors.contact_name }"
                    :placeholder="t('order.contactNamePlaceholder')"
                  />
                  <p v-if="errors.contact_name" class="text-red-500 text-xs mt-1">
                    {{ errors.contact_name }}
                  </p>
                </div>

                <!-- 联系电话 -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-3">
                    {{ t('order.contactPhone') || '联系电话' }} <span class="text-red-500">*</span>
                  </label>
                  <div class="grid grid-cols-1 gap-3 sm:grid-cols-5">
                    <!-- 国家选择 -->
                    <div class="sm:col-span-2">
                      <CountrySelector
                        v-model="orderForm.contact_country_code"
                        placeholder="选择国家"
                        @country-change="handleOrderCountryChange"
                      />
                    </div>
                    <!-- 手机号输入 -->
                    <div class="sm:col-span-3">
                      <div class="relative">
                        <div class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                          <span class="text-gray-500 text-sm">{{ orderForm.contact_country_code }}</span>
                        </div>
                        <input
                          v-model="orderForm.contact_phone"
                          type="tel"
                          class="appearance-none block w-full pl-16 pr-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                          :class="{ 'border-red-500': errors.contact_phone }"
                          :placeholder="`请输入手机号`"
                        />
                      </div>
                      <p v-if="errors.contact_phone" class="text-red-500 text-xs mt-1">
                        {{ errors.contact_phone }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 地址信息 - 泰国三级联动地址选择器 -->
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-3">
                  {{ t('order.addressRegion') || '省市区选择' }} <span class="text-red-500">*</span>
                </label>
                <ThailandAddressSelector 
                  v-model="checkoutAddressRegion"
                  @change="handleCheckoutAddressRegionChange"
                />
                <p v-if="errors.province || errors.city || errors.district" class="text-red-500 text-xs mt-1">
                  {{ errors.province || errors.city || errors.district }}
                </p>
              </div>


              <!-- 详细地址 -->
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  {{ t('order.detailAddress') || '详细地址' }} <span class="text-red-500">*</span>
                </label>
                <textarea
                  v-model="orderForm.detail_address"
                  rows="3"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  :class="{ 'border-red-500': errors.detail_address }"
                  :placeholder="t('order.detailAddressPlaceholder')"
                ></textarea>
                <p v-if="errors.detail_address" class="text-red-500 text-xs mt-1">
                  {{ errors.detail_address }}
                </p>
              </div>

              <!-- 地址类型 -->
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  {{ t('order.addressType') || '地址类型' }}
                </label>
                <select
                  v-model="orderForm.address_type"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="home">{{ t('order.addressHome') || '家庭' }}</option>
                  <option value="company">{{ t('order.addressCompany') || '公司' }}</option>
                  <option value="other">{{ t('order.addressOther') || '其他' }}</option>
                </select>
              </div>

              <!-- 推荐码（可选） -->
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  {{ t('referral.code') || '推荐码' }} <span class="text-gray-400 text-xs">({{ t('common.optional') || '可选' }})</span>
                </label>
                <input
                  v-model="orderForm.referral_code"
                  type="text"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  :placeholder="t('referral.placeholder') || '请输入推荐码'"
                />
                <p class="text-gray-500 text-xs mt-1">
                  {{ t('referral.checkoutHint') || '填写推荐码可享受相关优惠，注册时将自动关联推荐人' }}
                </p>
              </div>
            </div>

            <!-- 支付方式 -->
            <div class="mt-6 pt-4 border-t">
              <label class="block text-sm font-medium text-gray-700 mb-3">
                {{ t('order.paymentMethod') }} <span class="text-red-500">*</span>
              </label>
            <div class="space-y-3">
              <label class="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50"
                     :class="[ orderForm.payment_method === 'cod' ? 'border-blue-500 bg-blue-50' : '', codDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : '' ]"
                     @click="!codDisabled && (orderForm.payment_method = 'cod')">
                <input
                  v-model="orderForm.payment_method"
                  type="radio"
                  value="cod"
                  :disabled="codDisabled"
                  class="mr-3 text-blue-600"
                />
                <div class="flex-1">
                  <div class="flex items-center">
                    <span class="text-2xl mr-2">💰</span>
                    <span class="font-medium">{{ t('payment.cod') }}</span>
                  </div>
                  <p class="text-sm text-gray-500 mt-1">{{ t('payment.codDesc') }}</p>
                  <p v-if="codDisabled" class="text-xs text-red-500 mt-1">{{ t('payment.codDisabled') }}</p>
                </div>
              </label>
              
              <label class="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50"
                     :class="{ 'border-blue-500 bg-blue-50': orderForm.payment_method === 'online' }"
                     @click="orderForm.payment_method = 'online'">
                <input
                  v-model="orderForm.payment_method"
                  type="radio"
                  value="online"
                  class="mr-3 text-blue-600"
                />
                <div class="flex-1">
                  <div class="flex items-center">
                    <span class="text-2xl mr-2">💳</span>
                    <span class="font-medium">{{ t('payment.online') }}</span>
                  </div>
                  <p class="text-sm text-gray-500 mt-1">{{ t('payment.onlineDesc') }}</p>
                </div>
              </label>
            </div>
            </div>

            <!-- 订单备注 -->
            <div class="mt-4">
              <label class="block text-sm font-medium text-gray-700 mb-1">
                {{ t('order.notes') }}
              </label>
              <textarea
                v-model="orderForm.notes"
                rows="2"
                class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                :placeholder="t('order.notesPlaceholder')"
              ></textarea>
            </div>
          </div>
        </div>

        <!-- 订单摘要区域 -->
        <div class="lg:col-span-4">
          <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 sticky top-4">
            <h3 class="text-lg font-semibold mb-4">{{ t('order.summary') }}</h3>

            <div class="space-y-3">
              <!-- 商品小计 -->
              <div class="flex justify-between">
                <span class="text-sm text-gray-600">{{ t('cart.subtotal') }}</span>
                <span class="text-sm font-medium">{{ t('common.currency') }}{{ cartStore.totalAmount.toFixed(2) }}</span>
              </div>

              <!-- 运费 -->
              <div class="flex justify-between">
                <span class="text-sm text-gray-600">{{ t('order.shippingFee') }}</span>
                <span class="text-sm font-medium">{{ t('common.free') }}</span>
              </div>

              <div class="border-t pt-3">
                <div class="flex justify-between items-center">
                  <span class="text-lg font-semibold">{{ t('order.total') }}</span>
                  <span class="text-xl font-bold text-blue-600">{{ t('common.currency') }}{{ totalAmount.toFixed(2) }}</span>
                </div>
              </div>
            </div>

            <!-- 提交按钮 -->
            <div class="mt-6 space-y-3">
              <button
                @click="handleSubmitOrder"
                :disabled="submitting || cartStore.isEmpty || (userStore.isLoggedIn && !selectedAddress)"
                class="w-full bg-blue-600 text-white py-3 px-4 rounded-md font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span v-if="submitting">{{ t('common.submitting') }}</span>
                <span v-else>{{ t('order.submit') }}</span>
              </button>
              
              <router-link
                to="/cart"
                class="w-full block text-center py-3 px-4 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                {{ t('cart.backToCart') }}
              </router-link>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 支付二维码模态框 -->
    <div v-if="showPaymentModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="fixed inset-0 bg-black bg-opacity-50" @click="showPaymentModal = false"></div>
      <div class="bg-white p-6 rounded-lg shadow-xl z-10 w-full max-w-md">
        <div class="text-center">
          <h3 class="text-lg font-medium mb-4">{{ t('payment.scanToPay') }}</h3>
          
          <!-- 订单金额 -->
          <div class="mb-4 p-4 bg-gray-50 rounded-lg">
            <!-- CNY金额 -->
            <div class="mb-3">
              <div class="text-sm text-gray-600">{{ t('order.amount') }}</div>
              <div class="text-2xl font-bold text-blue-600">{{ t('common.currency') }}{{ totalAmount.toFixed(2) }}</div>
            </div>
            <!-- USDT金额 -->
            <div class="pt-3 border-t border-gray-200">
              <div class="text-sm text-gray-600">{{ t('payment.usdtAmount') }}</div>
              <div class="text-xl font-semibold text-green-600">{{ usdtAmount }} USDT</div>
            </div>
          </div>
          
          <!-- 二维码 -->
          <div class="mb-6 p-4 bg-gray-50 rounded-lg">
            <div class="w-48 h-48 mx-auto bg-white rounded-lg flex items-center justify-center border-2 border-dashed border-gray-300">
              <!-- 支付二维码图片 -->
              <div v-if="paymentQRCode" class="w-full h-full flex items-center justify-center">
                <img 
                  :src="getImageUrl(paymentQRCode)" 
                  :alt="t('payment.qrCode')" 
                  class="max-w-full max-h-full object-contain rounded-lg"
                  @error="handleQRCodeError"
                />
              </div>
              <!-- 默认显示 -->
              <div v-else class="text-center">
                <div class="text-6xl mb-2">📱</div>
                <div class="text-sm text-gray-500">{{ t('payment.scanToPay') }}</div>
                <div class="text-xs text-gray-400 mt-1">{{ t('payment.supportedMethods') }}</div>
              </div>
            </div>
            <!-- 保存二维码提示 -->
            <div v-if="paymentQRCode" class="mt-2 text-center">
              <div class="text-xs text-gray-500 bg-blue-50 px-3 py-2 rounded-md border border-blue-100">
                💡 {{ t('payment.qrCodeSaveTip') }}
              </div>
            </div>
          </div>
          
          <!-- 支付说明 -->
          <div class="mb-6 text-sm text-gray-600">
            <p>{{ t('payment.scanInstruction') }}</p>
            <p class="mt-1">{{ t('payment.rightClickToSave') }}</p>
            <p class="mt-1">{{ t('payment.confirmAfterPayment') }}</p>
          </div>
          
          <!-- 按钮组 -->
          <div class="flex space-x-3">
            <button
              @click="showPaymentModal = false"
              class="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              {{ t('payment.cancel') }}
            </button>
            <button
              @click="completeOnlinePayment"
              :disabled="submitting"
              class="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {{ submitting ? t('common.submitting') : t('payment.complete') }}
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
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useCartStore } from '../../stores/cart.js'
import { useUserStore } from '../../stores/user.js'
import { createOrder } from '../../api/orders.js'
import { getAddresses } from '../../api/addresses.js'
import api from '../../api/index.js'
import config from '../../../config/index.js'

// 格式化地址显示
const formatAddress = (address) => {
  const parts = []
  
  // 只添加非空的省市区信息
  if (address.province && address.province.trim()) {
    parts.push(address.province.trim())
  }
  if (address.city && address.city.trim()) {
    parts.push(address.city.trim())
  }
  if (address.district && address.district.trim()) {
    parts.push(address.district.trim())
  }
  
  // 组合省市区，用空格分隔
  let regionPart = parts.join(' ')
  
  // 添加详细地址
  if (address.detail_address && address.detail_address.trim()) {
    if (regionPart) {
      return `${regionPart} ${address.detail_address.trim()}`
    } else {
      return address.detail_address.trim()
    }
  }
  
  return regionPart || '地址信息不完整'
}
import {
  ArrowLeftIcon,
  ShoppingBagIcon,
  MapPinIcon,
  CheckCircleIcon,
  ExclamationCircleIcon
} from '@heroicons/vue/24/outline'
import getCurrentLanguageValue from '../../utils/language.js'
import CountrySelector from '../../components/CountrySelector.vue'
import ThailandAddressSelector from '../../components/ThailandAddressSelector.vue'
import { validatePhoneI18n } from '../../utils/phoneValidation.js'

// 国际化
const { t } = useI18n()

const router = useRouter()
const cartStore = useCartStore()
const userStore = useUserStore()

// 响应式数据
const loading = ref(true)
const submitting = ref(false)
const loadingAddresses = ref(false)
const showPaymentModal = ref(false)
const paymentQRCode = ref(null)
const exchangeRate = ref(1.00) // 汇算比例，默认1.00

// 地址数据
const addresses = ref([])
const selectedAddress = ref(null)

// 默认图片
const defaultImage = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik02MCA2MEgxNDBWMTQwSDYwVjYwWiIgc3Ryb2tlPSIjOUI5QkEwIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiLz4KPGNpcmNsZSBjeD0iODAiIGN5PSI4MCIgcj0iMTAiIGZpbGw9IiM5QjlCQTAiLz4KPHBhdGggZD0iTTkwIDEwMEwxMjAgNzBMMTMwIDgwTDEyMCAxMDBMOTAgMTAwWiIgZmlsbD0iIzlCOUJBMCIvPgo8L3N2Zz4K'

// 订单表单
const orderForm = reactive({
  contact_name: '',
  contact_country_code: '+86',
  contact_phone: '',
  province: '',
  city: '',
  district: '',
  postal_code: '',
  detail_address: '',
  address_type: 'home',
  delivery_address: '', // 用于向后兼容，会自动组合生成
  payment_method: 'cod', // cod: 货到付款, online: 在线付款
  notes: '',
  referral_code: '' // 推荐码（可选）
})

// 结算页面三级联动地址选择器数据
const checkoutAddressRegion = ref({
  province: null,
  district: null,
  subDistrict: null,
  postalCode: ''
})

// 超过2件禁用货到付款
const codDisabled = computed(() => cartStore.itemCount > 2)

// 表单验证错误
const errors = reactive({
  contact_name: '',
  contact_phone: '',
  province: '',
  city: '',
  district: '',
  detail_address: ''
})

// 消息提示
const message = reactive({
  show: false,
  type: 'success',
  text: ''
})

// 计算订单总金额
const totalAmount = computed(() => {
  return cartStore.totalAmount
})

// 计算USDT金额
const usdtAmount = computed(() => {
  return (totalAmount.value * exchangeRate.value).toFixed(2)
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

// 获取完整的图片URL - 使用配置管理器
const getImageUrl = (imagePath) => {
  return config.buildStaticUrl(imagePath)
}

// 加载系统配置
const loadSystemConfig = async () => {
  try {
    const response = await fetch(config.buildApiUrl('/api/system-config/public'))
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        paymentQRCode.value = data.data.payment_qrcode
        exchangeRate.value = parseFloat(data.data.exchange_rate || '1.00')
      }
    }
  } catch (error) {
    console.warn('加载系统配置失败:', error)
    // 静默失败，不影响主要功能
  }
}

// 加载用户地址（仅登录用户）
const loadAddresses = async () => {
  if (!userStore.isLoggedIn) {
    loadingAddresses.value = false
    return
  }
  
  try {
    loadingAddresses.value = true
    const response = await getAddresses()
    if (response.data.success) {
      addresses.value = response.data.data || []
      
      // 自动选择默认地址
      const defaultAddress = addresses.value.find(addr => addr.is_default)
      if (defaultAddress) {
        selectedAddress.value = defaultAddress
        // 自动填充表单
        orderForm.contact_name = defaultAddress.contact_name
        orderForm.contact_phone = defaultAddress.contact_phone
        orderForm.delivery_address = `${defaultAddress.province} ${defaultAddress.city} ${defaultAddress.district} ${defaultAddress.detail_address}`.trim()
      }
    } else {
      addresses.value = []
    }
  } catch (error) {
    console.error('加载地址失败:', error)
    addresses.value = []
  } finally {
    loadingAddresses.value = false
  }
}

// 处理订单国家变更
const handleOrderCountryChange = (country) => {
  // 当国家变更时，清空手机号以避免格式错误
  orderForm.contact_phone = ''
}

// 处理结算页面地址区域选择变化
const handleCheckoutAddressRegionChange = (regionData) => {
  // 更新表单中的省市区和邮编信息
  if (regionData.provinceData) {
    orderForm.province = regionData.provinceData.name
  } else {
    orderForm.province = ''
  }
  
  if (regionData.districtData) {
    orderForm.city = regionData.districtData.name
  } else {
    orderForm.city = ''
  }
  
  if (regionData.subDistrictData) {
    orderForm.district = regionData.subDistrictData.name
  } else {
    orderForm.district = ''
  }
  
  if (regionData.postalCode) {
    orderForm.postal_code = regionData.postalCode
  } else {
    orderForm.postal_code = ''
  }
  
  // 清除相关错误信息
  errors.province = ''
  errors.city = ''
  errors.district = ''
}

// 选择地址
const selectAddress = (address) => {
  selectedAddress.value = address
  orderForm.contact_name = address.contact_name
  orderForm.contact_country_code = address.contact_country_code || '+86'
  orderForm.contact_phone = address.contact_phone
  orderForm.delivery_address = `${address.province} ${address.city} ${address.district} ${address.detail_address}`.trim()
}

// 去添加地址
const goToAddAddress = () => {
  router.push('/profile?tab=addresses')
}

// 验证表单
const validateForm = () => {
  // 清空之前的错误
  Object.keys(errors).forEach(key => {
    errors[key] = ''
  })

  let isValid = true

  // 验证联系人
  if (!orderForm.contact_name.trim()) {
    errors.contact_name = t('validation.contactNameRequired')
    isValid = false
  }

  // 验证联系电话
  if (!orderForm.contact_phone.trim()) {
    errors.contact_phone = t('validation.contactPhoneRequired')
    isValid = false
  } else {
    const phoneValidation = validatePhoneI18n(orderForm.contact_phone.trim(), orderForm.contact_country_code, t)
    if (!phoneValidation.isValid) {
      errors.contact_phone = phoneValidation.message
      isValid = false
    }
  }

  // 验证省份
  if (!orderForm.province.trim()) {
    errors.province = t('validation.provinceRequired')
    isValid = false
  }

  // 验证城市
  if (!orderForm.city.trim()) {
    errors.city = t('validation.cityRequired')
    isValid = false
  }

  // 验证区县
  if (!orderForm.district.trim()) {
    errors.district = t('validation.districtRequired')
    isValid = false
  }

  // 验证详细地址
  if (!orderForm.detail_address.trim()) {
    errors.detail_address = t('validation.detailAddressRequired')
    isValid = false
  }

  return isValid
}

// 提交订单
const handleSubmitOrder = async () => {
  if (submitting.value) return

  // 登录用户必须选择地址
  if (userStore.isLoggedIn && !selectedAddress.value) {
    showMessage(t('address.pleaseAddFirst'), 'error')
    return
  }

  // 验证表单（仅对游客进行表单验证）
  if (!userStore.isLoggedIn && !validateForm()) {
    showMessage(t('order.pleaseCompleteShippingInfo'), 'error')
    return
  }

  // 检查购物车是否为空
  if (cartStore.isEmpty) {
    showMessage(t('cart.emptyCannotSubmit'), 'error')
    return
  }

  // 游客下单：检查手机号是否已注册
  if (!userStore.isLoggedIn) {
    try {
      const response = await api.get(`/users/check-phone/${orderForm.contact_phone}`)
      if (response.data.success && response.data.data.exists) {
        showMessage(t('user.phoneRegisteredLoginFirst'), 'error')
        // 可以选择跳转到登录页面
        setTimeout(() => {
          router.push('/login')
        }, 2000)
        return
      }
    } catch (error) {
      console.error('检查手机号失败:', error)
      // 如果检查失败，允许继续下单（可能是网络问题）
      console.warn('手机号检查失败，允许继续下单')
    }
  }

  // 如果选择在线付款，显示支付二维码
  if (orderForm.payment_method === 'online') {
    showPaymentModal.value = true
    return
  }

  // 货到付款直接提交订单
  await submitOrder()
}

// 实际提交订单
const submitOrder = async () => {
  submitting.value = true

  try {
    // 准备订单数据
    const orderData = {
      items: cartStore.items.map(item => ({
        product_id: item.product_id,
        quantity: item.quantity
      })),
      contact_name: orderForm.contact_name.trim(),
      contact_phone: `${orderForm.contact_country_code}${orderForm.contact_phone.trim()}`,
      delivery_address: userStore.isLoggedIn 
        ? orderForm.delivery_address.trim() // 登录用户使用已选择的地址
        : `${orderForm.province.trim()} ${orderForm.city.trim()} ${orderForm.district ? orderForm.district.trim() : ''} ${orderForm.detail_address.trim()}`.trim(), // 游客组合地址，用空格分隔
      payment_method: orderForm.payment_method,
      notes: orderForm.notes.trim(),
      clear_cart: true, // 提交订单后清空购物车
      // 为非登录用户传递省市区信息
      ...(userStore.isLoggedIn ? {} : {
        province: orderForm.province.trim(),
        city: orderForm.city.trim(),
        district: orderForm.district ? orderForm.district.trim() : '',
        detail_address: orderForm.detail_address.trim()
      }),
      // 传递推荐码
      referral_code: orderForm.referral_code ? orderForm.referral_code.trim() : ''
    }


    // 调用API创建订单
    const response = await createOrder(orderData)

    if (response.data.success) {
      showMessage(t('order.submitSuccess'), 'success')
      
      // 清空购物车状态
      await cartStore.loadCart()
      
      // 检查是否是游客下单且后端已自动注册
      if (response.data.data.autoRegistered && response.data.data.user && response.data.data.token) {
        // 后端已自动注册，直接登录
        userStore.setAuth(response.data.data.user, response.data.data.token)
        
        // 生成密码提示
        const phone = response.data.data.user.phone
        const password = phone.slice(-8)
        showMessage(t('user.accountCreatedPassword', { password }), 'success')
        
        // 延迟跳转到个人中心
        setTimeout(() => {
          router.push('/profile?tab=orders')
        }, 5000)
      } else if (!userStore.isLoggedIn) {
        // 如果后端没有自动注册，执行前端注册逻辑（备用方案）
        await autoRegisterAndLogin()
      } else {
        // 已登录用户直接跳转到订单页面
        setTimeout(() => {
          router.push('/profile?tab=orders')
        }, 2000)
      }
    } else {
      showMessage(response.data.message || t('order.submitFailed'), 'error')
    }

  } catch (error) {
    console.error('提交订单失败:', error)
    const errorMessage = error.response?.data?.message || t('order.submitFailedRetry')
    showMessage(errorMessage, 'error')
  } finally {
    submitting.value = false
  }
}

// 完成在线付款
const completeOnlinePayment = async () => {
  showPaymentModal.value = false
  await submitOrder()
}

// 处理二维码加载错误
const handleQRCodeError = (event) => {
  console.warn('支付二维码加载失败，显示默认内容')
  paymentQRCode.value = null
}

// 自动注册并登录
const autoRegisterAndLogin = async () => {
  try {
    showMessage(t('user.creatingAccount'), 'success')
    
    // 使用手机号后8位作为密码
    const phone = orderForm.contact_phone.trim()
    const password = phone.slice(-8) // 取手机号后8位
    
    // 准备注册数据
    const registerData = {
      country_code: orderForm.contact_country_code,
      phone: phone,
      password: password,
      nickname: orderForm.contact_name.trim(),
      auto_register: true, // 标识这是自动注册
      referral_code: orderForm.referral_code && orderForm.referral_code.trim() ? orderForm.referral_code.trim() : undefined
    }
    
    // 调用注册API
    const registerResponse = await api.post('/auth/register', registerData)
    
    if (registerResponse.data.success) {
      // 注册成功，自动登录
      const loginResponse = await api.post('/auth/login', {
        country_code: orderForm.contact_country_code,
        phone: phone,
        password: password
      })
      
      if (loginResponse.data.success) {
        // 更新用户状态
        userStore.setAuth(loginResponse.data.data.user, loginResponse.data.data.token)
        
        showMessage(t('user.accountCreatedPassword', { password }), 'success')
        
        // 延迟跳转到个人中心
        setTimeout(() => {
          router.push('/profile?tab=orders')
        }, 5000) // 给用户更多时间看到密码
      } else {
        showMessage(t('user.accountCreatedLoginFailed'), 'error')
        setTimeout(() => {
          router.push('/login')
        }, 3000)
      }
    } else {
      showMessage(registerResponse.data.message || t('user.accountCreateFailed'), 'error')
      // 即使注册失败，订单已经成功，跳转到首页
      setTimeout(() => {
        router.push('/')
      }, 3000)
    }
  } catch (error) {
    console.error('自动注册失败:', error)
    showMessage(t('user.accountCreateFailedButOrderSuccess'), 'error')
    // 跳转到首页
    setTimeout(() => {
      router.push('/')
    }, 3000)
  }
}



// 返回上一页
const goBack = () => {
  router.go(-1)
}

// 页面初始化
onMounted(async () => {
  try {
    // 并行加载购物车数据、地址数据和系统配置
    await Promise.all([
      cartStore.loadCart(),
      loadAddresses(),
      loadSystemConfig()
    ])
    if (codDisabled.value && orderForm.payment_method === 'cod') {
      orderForm.payment_method = 'online'
    }
    
    // 如果购物车为空，跳转到购物车页面
    if (cartStore.isEmpty) {
      showMessage(t('cart.emptyCannotSubmit'), 'error')
      setTimeout(() => {
        router.push('/cart')
      }, 2000)
      return
    }

  } catch (error) {
    console.error('加载页面数据失败:', error)
    showMessage(t('common.loadFailed'), 'error')
  } finally {
    loading.value = false
  }
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