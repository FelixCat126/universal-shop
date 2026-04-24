<template>
  <div class="min-h-screen bg-gray-50 p-4 sm:p-8">
    <div class="max-w-6xl mx-auto">
      <!-- 返回按钮 -->
      <div class="mb-6">
        <button 
          @click="router.go(-1)" 
          class="flex items-center text-gray-600 hover:text-gray-900"
        >
          ← {{ t('common.back') }}
        </button>
      </div>

      <h1 class="text-2xl font-bold mb-8">{{ t('nav.profile') }}</h1>

      <!-- 用户信息卡片 -->
      <div class="bg-white rounded-lg shadow p-6 mb-8">
        <div class="flex items-center space-x-4">
          <div class="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-2xl shrink-0 overflow-hidden ring-2 ring-gray-100">
            <img v-if="avatarDisplayUrl" :src="avatarDisplayUrl" alt="" class="w-full h-full object-cover" />
            <span v-else>👤</span>
          </div>
          <div class="flex-1">
            <p class="text-lg font-semibold text-gray-900">{{ displayNickname }}</p>
            <p class="text-sm text-gray-600">📱 {{ userStore.user?.phone || t('profile.phoneNotSet') }}</p>
            <p class="text-xs text-gray-400">📅 {{ t('profile.registerTime') }}: {{ formatDate(userStore.user?.created_at) }}</p>
          </div>
        </div>
      </div>

      <!-- 统计卡片 -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div class="bg-white p-6 rounded-lg shadow">
          <div class="flex items-center">
            <div class="h-8 w-8 text-green-600 flex items-center justify-center text-2xl">✅</div>
            <div class="ml-4">
              <p class="text-2xl font-semibold text-gray-900">{{ orderStats.total }}</p>
              <p class="text-sm text-gray-600">{{ t('profile.completedOrders') }}</p>
            </div>
          </div>
        </div>
        <div class="bg-white p-6 rounded-lg shadow">
          <div class="flex items-center">
            <div class="h-8 w-8 text-blue-600 flex items-center justify-center text-2xl">📍</div>
            <div class="ml-4">
              <p class="text-2xl font-semibold text-gray-900">{{ addresses.length }}</p>
              <p class="text-sm text-gray-600">{{ t('profile.shippingAddresses') }}</p>
            </div>
          </div>
        </div>
        <div class="bg-white p-6 rounded-lg shadow">
          <div class="flex items-center">
            <div class="h-8 w-8 text-purple-600 flex items-center justify-center text-2xl">💰</div>
            <div class="ml-4">
              <p class="text-2xl font-semibold text-gray-900">{{ t('common.currency') }}{{ orders.length > 0 ? orders.reduce((sum, order) => sum + parseFloat(order.total_amount || 0), 0).toFixed(2) : '0.00' }}</p>
              <p class="text-sm text-gray-600">{{ t('profile.totalSpent') }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 标签导航 -->
      <div class="bg-white rounded-lg shadow">
        <div class="border-b border-gray-200">
          <nav class="flex space-x-8 px-6">
            <button 
              @click="activeTab = 'orders'" 
              :class="[
                'py-4 px-1 border-b-2 font-medium text-sm flex items-center',
                activeTab === 'orders' 
                  ? 'border-blue-500 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              ]"
            >
              <span class="inline-block w-5 h-5 mr-2 text-center">🛍️</span>
              {{ t('profile.myOrders') }}
            </button>
            <button 
              @click="activeTab = 'addresses'" 
              :class="[
                'py-4 px-1 border-b-2 font-medium text-sm flex items-center',
                activeTab === 'addresses' 
                  ? 'border-blue-500 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              ]"
            >
              <span class="inline-block w-5 h-5 mr-2 text-center">📍</span>
              {{ t('profile.shippingAddresses') }}
            </button>
            <button 
              @click="activeTab = 'profile'" 
              :class="[
                'py-4 px-1 border-b-2 font-medium text-sm flex items-center',
                activeTab === 'profile' 
                  ? 'border-blue-500 text-blue-600' 
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              ]"
            >
              <span class="inline-block w-5 h-5 mr-2 text-center">👤</span>
              {{ t('user.profile') }}
            </button>
          </nav>
        </div>

        <!-- 标签内容区域 -->
        <div class="p-6">
          <div v-if="activeTab === 'orders'">
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-lg font-medium text-gray-900">{{ t('profile.myOrders') }}</h3>
              <div class="flex space-x-2">
                <span class="px-3 py-1 text-sm text-gray-600 bg-gray-100 rounded">{{ t('profile.allOrders') }}</span>
              </div>
            </div>

            <div v-if="loadingOrders" class="text-center py-8">
              <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <p class="mt-2 text-sm text-gray-500">{{ t('profile.loadingOrders') }}</p>
            </div>

            <div v-else-if="orders.length > 0" class="space-y-4">
              <div 
                v-for="order in orders" 
                :key="order.id"
                class="border rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                <div class="flex justify-between items-start mb-2">
                  <div>
                    <div class="font-medium">{{ t('order.orderNo') }}: {{ order.order_no }}</div>
                    <div class="text-sm text-gray-600">{{ formatDateTime(order.created_at) }}</div>
                  </div>
                  <div class="text-right">
                    <div class="font-medium" v-if="order.payment_method === 'online'">
                      <div class="text-blue-600">USDT {{ getExchangedAmount(order.total_amount, order.exchange_rate) }}</div>
                      <div class="text-xs text-gray-500">({{ t('common.currency') }}{{ order.total_amount }})</div>
                    </div>
                    <div class="font-medium" v-else>{{ t('common.currency') }}{{ order.total_amount }}</div>
                    <div :class="['text-sm', getStatusStyle(order.status)]">
                      {{ getStatusText(order.status) }}
                    </div>
                  </div>
                </div>
                <div class="text-sm text-gray-700">
                  {{ order.delivery_address }}
                  <span v-if="order.postal_code" class="ml-1">({{ t('address.postalCode') || '邮编' }}: {{ order.postal_code }})</span>
                </div>
                <div class="flex justify-end mt-2">
                  <button 
                    @click="viewOrderDetail(order.id)"
                    class="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    {{ t('profile.viewDetails') }}
                  </button>
                </div>
              </div>
            </div>

            <div v-else class="text-center py-12">
              <div class="mx-auto h-12 w-12 text-gray-400 flex items-center justify-center text-3xl">🛍️</div>
              <h3 class="mt-2 text-sm font-medium text-gray-900">{{ t('order.noOrders') }}</h3>
              <p class="mt-1 text-sm text-gray-500">{{ t('profile.noOrdersDesc') }}</p>
            </div>
          </div>

          <div v-else-if="activeTab === 'addresses'">
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-lg font-medium text-gray-900">{{ t('profile.shippingAddresses') }}</h3>
              <button 
                @click="handleAddAddress"
                class="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
              >
                {{ t('address.add') }}
              </button>
            </div>

            <div v-if="loadingAddresses" class="text-center py-8">
              <div class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <p class="mt-2 text-sm text-gray-500">{{ t('profile.loadingAddresses') }}</p>
            </div>

            <div v-else-if="addresses.length > 0" class="space-y-4">
              <div 
                v-for="address in addresses" 
                :key="address.id"
                class="border rounded-lg p-4 hover:shadow-md transition-shadow"
                :class="{ 'border-blue-500 bg-blue-50': address.is_default }"
              >
                <div class="flex justify-between items-start">
                  <div class="flex-1">
                    <div class="flex items-center mb-2">
                      <h4 class="font-medium text-gray-900">{{ address.contact_name }}</h4>
                      <span class="ml-2 text-sm text-gray-600">
                        {{ formatPhoneDisplay(address.contact_phone, address.contact_country_code || '+66') }}
                      </span>
                      <span v-if="address.is_default" class="ml-2 px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">{{ t('profile.default') }}</span>
                    </div>
                    <p class="text-sm text-gray-700">
                      {{ formatAddress(address) }}
                    </p>
                                      <p class="text-xs text-gray-500 mt-1">
                    {{ address.address_type === 'home' ? t('order.addressHome') : address.address_type === 'company' ? t('order.addressCompany') : t('order.addressOther') }}
                  </p>
                  </div>
                  <div class="flex flex-col space-y-2 ml-4">
                    <button 
                      @click="editAddress(address)"
                      class="text-xs px-2 py-1 text-blue-600 border border-blue-300 rounded hover:bg-blue-50"
                    >
                      {{ t('common.edit') }}
                    </button>
                    <button 
                      v-if="!address.is_default"
                      @click="setDefaultAddress(address.id)"
                      class="text-xs px-2 py-1 text-green-600 border border-green-300 rounded hover:bg-green-50"
                    >
                      {{ t('profile.setDefault') }}
                    </button>
                    <button 
                      @click="deleteAddress(address.id)"
                      class="text-xs px-2 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50"
                    >
                      {{ t('common.delete') }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="text-center py-12">
              <div class="mx-auto h-12 w-12 text-gray-400 flex items-center justify-center text-3xl">📍</div>
              <h3 class="mt-2 text-sm font-medium text-gray-900">{{ t('address.noAddresses') }}</h3>
              <p class="mt-1 text-sm text-gray-500">{{ t('profile.addAddressHint') }}</p>
              <div class="mt-6">
                <button 
                  @click="handleAddAddress"
                  class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                >
                  {{ t('address.add') }}
                </button>
              </div>
            </div>
          </div>

          <div v-else-if="activeTab === 'profile'" class="bg-white p-6 rounded-lg shadow">
            <h3 class="text-lg font-medium text-gray-900 mb-4">{{ t('user.profile') }}</h3>
            <form @submit.prevent="handleSaveProfile" class="space-y-4 max-w-lg">
              <div class="flex flex-col sm:flex-row sm:items-start gap-4 pb-4 border-b border-gray-100">
                <span class="block text-sm font-medium text-gray-700 sm:pt-2 sm:w-24 shrink-0">{{ t('profile.avatar') }}</span>
                <div class="flex flex-col sm:flex-row items-start gap-4 flex-1 min-w-0">
                  <div class="w-20 h-20 rounded-full overflow-hidden bg-gray-100 ring-2 ring-gray-200 flex items-center justify-center shrink-0">
                    <img v-if="avatarDisplayUrl" :src="avatarDisplayUrl" alt="" class="w-full h-full object-cover" />
                    <span v-else class="text-3xl text-gray-400">👤</span>
                  </div>
                  <div class="flex flex-col gap-2 min-w-0">
                    <input
                      ref="avatarFileInput"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      class="hidden"
                      @change="onAvatarFileChange"
                    />
                    <button
                      type="button"
                      class="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 w-fit"
                      :disabled="avatarUploading"
                      @click="avatarFileInput?.click()"
                    >
                      {{ avatarUploading ? t('profile.avatarUploading') : t('profile.changeAvatar') }}
                    </button>
                    <button
                      v-if="userStore.user?.avatar_url"
                      type="button"
                      class="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 w-fit"
                      :disabled="avatarUploading || profileSaving"
                      @click="removeAvatar"
                    >
                      {{ t('profile.removeAvatar') }}
                    </button>
                    <p class="text-xs text-gray-500 max-w-sm">{{ t('profile.avatarHint') }}</p>
                  </div>
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700">{{ t('user.nickname') }}</label>
                <input 
                  v-model="profileForm.nickname" 
                  type="text" 
                  maxlength="50" 
                  class="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" 
                  :placeholder="t('user.nicknamePlaceholder')" 
                />
                <p v-if="profileErrors.nickname" class="text-xs text-red-600 mt-1">{{ profileErrors.nickname }}</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700">{{ t('user.email') }}（{{ t('common.optional') }}）</label>
                <input 
                  v-model="profileForm.email" 
                  type="email" 
                  class="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" 
                  :placeholder="t('user.emailPlaceholder')" 
                />
                <p v-if="profileErrors.email" class="text-xs text-red-600 mt-1">{{ profileErrors.email }}</p>
              </div>
              <div class="pt-2">
                <button 
                  type="submit" 
                  :disabled="profileSaving"
                  class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {{ profileSaving ? t('profile.saving') : t('common.save') }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>

    <!-- 地址添加/编辑模态框 -->
    <div v-if="showAddressModal" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="fixed inset-0 bg-black bg-opacity-50" @click="showAddressModal = false"></div>
      <div class="bg-white p-6 rounded-lg shadow-xl z-10 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h3 class="text-lg font-medium mb-4">{{ editingAddress ? t('profile.editAddress') : t('address.add') }}</h3>
        
        <form @submit.prevent="saveAddress" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700">{{ t('order.contactName') }} *</label>
            <input
              v-model="addressForm.contact_name"
              type="text"
              required
              class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              :placeholder="t('order.contactNamePlaceholder')"
            />
          </div>

          <!-- 联系人手机号 -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('order.contactPhone') }} *</label>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
              <div class="w-full shrink-0 sm:w-[7rem]">
                <CountrySelector
                  v-model="addressForm.contact_country_code"
                  placeholder="选择国家"
                  @country-change="handleAddressCountryChange"
                />
              </div>
              <div class="min-w-0 flex-1 flex flex-col justify-start">
                <input
                  v-model="addressForm.contact_phone"
                  type="tel"
                  required
                  list="profile-address-phone-history"
                  autocomplete="tel-national"
                  class="block w-full h-10 px-3 border border-gray-300 rounded-md text-sm leading-5 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  :placeholder="t('profile.addressPhoneComboPlaceholder')"
                />
                <datalist id="profile-address-phone-history">
                  <option
                    v-for="num in savedPhonesForCountry"
                    :key="num"
                    :value="num"
                  />
                </datalist>
              </div>
            </div>
          </div>

          <!-- 泰国三级联动地址选择器 -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-3">{{ t('order.addressRegion') }} *</label>
            <ThailandAddressSelector 
              v-model="addressRegion"
              @change="handleAddressRegionChange"
            />
          </div>


          <div>
            <label class="block text-sm font-medium text-gray-700">{{ t('order.detailAddress') }} *</label>
            <textarea
              v-model="addressForm.detail_address"
              required
              rows="3"
              class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              :placeholder="t('order.detailAddressPlaceholder')"
            ></textarea>
          </div>



          <div>
            <label class="block text-sm font-medium text-gray-700">{{ t('order.addressType') }}</label>
            <select
              v-model="addressForm.address_type"
              class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="home">{{ t('order.addressHome') }}</option>
              <option value="company">{{ t('order.addressCompany') }}</option>
              <option value="other">{{ t('order.addressOther') }}</option>
            </select>
          </div>

          <div class="flex items-center">
            <input
              v-model="addressForm.is_default"
              type="checkbox"
              class="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label class="ml-2 block text-sm text-gray-700">{{ t('profile.setAsDefault') }}</label>
          </div>

          <div class="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              @click="showAddressModal = false"
              class="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              type="submit"
              :disabled="savingAddress"
              class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {{ savingAddress ? t('profile.saving') : (editingAddress ? t('profile.update') : t('profile.add')) }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useUserStore } from '../stores/user.js'
