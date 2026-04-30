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
                    {{ t('cart.price') }}: {{ portalCurrency.formatThb(item.price) }} × {{ item.quantity }}
                  </div>
                </div>

                <!-- 小计 -->
                <div class="text-right">
                  <span class="text-sm sm:text-base font-bold text-gray-900">
                    {{ portalCurrency.formatThb(item.price * item.quantity) }}
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
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-4 sm:items-start">
                <!-- 联系人 -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {{ t('order.contactName') || '联系人' }} <span class="text-red-500">*</span>
                  </label>
                  <input
                    v-model="orderForm.contact_name"
                    type="text"
                    class="block w-full h-10 px-3 border border-gray-300 rounded-md text-sm leading-5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    :class="{ 'border-red-500': errors.contact_name }"
                    :placeholder="t('order.contactNamePlaceholder')"
                  />
                  <p v-if="errors.contact_name" class="text-red-500 text-xs mt-1">
                    {{ errors.contact_name }}
                  </p>
                </div>

                <!-- 联系电话 -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">
                    {{ t('order.contactPhone') || '联系电话' }} <span class="text-red-500">*</span>
                  </label>
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
                    <div class="w-full shrink-0 sm:w-[7rem]">
                      <CountrySelector
                        v-model="orderForm.contact_country_code"
                        :placeholder="t('common.selectCountry')"
                        @country-change="handleOrderCountryChange"
                      />
                    </div>
                    <div class="min-w-0 flex-1 flex flex-col justify-start">
                      <input
                        v-model="orderForm.contact_phone"
                        type="tel"
                        class="block w-full h-10 px-3 border border-gray-300 rounded-md text-sm leading-5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        :class="{ 'border-red-500': errors.contact_phone }"
                        :placeholder="`请输入手机号`"
                      />
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
                  class="block w-full h-10 px-3 border border-gray-300 rounded-md text-sm leading-5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
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

              <label
                v-if="showPointsRedeemCard"
                class="flex items-center p-3 border rounded-lg transition-colors select-none"
                :class="[
                  pointsOptionDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50',
                  orderForm.payment_method === 'points' && !pointsOptionDisabled ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                ]"
                @click="!pointsOptionDisabled && (orderForm.payment_method = 'points')"
              >
                <input
                  v-model="orderForm.payment_method"
                  type="radio"
                  value="points"
                  :disabled="pointsOptionDisabled"
                  class="mr-3 text-blue-600"
                />
                <div class="flex-1">
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span class="text-2xl">⭐</span>
                    <span class="font-medium">{{ t('payment.pointsRedeem') }}</span>
                    <span
                      v-if="userStore.isLoggedIn && pointsBalanceReady"
                      class="text-sm text-amber-900 tabular-nums"
                    >
                      {{ t('payment.pointsBalanceLabel', { balance: pointsBalance }) }}
                    </span>
                  </div>
                  <p class="text-sm text-gray-500 mt-1">{{ t('payment.pointsRedeemDesc') }}</p>
                  <p
                    v-if="cartSupportsPointsPayment"
                    class="text-sm text-gray-700 mt-1 tabular-nums"
                  >
                    {{ t('payment.pointsOrderNeed', { need: orderPointsNeeded }) }}
                  </p>
                  <p v-if="pointsMixedCartBlocked" class="text-xs text-amber-800 mt-1">
                    {{ t('payment.pointsMixedCartHint') }}
                  </p>
                  <p v-if="pointsInsufficientNotice" class="text-xs text-red-500 mt-1">
                    {{ pointsInsufficientNotice }}
                  </p>
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
                <span class="text-sm font-medium">{{ portalCurrency.formatThb(cartStore.totalAmount.toFixed(2)) }}</span>
              </div>

              <!-- 运费 -->
              <div class="flex justify-between">
                <span class="text-sm text-gray-600">{{ t('order.shippingFee') }}</span>
                <span class="text-sm font-medium">{{ t('common.free') }}</span>
              </div>

              <template v-if="orderForm.payment_method === 'points' && cartSupportsPointsPayment">
                <div class="text-sm text-amber-900 whitespace-nowrap overflow-x-auto">
                  {{ t('payment.pointsOrderNeed', { need: orderPointsNeeded }) }}
                </div>
              </template>

              <div class="border-t pt-3">
                <!-- 积分支付：金额与标题同一行，说明单独一行，避免窄侧栏把「订单总计」等拆字 -->
                <template v-if="orderForm.payment_method === 'points' && cartSupportsPointsPayment">
                  <div class="flex flex-nowrap justify-between gap-3 items-baseline">
                    <span class="text-lg font-semibold text-gray-900 shrink-0 whitespace-nowrap">{{ t('order.total') }}</span>
                    <span class="text-xl font-bold text-amber-900 whitespace-nowrap tabular-nums shrink-0">{{ portalCurrency.formatThb('0.00') }}</span>
                  </div>
                  <p class="text-xs text-gray-600 mt-1.5 text-right leading-relaxed">
                    {{ t('payment.pointsPaySummary', { need: orderPointsNeeded }) }}
                  </p>
                </template>
                <div v-else class="flex flex-nowrap justify-between gap-3 items-center">
                  <span class="text-lg font-semibold text-gray-900 shrink-0 whitespace-nowrap">{{ t('order.total') }}</span>
                  <span class="text-xl font-bold text-blue-600 whitespace-nowrap tabular-nums shrink-0">{{ portalCurrency.formatThb(totalAmount.toFixed(2)) }}</span>
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
      <div class="fixed inset-0 bg-black bg-opacity-50" @click="cancelOnlinePayment"></div>
      <div class="bg-white p-6 rounded-lg shadow-xl z-10 w-full max-w-md">
        <div class="text-center">
          <h3 class="text-lg font-medium mb-4">{{ t('payment.scanToPay') }}</h3>
          
          <!-- 订单金额 -->
          <div class="mb-4 p-4 bg-gray-50 rounded-lg">
            <!-- CNY金额 -->
            <div class="mb-3">
              <div class="text-sm text-gray-600">{{ t('order.amount') }}</div>
              <div class="text-2xl font-bold text-blue-600">{{ portalCurrency.formatThb(paymentModalThbDisplay) }}</div>
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
              type="button"
              :disabled="confirmingOnlinePayment"
              @click="cancelOnlinePayment"
              class="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {{ t('payment.cancel') }}
            </button>
            <button
              type="button"
              @click="completeOnlinePayment"
              :disabled="confirmingOnlinePayment"
              class="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {{ confirmingOnlinePayment ? t('common.submitting') : t('payment.complete') }}
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
import { ref, reactive, computed, onMounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useCartStore } from '../../stores/cart.js'
import { useUserStore } from '../../stores/user.js'
import { usePortalCurrencyStore } from '../../stores/portalCurrency.js'
import { createOrder, confirmOnlinePayment as confirmOnlinePaymentApi } from '../../api/orders.js'
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
const portalCurrency = usePortalCurrencyStore()

