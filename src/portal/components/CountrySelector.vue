<template>
  <div class="country-selector">
    <label v-if="label" :class="labelClass">{{ label }}</label>
    <div class="relative">
      <select 
        :value="modelValue" 
        @change="updateCountry"
        :class="[
          'appearance-none w-full px-4 py-2 pr-8 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
          inputClass,
          hasError ? 'border-red-500' : 'border-gray-300'
        ]"
        :disabled="disabled"
      >
        <option value="" disabled>{{ placeholder }}</option>
        <option 
          v-for="country in countries" 
          :key="country.code" 
          :value="country.code"
        >
          {{ country.flag }} {{ country.name }} ({{ country.code }})
        </option>
      </select>
      <!-- 下拉箭头 -->
      <div class="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
        <svg class="w-4 h-4 fill-current text-gray-400" viewBox="0 0 20 20">
          <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" fill-rule="evenodd"></path>
        </svg>
      </div>
    </div>
    <div v-if="hasError && errorMessage" class="mt-1 text-sm text-red-500">
      {{ errorMessage }}
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

// Props
const props = defineProps({
  modelValue: {
    type: String,
    default: '+86'
  },
  label: {
    type: String,
    default: ''
  },
  placeholder: {
    type: String,
    default: '请选择国家'
  },
  disabled: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: ''
  },
  labelClass: {
    type: String,
    default: 'block text-sm font-medium text-gray-700 mb-1'
  },
  inputClass: {
    type: String,
    default: ''
  }
})

// Emits
const emit = defineEmits(['update:modelValue', 'country-change'])

// 国家数据
const countries = [
  {
    code: '+86',
    name: '中国',
    flag: '🇨🇳',
    phoneLength: 11
  },
  {
    code: '+66', 
    name: '泰国',
    flag: '🇹🇭',
    phoneLength: 9
  },
  {
    code: '+60',
    name: '马来西亚', 
    flag: '🇲🇾',
    phoneLength: 11
  }
]

// 计算属性
const hasError = computed(() => !!props.error)
const errorMessage = computed(() => props.error)

// 获取选中国家信息
const selectedCountry = computed(() => {
  return countries.find(country => country.code === props.modelValue) || countries[0]
})

// 更新国家选择
const updateCountry = (event) => {
  const countryCode = event.target.value
  const country = countries.find(c => c.code === countryCode)
  
  emit('update:modelValue', countryCode)
  emit('country-change', {
    code: countryCode,
    name: country.name,
    flag: country.flag,
    phoneLength: country.phoneLength
  })
}

// 导出国家数据和工具函数
defineExpose({
  countries,
  selectedCountry,
  getCountryByCode: (code) => countries.find(c => c.code === code),
  validatePhoneLength: (phone, countryCode) => {
    const country = countries.find(c => c.code === countryCode)
    return country ? phone.length === country.phoneLength : false
  }
})
</script>

<style scoped>
.country-selector select {
  background-image: none;
}

.country-selector select:disabled {
  background-color: #f9fafb;
  color: #6b7280;
  cursor: not-allowed;
}

.country-selector select:focus {
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
</style>