import { getAddresses, addAddress, updateAddress, deleteAddress as deleteAddressAPI, setDefaultAddress as setDefaultAddressAPI } from '../api/addresses.js'
import { getUserOrders } from '../api/orders.js'
import { userAPI } from '../api/users.js'
import api from '../api/index.js'
import config from '../../config/index.js'
import CountrySelector from '../components/CountrySelector.vue'
import ThailandAddressSelector from '../components/ThailandAddressSelector.vue'
import { validatePhoneI18n, formatPhoneDisplay } from '../utils/phoneValidation.js'
import { useToast } from '../composables/useToast.js'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const { t } = useI18n()
const { success, error: showError, warning } = useToast()

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
      const postal = address.postal_code && address.postal_code.trim() ? ` ${address.postal_code.trim()}` : ''
      return `${regionPart} ${address.detail_address.trim()}${postal}`
    } else {
      return address.detail_address.trim()
    }
  }
  
  return regionPart || '地址信息不完整'
}

// 页面状态
const activeTab = ref('orders')

// 与 URL ?tab= 同步（从结算页带 tab=orders 进入时可靠；同页仅改 query 时也会更新）
watch(
  () => route.query.tab,
  (tabParam) => {
    if (tabParam && ['orders', 'addresses', 'profile'].includes(String(tabParam))) {
      activeTab.value = String(tabParam)
    }
  },
  { immediate: true }
)