const pointsBalance = ref(0)
const pointsBalanceReady = ref(false)
const loading = ref(true)
const submitting = ref(false)
const loadingAddresses = ref(false)
const showPaymentModal = ref(false)
const paymentQRCode = ref(null)
const exchangeRate = ref(0) // USD/USDT 汇算比例，与后台 exchange_rates.USD 一致
const pendingOnlinePaymentOrderId = ref(null)
const pendingOnlinePaymentThb = ref(null)
const confirmingOnlinePayment = ref(false)

// 地址数据
const addresses = ref([])
const selectedAddress = ref(null)

// 默认图片
const defaultImage = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik02MCA2MEgxNDBWMTQwSDYwVjYwWiIgc3Ryb2tlPSIjOUI5QkEwIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiLz4KPGNpcmNsZSBjeD0iODAiIGN5PSI4MCIgcj0iMTAiIGZpbGw9IiM5QjlCQTAiLz4KPHBhdGggZD0iTTkwIDEwMEwxMjAgNzBMMTMwIDgwTDEyMCAxMDBMOTAgMTAwWiIgZmlsbD0iIzlCOUJBMCIvPgo8L3N2Zz4K'

// 订单表单
const orderForm = reactive({
  contact_name: '',
  contact_country_code: '+66',
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

const cartSupportsPointsPayment = computed(() =>
  userStore.isLoggedIn &&
  cartStore.items.length > 0 &&
  cartStore.items.every(it => Number(it.product?.points || 0) > 0)
)

/** 购物车中至少有一款「可积分兑换」商品（用于在非纯积分车时也展示卡片） */
const cartHasPointsProduct = computed(() =>
  cartStore.items.some(it => Number(it.product?.points || 0) > 0)
)

/** 登录且车里有可积分商品时展示积分换购车；全部为现金商品则不展示 */
const showPointsRedeemCard = computed(() =>
  userStore.isLoggedIn && cartStore.items.length > 0 && cartHasPointsProduct.value
)

/** 混入非积分商品时不可选，仅展示说明 */
const pointsMixedCartBlocked = computed(() =>
  cartHasPointsProduct.value && !cartSupportsPointsPayment.value
)

const orderPointsNeeded = computed(() =>
  cartStore.items.reduce(
    (s, item) => s + Number(item.product?.points || 0) * Number(item.quantity || 0),
    0
  )
)

const pointsInsufficientNotice = computed(() => {
  if (!cartSupportsPointsPayment.value || !pointsBalanceReady.value) return ''
  if (orderPointsNeeded.value <= 0) return ''
  if (pointsBalance.value >= orderPointsNeeded.value) return ''
  return t('payment.pointsInsufficient', {
    balance: pointsBalance.value,
    need: orderPointsNeeded.value
  })
})

const pointsOptionDisabled = computed(() =>
  !cartSupportsPointsPayment.value ||
  orderPointsNeeded.value <= 0 ||
  !!pointsInsufficientNotice.value
)

watch(
  [cartSupportsPointsPayment, pointsOptionDisabled, codDisabled],
  () => {
    if (orderForm.payment_method === 'points' && pointsOptionDisabled.value) {
      orderForm.payment_method = codDisabled.value ? 'online' : 'cod'
    }
  }
)

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

const paymentModalThb = computed(() => {
  const p = pendingOnlinePaymentThb.value
  if (p != null && Number.isFinite(p)) return p
  return totalAmount.value
})

const paymentModalThbDisplay = computed(() =>
  Number.isFinite(Number(paymentModalThb.value)) ? Number(paymentModalThb.value).toFixed(2) : '0.00'
)

// 计算USDT金额（支付弹窗以内用订单底价 THB；未建单前兜底购物车合计）
const usdtAmount = computed(() => {
  return (paymentModalThb.value * exchangeRate.value).toFixed(2)
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
        exchangeRate.value = parseFloat(data.data.exchange_rate || '0.00')
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
        orderForm.delivery_address = `${defaultAddress.province} ${defaultAddress.city} ${defaultAddress.district} ${defaultAddress.detail_address} ${defaultAddress.postal_code || ''}`.trim()
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

const loadPointsBalance = async () => {
  pointsBalanceReady.value = false
  if (!userStore.isLoggedIn) {
    pointsBalance.value = 0
    pointsBalanceReady.value = true
    return
  }
  try {
    const res = await api.get('/users/points/balance')
    pointsBalance.value = res.data?.success ? (Number(res.data.data?.balance) || 0) : 0
  } catch (_e) {
    pointsBalance.value = 0
  } finally {
    pointsBalanceReady.value = true
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
  orderForm.contact_country_code = address.contact_country_code || '+66'
  orderForm.contact_phone = address.contact_phone
  orderForm.delivery_address = `${address.province} ${address.city} ${address.district} ${address.detail_address} ${address.postal_code || ''}`.trim()
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

  // 积分换购：直接提交订单（金额记为 0，后端扣积分）
  if (orderForm.payment_method === 'points') {
    if (pointsOptionDisabled.value) {
      showMessage(t('payment.pointsSubmitBlocked'), 'error')
      return
    }
    await submitOrder()
    return
  }

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
        : `${orderForm.province.trim()} ${orderForm.city.trim()} ${orderForm.district ? orderForm.district.trim() : ''} ${orderForm.detail_address.trim()} ${orderForm.postal_code ? orderForm.postal_code.trim() : ''}`.trim(), // 游客组合地址（包含邮编）
      payment_method: orderForm.payment_method,
      notes: orderForm.notes.trim(),
      clear_cart: true, // 提交订单后清空购物车
      // 登录用户传递地址ID，游客用户传递省市区信息
      ...(userStore.isLoggedIn ? {
        address_id: selectedAddress.value?.id // 传递选中的地址ID
      } : {
        province: orderForm.province.trim(),
        city: orderForm.city.trim(),
        district: orderForm.district ? orderForm.district.trim() : '',
        detail_address: orderForm.detail_address.trim(),
        postal_code: orderForm.postal_code ? orderForm.postal_code.trim() : ''
      }),
      // 传递推荐码
      referral_code: orderForm.referral_code && orderForm.referral_code.trim() ? orderForm.referral_code.trim() : null,
      checkout_currency: portalCurrency.selectedCode
    }


    // 调用API创建订单
    const response = await createOrder(orderData)

    if (response.data.success) {
      await cartStore.loadCart()
      const payload = response.data.data || {}

      if (orderForm.payment_method === 'online') {
        const ord = payload.order
        if (!ord?.id) {
          showMessage(t('order.submitFailed'), 'error')
          return
        }
        if (payload.autoRegistered && payload.user && payload.token) {
          userStore.setAuth(payload.user, payload.token)
          const phone = payload.user.phone
          const password = phone.slice(-8)
          showMessage(t('user.accountCreatedPassword', { password }), 'success')
        }
        pendingOnlinePaymentOrderId.value = ord.id
        pendingOnlinePaymentThb.value = parseFloat(ord.total_amount_thb)
        if (!Number.isFinite(pendingOnlinePaymentThb.value)) pendingOnlinePaymentThb.value = 0
        await loadSystemConfig()
        showMessage(t('order.onlinePayCreated'), 'success')
        showPaymentModal.value = true
        return
      }

      showMessage(t('order.submitSuccess'), 'success')
      if (payload.autoRegistered && payload.user && payload.token) {
        userStore.setAuth(payload.user, payload.token)
        const phone = payload.user.phone
        const password = phone.slice(-8)
        showMessage(t('user.accountCreatedPassword', { password }), 'success')
        await nextTick()
        setTimeout(() => {
          router.push({ path: '/profile', query: { tab: 'orders' } })
        }, 500)
      } else if (!userStore.isLoggedIn) {
        showMessage('自动注册失败，请手动注册后再下单', 'error')
        setTimeout(() => {
          router.push('/register')
        }, 2000)
      } else {
        await nextTick()
        await router.push({ path: '/profile', query: { tab: 'orders' } })
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

// 完成在线付款（仅确认已创建的待支付订单）
const completeOnlinePayment = async () => {
  const id = pendingOnlinePaymentOrderId.value
  if (!id) {
    showPaymentModal.value = false
    return
  }
  confirmingOnlinePayment.value = true
  try {
    const response = await confirmOnlinePaymentApi(id)
    if (!response.data?.success) {
      showMessage(response.data?.message || t('order.submitFailed'), 'error')
      return
    }
    showPaymentModal.value = false
    pendingOnlinePaymentOrderId.value = null
    pendingOnlinePaymentThb.value = null
    showMessage(t('order.payConfirmOk'), 'success')
    await nextTick()
    await router.push({ path: '/profile', query: { tab: 'orders' } })
  } catch (error) {
    console.error(error)
    showMessage(error.response?.data?.message || t('order.submitFailedRetry'), 'error')
  } finally {
    confirmingOnlinePayment.value = false
  }
}

const cancelOnlinePayment = () => {
  if (confirmingOnlinePayment.value) return
  showPaymentModal.value = false
  pendingOnlinePaymentOrderId.value = null
  pendingOnlinePaymentThb.value = null
  router.push({ path: '/profile', query: { tab: 'orders' } })
}

// 处理二维码加载错误
const handleQRCodeError = (event) => {
  console.warn('支付二维码加载失败，显示默认内容')
  paymentQRCode.value = null
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
      loadSystemConfig(),
      loadPointsBalance()
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