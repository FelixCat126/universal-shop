<template>
  <div class="thailand-address-selector space-y-4">
    <!-- 省份选择 -->
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">
        {{ t('address.province') }}
      </label>
      <select 
        v-model="selectedProvince" 
        @change="handleProvinceChange"
        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        :disabled="loading"
      >
        <option value="">{{ t('address.selectProvince') }}</option>
        <option 
          v-for="province in provinces" 
          :key="province.id" 
          :value="province.id"
        >
          {{ province.name }}
        </option>
      </select>
    </div>

    <!-- 市区选择 -->
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">
        {{ t('address.district') }}
      </label>
      <select 
        v-model="selectedDistrict" 
        @change="handleDistrictChange"
        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        :disabled="!selectedProvince || loading"
      >
        <option value="">
          {{ selectedProvince ? t('address.selectDistrict') : t('address.selectProvinceFirst') }}
        </option>
        <option 
          v-for="district in districts" 
          :key="district.id" 
          :value="district.id"
        >
          {{ district.name }}
        </option>
      </select>
    </div>

    <!-- 子区选择 -->
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">
        {{ t('address.subDistrict') }}
      </label>
      <select 
        v-model="selectedSubDistrict" 
        @change="handleSubDistrictChange"
        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        :disabled="!selectedDistrict || loading"
      >
        <option value="">
          {{ selectedDistrict ? t('address.selectSubDistrict') : t('address.selectDistrictFirst') }}
        </option>
        <option 
          v-for="subDistrict in subDistricts" 
          :key="subDistrict.id" 
          :value="subDistrict.id"
        >
          {{ subDistrict.name }}
        </option>
      </select>
    </div>

    <!-- 邮编显示 -->
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">
        {{ t('address.postalCode') }}
      </label>
      <input
        v-model="postalCode"
        type="text"
        readonly
        class="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600"
        :placeholder="t('address.postalCodeAuto')"
      />
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="text-center text-gray-500 text-sm">
      {{ t('common.loading') }}...
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import api from '../api/index.js'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:modelValue', 'change'])

const { t, locale } = useI18n()

// 响应式数据
const provinces = ref([])
const districts = ref([])
const subDistricts = ref([])

const selectedProvince = ref(null)
const selectedDistrict = ref(null)
const selectedSubDistrict = ref(null)
const postalCode = ref('')

const loading = ref(false)

// 获取省份列表
const fetchProvinces = async () => {
  try {
    loading.value = true
    const response = await api.get('/administrative-regions/provinces', {
      params: { locale: locale.value }
    })
    if (response.data.success) {
      provinces.value = response.data.data
    }
  } catch (error) {
    console.error('获取省份失败:', error)
  } finally {
    loading.value = false
  }
}

// 获取市区列表
const fetchDistricts = async (provinceId) => {
  if (!provinceId) {
    districts.value = []
    return
  }
  
  try {
    loading.value = true
    const response = await api.get(`/administrative-regions/provinces/${provinceId}/districts`, {
      params: { locale: locale.value }
    })
    if (response.data.success) {
      districts.value = response.data.data
    }
  } catch (error) {
    console.error('获取市区失败:', error)
    districts.value = []
  } finally {
    loading.value = false
  }
}

// 获取子区列表
const fetchSubDistricts = async (districtId) => {
  if (!districtId) {
    subDistricts.value = []
    return
  }
  
  try {
    loading.value = true
    const response = await api.get(`/administrative-regions/districts/${districtId}/sub-districts`, {
      params: { locale: locale.value }
    })
    if (response.data.success) {
      subDistricts.value = response.data.data
    }
  } catch (error) {
    console.error('获取子区失败:', error)
    subDistricts.value = []
  } finally {
    loading.value = false
  }
}

// 处理省份选择
const handleProvinceChange = () => {
  selectedDistrict.value = null
  selectedSubDistrict.value = null
  postalCode.value = ''
  districts.value = []
  subDistricts.value = []
  
  if (selectedProvince.value) {
    fetchDistricts(selectedProvince.value)
  }
  
  emitChange()
}

// 处理市区选择
const handleDistrictChange = () => {
  selectedSubDistrict.value = null
  postalCode.value = ''
  subDistricts.value = []
  
  if (selectedDistrict.value) {
    fetchSubDistricts(selectedDistrict.value)
  }
  
  emitChange()
}

// 处理子区选择
const handleSubDistrictChange = () => {
  if (selectedSubDistrict.value) {
    const subDistrict = subDistricts.value.find(s => s.id === selectedSubDistrict.value)
    if (subDistrict && subDistrict.postal_code) {
      postalCode.value = subDistrict.postal_code
    }
  }
  
  emitChange()
}

// 发射变更事件
const emitChange = () => {
  const value = {
    province: selectedProvince.value,
    district: selectedDistrict.value,
    subDistrict: selectedSubDistrict.value,
    postalCode: postalCode.value,
    provinceData: provinces.value.find(p => p.id === selectedProvince.value),
    districtData: districts.value.find(d => d.id === selectedDistrict.value),
    subDistrictData: subDistricts.value.find(s => s.id === selectedSubDistrict.value)
  }
  
  emit('update:modelValue', value)
  emit('change', value)
}

// 监听语言变化，重新获取数据
watch(locale, () => {
  fetchProvinces()
  if (selectedProvince.value) {
    fetchDistricts(selectedProvince.value)
  }
  if (selectedDistrict.value) {
    fetchSubDistricts(selectedDistrict.value)
  }
})

// 监听modelValue变化，同步内部状态
watch(() => props.modelValue, async (newValue) => {
  if (newValue) {
    selectedProvince.value = newValue.province || null
    selectedDistrict.value = newValue.district || null
    selectedSubDistrict.value = newValue.subDistrict || null
    postalCode.value = newValue.postalCode || ''
    
    // 如果有省份ID，加载对应的市区数据
    if (selectedProvince.value) {
      await fetchDistricts(selectedProvince.value)
      
      // 如果有市区ID，加载对应的子区数据
      if (selectedDistrict.value) {
        await fetchSubDistricts(selectedDistrict.value)
      }
    }
  }
}, { immediate: true })

// 组件挂载时获取省份数据
onMounted(fetchProvinces)
</script>

<style scoped>
.thailand-address-selector select:disabled {
  background-color: #f9fafb;
  color: #6b7280;
  cursor: not-allowed;
}

.thailand-address-selector select:focus {
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
</style>