// 地址模态框状态
const showAddressModal = ref(false)
const editingAddress = ref(null)

// 订单数据
const orders = ref([])
const loadingOrders = ref(false)

// 地址数据
const addresses = ref([])

// 地址表单数据
const addressForm = ref({
  contact_name: '',
  contact_country_code: '+66',
  contact_phone: '',
  province: '',
  city: '',
  district: '',
  postal_code: '',
  detail_address: '',
  address_type: 'home',
  is_default: false
})

const normalizeAddressCountryCode = (code) => {
  if (code == null || String(code).trim() === '') return '+66'
  const s = String(code).trim()
  return s.startsWith('+') ? s : `+${s.replace(/^\+/, '')}`
}

/** 当前区号下已保存的本地手机号（历史地址 + 账号绑定），供 datalist 选择，仍走 validatePhoneI18n */
const savedPhonesForCountry = computed(() => {
  const target = normalizeAddressCountryCode(addressForm.value.contact_country_code)
  const seen = new Set()
  const out = []
  const push = (p) => {
    const v = String(p ?? '').trim()
    if (!v || seen.has(v)) return
    seen.add(v)
    out.push(v)
  }
  for (const a of addresses.value) {
    if (normalizeAddressCountryCode(a.contact_country_code) !== target) continue
    push(a.contact_phone)
  }
  const u = userStore.user
  if (u?.phone && normalizeAddressCountryCode(u.country_code) === target) {
    push(u.phone)
  }
  return out
})

