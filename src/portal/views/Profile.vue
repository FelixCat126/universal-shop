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
          <div class="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-2xl">
            👤
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
                    <div class="font-medium">{{ t('common.currency') }}{{ order.total_amount }}</div>
                    <div class="text-sm text-green-600">
                      {{ t('profile.completed') }}
                    </div>
                  </div>
                </div>
                <div class="text-sm text-gray-700">{{ order.delivery_address }}</div>
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
                        {{ formatPhoneDisplay(address.contact_phone, address.contact_country_code || '+86') }}
                      </span>
                      <span v-if="address.is_default" class="ml-2 px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">{{ t('profile.default') }}</span>
                    </div>
                    <p class="text-sm text-gray-700">
                      {{ address.province }}{{ address.city }}{{ address.district }}{{ address.detail_address }}
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
            <label class="block text-sm font-medium text-gray-700 mb-3">{{ t('order.contactPhone') }} *</label>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-5">
              <!-- 国家选择 -->
              <div class="sm:col-span-2">
                <CountrySelector
                  v-model="addressForm.contact_country_code"
                  placeholder="选择国家"
                  @country-change="handleAddressCountryChange"
                />
              </div>
              <!-- 手机号输入 -->
              <div class="sm:col-span-3">
                <div class="relative">
                  <div class="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                    <span class="text-gray-500 text-sm">{{ addressForm.contact_country_code }}</span>
                  </div>
                  <input
                    v-model="addressForm.contact_phone"
                    type="tel"
                    required
                    class="appearance-none block w-full pl-16 pr-3 py-2 border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    :placeholder="`请输入手机号`"
                  />
                </div>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700">{{ t('order.province') }} *</label>
              <input
                v-model="addressForm.province"
                type="text"
                required
                class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                :placeholder="t('order.province')"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700">{{ t('order.city') }} *</label>
              <input
                v-model="addressForm.city"
                type="text"
                required
                class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                :placeholder="t('order.city')"
              />
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700">{{ t('order.district') }}</label>
            <input
              v-model="addressForm.district"
              type="text"
              class="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              :placeholder="t('order.districtPlaceholder')"
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
import CountrySelector from '../components/CountrySelector.vue'
import { validatePhone, formatPhoneDisplay } from '../utils/phoneValidation.js'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

// 国际化
const { t } = useI18n()

// 页面状态
const activeTab = ref('orders')

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
  contact_country_code: '+86',
  contact_phone: '',
  province: '',
  city: '',
  district: '',
  detail_address: '',
  address_type: 'home',
  is_default: false
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
    alert(t('profile.loadOrdersFailed'))
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
    alert(t('profile.loadAddressesFailed'))
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

const editAddress = (address) => {
  if (!address) return
  editingAddress.value = { ...address }
  // 填充表单数据
  Object.keys(addressForm.value).forEach(key => {
    addressForm.value[key] = address[key] || ''
  })
  showAddressModal.value = true
}

const resetAddressForm = () => {
  addressForm.value = {
    contact_name: '',
    contact_country_code: '+86',
    contact_phone: '',
    province: '',
    city: '',
    district: '',
    detail_address: '',
    address_type: 'home',
    is_default: false
  }
}

const saveAddress = async () => {
  try {
    // 基本表单验证
    if (!addressForm.value.contact_name.trim()) {
      alert(t('validation.contactNameRequired'))
      return
    }
    if (!addressForm.value.contact_phone.trim()) {
      alert(t('validation.contactPhoneRequired'))
      return
    }
    
    // 验证手机号格式
    const phoneValidation = validatePhone(addressForm.value.contact_phone, addressForm.value.contact_country_code)
    if (!phoneValidation.isValid) {
      alert(phoneValidation.message)
      return
    }
    if (!addressForm.value.province.trim() || !addressForm.value.city.trim()) {
      alert(t('profile.provinceAndCityRequired'))
      return
    }
    if (!addressForm.value.detail_address.trim()) {
      alert(t('validation.detailAddressRequired'))
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
      alert(editingAddress.value ? t('profile.addressUpdated') : t('profile.addressAdded'))
      showAddressModal.value = false
      await loadAddresses() // 重新加载地址列表
    } else {
      alert(response.data.message || t('profile.saveAddressFailed'))
    }
  } catch (error) {
    console.error('保存地址失败:', error)
    alert(t('profile.saveAddressFailed'))
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
      alert(t('profile.addressDeleted'))
      await loadAddresses() // 重新加载地址列表
    } else {
      alert(response.data.message || t('profile.deleteAddressFailed'))
    }
  } catch (error) {
    console.error('删除地址失败:', error)
    alert(t('profile.deleteAddressFailed'))
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
      alert(t('user.profileUpdated'))
    } else {
      alert(response.message || t('profile.saveFailed'))
    }
  } catch (error) {
    console.error('保存个人资料失败:', error)
    alert(t('profile.saveFailed'))
  } finally {
    profileSaving.value = false
  }
}

const setDefaultAddress = async (addressId) => {
  if (!addressId) return
  
  try {
    const response = await setDefaultAddressAPI(addressId)
    if (response.data.success) {
      alert(t('profile.defaultAddressSet'))
      await loadAddresses() // 重新加载地址列表
    } else {
      alert(response.data.message || t('profile.setDefaultFailed'))
    }
  } catch (error) {
    console.error('设置默认地址失败:', error)
    alert(t('profile.setDefaultFailed'))
  }
}

// 页面加载时获取数据
onMounted(async () => {
  // 检查URL参数，如果有tab参数则切换到对应标签页
  const tabParam = route.query.tab
  if (tabParam && ['orders', 'addresses', 'profile'].includes(tabParam)) {
    activeTab.value = tabParam
  }
  
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

