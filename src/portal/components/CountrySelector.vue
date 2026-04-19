<template>
  <div class="country-selector flex flex-col h-full min-w-0">
    <label v-if="label" :class="labelClass">{{ label }}</label>
    <div class="relative flex-1 min-h-[2.5rem] min-w-0 w-full">
      <select 
        :value="modelValue" 
        @change="updateCountry"
        :class="[
          'country-selector-input appearance-none block w-full h-10 min-h-[2.5rem] max-h-[2.5rem] pl-2 pr-7 py-0 text-sm leading-5 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
          inputClass,
          hasError ? 'border-red-500' : 'border-gray-300'
        ]"
        :disabled="disabled"
      >
        <option value="" disabled>{{ placeholderText }}</option>
        <option 
          v-for="country in countries" 
          :key="country.code" 
          :value="country.code"
          :title="`${country.name} (${country.code})`"
        >
          {{ country.flag }} {{ country.code }}
        </option>
      </select>
      <!-- 下拉箭头 -->
      <div class="absolute inset-y-0 right-0 flex items-center pr-1.5 pl-0 pointer-events-none">
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
import { useI18n } from 'vue-i18n'

// 国际化
const { t } = useI18n()

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
    default: ''
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

// 国家数据 - 使用国际化
const countries = computed(() => [
  {
    code: '+86',
    name: t('country.china'),
    flag: '🇨🇳',
    phoneLength: 11
  },
  {
    code: '+66', 
    name: t('country.thailand'),
    flag: '🇹🇭',
    phoneLength: 9
  },
  {
    code: '+60',
    name: t('country.malaysia'), 
    flag: '🇲🇾',
    phoneLength: 11
  }
])

// 计算属性
const hasError = computed(() => !!props.error)
const errorMessage = computed(() => props.error)
const placeholderText = computed(() => props.placeholder || t('common.selectCountry'))

// 获取选中国家信息
const selectedCountry = computed(() => {
  return countries.value.find(country => country.code === props.modelValue) || countries.value[0]
})

// 更新国家选择
const updateCountry = (event) => {
  const countryCode = event.target.value
  const country = countries.value.find(c => c.code === countryCode)
  
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
  getCountryByCode: (code) => countries.value.find(c => c.code === code),
  validatePhoneLength: (phone, countryCode) => {
    const country = countries.value.find(c => c.code === countryCode)
    return country ? phone.length === country.phoneLength : false
  }
})
</script>

<style scoped>
/* 与表单 input 同高；!important 覆盖 @tailwindcss/forms 对 select 的全局 padding/高度 */
select.country-selector-input {
  box-sizing: border-box !important;
  height: 2.5rem !important;
  min-height: 2.5rem !important;
  max-height: 2.5rem !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  padding-left: 0.5rem !important;
  padding-right: 1.75rem !important;
  font-size: 0.875rem !important;
  line-height: 1.25rem !important;
  -webkit-appearance: none !important;
  -moz-appearance: none !important;
  appearance: none !important;
  background-image: none !important;
}

.country-selector-input:disabled {
  background-color: #f9fafb;
  color: #6b7280;
  cursor: not-allowed;
}

.country-selector-input:focus {
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
</style>