// 三级联动地址选择器数据
const addressRegion = ref({
  province: null,
  district: null,
  subDistrict: null,
  postalCode: ''
})

// 加载状态
const loadingAddresses = ref(false)
const savingAddress = ref(false)

// 个人资料编辑
const profileForm = ref({
  nickname: userStore.user?.nickname || '',
  email: userStore.user?.email || ''
})
const profileErrors = ref({
  nickname: '',
  email: ''
})
const profileSaving = ref(false)
const avatarFileInput = ref(null)
const avatarUploading = ref(false)

const avatarDisplayUrl = computed(() => {
  const u = userStore.user?.avatar_url
  if (!u) return null
  return config.buildStaticUrl(u)
})

// 监听用户数据变化，更新表单
watch(() => userStore.user, (newUser) => {
  if (newUser) {
    profileForm.value.nickname = newUser.nickname || ''
    profileForm.value.email = newUser.email || ''
  }
}, { immediate: true, deep: true })

// 从数据库获取最新用户信息
const refreshUserInfo = async () => {
  try {
    const response = await userAPI.getCurrentUser()
    if (response.data.success) {
      // 更新userStore中的用户信息
      userStore.user = response.data.data
      // 同步更新localStorage
      localStorage.setItem('user', JSON.stringify(response.data.data))
      
      // 更新个人资料表单
      if (response.data.data) {
        profileForm.value.nickname = response.data.data.nickname || ''
        profileForm.value.email = response.data.data.email || ''
      }
    }
  } catch (error) {
    console.error('获取用户信息失败:', error)
    // 如果获取失败，回退到localStorage中的数据
  }
}

// 计算显示昵称
const displayNickname = computed(() => {
  // 优先使用用户数据中的昵称，如果没有则使用默认昵称
  return userStore.user?.nickname || t('profile.defaultNickname')
})

// 计算统计数据
const orderStats = computed(() => {
  const total = orders.value.length
  
  return {
    total
  }
})

// 工具方法
const formatDate = (dateString) => {
  if (!dateString) return t('profile.unknown')
  const date = new Date(dateString)
  return date.toLocaleDateString()
}

// 格式化日期时间（包含时分秒）
const formatDateTime = (dateString) => {
  if (!dateString) return t('profile.unknown')
  const date = new Date(dateString)
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString()
}

// 在线支付 USDT：仅按订单保存的汇率换算（系统汇算比例变更不影响历史订单）
const getExchangedAmount = (amount, orderExchangeRate) => {
  const raw = orderExchangeRate == null || orderExchangeRate === '' ? NaN : parseFloat(orderExchangeRate)
  const rate = Number.isFinite(raw) ? raw : 1
  return (parseFloat(amount) * rate).toFixed(2)
}

// 获取订单状态样式
const getStatusStyle = (status) => {
  const styles = {
    pending: 'text-yellow-600',
    paid: 'text-blue-600',
    shipped: 'text-purple-600',
    shipping: 'text-blue-600',
    delivered: 'text-green-600',
    completed: 'text-green-600',
    cancelled: 'text-red-600'
  }
  return styles[status] || 'text-gray-600'
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
  return statusMap[status] || t('order.status.completed')
}

// 订单操作方法
const viewOrderDetail = (orderId) => {
  router.push(`/orders/${orderId}`)
}



// 加载用户订单
const loadOrders = async () => {
  try {
    loadingOrders.value = true
    const response = await getUserOrders()
    if (response.data.success) {
      // 后端返回的数据结构是 { orders, total, page, totalPages }
      const orderList = response.data.data?.orders || []
      // 按创建时间倒序排列（最新的在前面）
      orders.value = orderList.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    } else {
      orders.value = []
      console.error('加载订单失败:', response.data.message)
    }
  } catch (error) {
    console.error('加载订单失败:', error)
    orders.value = []
    showError(t('profile.loadOrdersFailed'))
  } finally {
    loadingOrders.value = false
  }
}

// 加载地址列表
const loadAddresses = async () => {
  try {
    loadingAddresses.value = true
    const response = await getAddresses()
    if (response.data.success) {
      addresses.value = response.data.data || []
    } else {
      addresses.value = []
      console.error('加载地址失败:', response.data.message)
    }
  } catch (error) {
    console.error('加载地址失败:', error)
    addresses.value = []
    showError(t('profile.loadAddressesFailed'))
  } finally {
    loadingAddresses.value = false
  }
}

// 地址管理方法
const handleAddAddress = () => {
  editingAddress.value = null
  resetAddressForm()
  showAddressModal.value = true
}

// 处理地址国家变更
const handleAddressCountryChange = (country) => {
  // 当国家变更时，清空手机号以避免格式错误
  addressForm.value.contact_phone = ''
}

const editAddress = async (address) => {
  if (!address) return
  editingAddress.value = { ...address }
  // 填充表单数据
  Object.keys(addressForm.value).forEach(key => {
    addressForm.value[key] = address[key] || ''
  })
  
  // 根据省市区名称查找对应的ID
  try {
    let provinceId = null
    let districtId = null
    let subDistrictId = null
    
    // 如果有省份名称，查找省份ID
    if (address.province) {
      const provincesResponse = await api.get('/administrative-regions/provinces', {
        params: { locale: 'zh-CN' }
      })
      if (provincesResponse.data.success) {
        const province = provincesResponse.data.data.find(p => p.name === address.province || p.name_alias === address.province)
        if (province) {
          provinceId = province.id
          
          // 如果有城市名称，查找城市ID
          if (address.city) {
            const districtsResponse = await api.get(`/administrative-regions/provinces/${provinceId}/districts`, {
              params: { locale: 'zh-CN' }
            })
            if (districtsResponse.data.success) {
              const district = districtsResponse.data.data.find(d => d.name === address.city || d.name_alias === address.city)
              if (district) {
                districtId = district.id
                
                // 如果有区县名称，查找区县ID
                if (address.district) {
                  const subDistrictsResponse = await api.get(`/administrative-regions/districts/${districtId}/sub-districts`, {
                    params: { locale: 'zh-CN' }
                  })
                  if (subDistrictsResponse.data.success) {
                    const subDistrict = subDistrictsResponse.data.data.find(s => s.name === address.district || s.name_alias === address.district)
                    if (subDistrict) {
                      subDistrictId = subDistrict.id
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    
    // 设置地址选择器的值
    addressRegion.value = {
      province: provinceId,
      district: districtId,
      subDistrict: subDistrictId,
      postalCode: address.postal_code || ''
    }
  } catch (error) {
    console.error('查找地址ID失败:', error)
    // 如果查找失败，至少设置邮编
    addressRegion.value = {
      province: null,
      district: null,
      subDistrict: null,
      postalCode: address.postal_code || ''
    }
  }
  
  showAddressModal.value = true
}

const resetAddressForm = () => {
  
  addressForm.value = {
    contact_name: '',
    contact_country_code: '+66',
    contact_phone: '',
    province: '',
    city: '',
    district: '',
    postal_code: '',
    detail_address: '',
    address_type: 'home',
    is_default: false
  }
  addressRegion.value = {
    province: null,
    district: null,
    subDistrict: null,
    postalCode: ''
  }
  
}

// 处理地址区域选择变化
const handleAddressRegionChange = (regionData) => {
  
  // 更新表单中的省市区和邮编信息
  if (regionData.provinceData && regionData.provinceData.name) {
    addressForm.value.province = regionData.provinceData.name
  } else {
    addressForm.value.province = ''
  }
  
  if (regionData.districtData && regionData.districtData.name) {
    addressForm.value.city = regionData.districtData.name
  } else {
    addressForm.value.city = ''
  }
  
  if (regionData.subDistrictData && regionData.subDistrictData.name) {
    addressForm.value.district = regionData.subDistrictData.name
  } else {
    addressForm.value.district = ''
  }
  
  if (regionData.postalCode) {
    addressForm.value.postal_code = regionData.postalCode
  } else {
    addressForm.value.postal_code = ''
  }
  
}

const saveAddress = async () => {
  try {
    // 基本表单验证
    if (!addressForm.value.contact_name.trim()) {
      showError(t('validation.contactNameRequired'))
      return
    }
    if (!addressForm.value.contact_phone.trim()) {
      showError(t('validation.contactPhoneRequired'))
      return
    }
    
    // 验证手机号格式
    const phoneValidation = validatePhoneI18n(addressForm.value.contact_phone, addressForm.value.contact_country_code, t)
    if (!phoneValidation.isValid) {
      showError(phoneValidation.message)
      return
    }
    if (!addressForm.value.province.trim() || !addressForm.value.city.trim()) {
      showError(t('profile.provinceAndCityRequired'))
      return
    }
    if (!addressForm.value.detail_address.trim()) {
      showError(t('validation.detailAddressRequired'))
      return
    }

    savingAddress.value = true
    let response

    if (editingAddress.value) {
      // 编辑地址
      response = await updateAddress(editingAddress.value.id, addressForm.value)
    } else {
      // 添加地址
      response = await addAddress(addressForm.value)
    }

    if (response.data.success) {
      success(editingAddress.value ? t('profile.addressUpdated') : t('profile.addressAdded'))
      showAddressModal.value = false
      await loadAddresses() // 重新加载地址列表
    } else {
      showError(response.data.message || t('profile.saveAddressFailed'))
    }
  } catch (error) {
    console.error('保存地址失败:', error)
    showError(t('profile.saveAddressFailed'))
  } finally {
    savingAddress.value = false
  }
}

const deleteAddress = async (addressId) => {
  if (!addressId) return
  
  const address = addresses.value.find(a => a.id === addressId)
  const confirmText = address?.is_default 
    ? t('profile.confirmDeleteDefault')
    : t('profile.confirmDeleteAddress')
  
  if (!confirm(confirmText)) return
  
  try {
    const response = await deleteAddressAPI(addressId)
    if (response.data.success) {
      success(t('profile.addressDeleted'))
      await loadAddresses() // 重新加载地址列表
    } else {
      showError(response.data.message || t('profile.deleteAddressFailed'))
    }
  } catch (error) {
    console.error('删除地址失败:', error)
    showError(t('profile.deleteAddressFailed'))
  }
}

// 个人资料验证
const validateProfile = () => {
  profileErrors.value.nickname = ''
  profileErrors.value.email = ''
  
  let isValid = true
  
  if (!profileForm.value.nickname || profileForm.value.nickname.trim().length === 0) {
    profileErrors.value.nickname = '请输入昵称'
    isValid = false
  } else if (profileForm.value.nickname.trim().length > 50) {
    profileErrors.value.nickname = '昵称不能超过50个字符'
    isValid = false
  }
  
  if (profileForm.value.email && !/^\S+@\S+\.\S+$/.test(profileForm.value.email)) {
    profileErrors.value.email = '请输入有效的邮箱地址'
    isValid = false
  }
  
  return isValid
}

const onAvatarFileChange = async (e) => {
  const input = e.target
  const file = input?.files?.[0]
  if (input) input.value = ''
  if (!file) return

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (!allowed.includes(file.type)) {
    showError(t('profile.avatarInvalidType'))
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    showError(t('profile.avatarTooLarge'))
    return
  }

  avatarUploading.value = true
  try {
    const fd = new FormData()
    fd.append('avatar', file)
    const res = await api.post('/upload/avatar', fd, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    if (!res.data?.success) {
      showError(res.data?.message || t('profile.avatarUploadFailed'))
      return
    }
    const url = res.data.data?.url
    const upd = await userStore.updateProfile({
      nickname: profileForm.value.nickname.trim(),
      email: profileForm.value.email.trim() || undefined,
      avatar_url: url
    })
    if (upd.success) {
      await refreshUserInfo()
      success(t('profile.avatarUpdated'))
    } else {
      showError(upd.message || t('profile.avatarUploadFailed'))
    }
  } catch (err) {
    console.error(err)
    showError(t('profile.avatarUploadFailed'))
  } finally {
    avatarUploading.value = false
  }
}

const removeAvatar = async () => {
  if (!userStore.user?.avatar_url) return
  avatarUploading.value = true
  try {
    const upd = await userStore.updateProfile({
      nickname: profileForm.value.nickname.trim(),
      email: profileForm.value.email.trim() || undefined,
      avatar_url: null
    })
    if (upd.success) {
      await refreshUserInfo()
      success(t('profile.avatarRemoved'))
    } else {
      showError(upd.message || t('profile.saveFailed'))
    }
  } catch (err) {
    console.error(err)
    showError(t('profile.saveFailed'))
  } finally {
    avatarUploading.value = false
  }
}

// 保存个人资料
const handleSaveProfile = async () => {
  if (!validateProfile()) return
  
  try {
    profileSaving.value = true
    
    const updateData = {
      nickname: profileForm.value.nickname.trim(),
      email: profileForm.value.email.trim() || undefined
    }
    
    const response = await userStore.updateProfile(updateData)
    
    if (response.success) {
      // 保存成功后，从数据库重新获取最新的用户信息
      await refreshUserInfo()
      success(t('user.profileUpdated'))
    } else {
      showError(response.message || t('profile.saveFailed'))
    }
  } catch (error) {
    console.error('保存个人资料失败:', error)
    showError(t('profile.saveFailed'))
  } finally {
    profileSaving.value = false
  }
}

const setDefaultAddress = async (addressId) => {
  if (!addressId) return
  
  try {
    const response = await setDefaultAddressAPI(addressId)
    if (response.data.success) {
      success(t('profile.defaultAddressSet'))
      await loadAddresses() // 重新加载地址列表
    } else {
      showError(response.data.message || t('profile.setDefaultFailed'))
    }
  } catch (error) {
    console.error('设置默认地址失败:', error)
    showError(t('profile.setDefaultFailed'))
  }
}

// 页面加载时获取数据
onMounted(async () => {
  // 确保用户数据已加载，如果没有则尝试从localStorage恢复
  if (!userStore.user) {
    await userStore.checkAuth()
  }
  
  // 从数据库获取最新的用户信息（这样确保昵称等信息是最新的）
  await refreshUserInfo()
  
  // 并行加载订单和地址数据
  await Promise.all([
    loadOrders(),
    loadAddresses()
  ])
})
</script>

