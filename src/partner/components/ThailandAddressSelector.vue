<template>
  <div class="partner-region space-y-3">
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('address.province') }}</label>
      <select
        v-model.number="selectedProvince"
        class="partner-region-select touch-manipulation"
        :disabled="loading"
        @change="handleProvinceChange"
      >
        <option :value="0">{{ t('address.selectProvince') }}</option>
        <option v-for="p in provinces" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('address.district') }}</label>
      <select
        v-model.number="selectedDistrict"
        class="partner-region-select touch-manipulation"
        :disabled="!selectedProvince || loading"
        @change="handleDistrictChange"
      >
        <option :value="0">{{ selectedProvince ? t('address.selectDistrict') : t('address.selectProvinceFirst') }}</option>
        <option v-for="d in districts" :key="d.id" :value="d.id">{{ d.name }}</option>
      </select>
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('address.subDistrict') }}</label>
      <select
        v-model.number="selectedSubDistrict"
        class="partner-region-select touch-manipulation"
        :disabled="!selectedDistrict || loading"
        @change="handleSubDistrictChange"
      >
        <option :value="0">{{ selectedDistrict ? t('address.selectSubDistrict') : t('address.selectDistrictFirst') }}</option>
        <option v-for="s in subDistricts" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </div>

    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1">{{ t('address.postalCode') }}</label>
      <input
        v-model="postalCode"
        type="text"
        readonly
        inputmode="numeric"
        maxlength="10"
        class="partner-region-postal touch-manipulation"
        :placeholder="t('address.postalCodeAuto')"
      />
    </div>

    <div v-if="loading" class="text-center text-gray-500 text-sm py-1">{{ t('common.loading') }}…</div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import config from '../../config/index.js'

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:modelValue', 'change'])

const { t, locale } = useI18n()

const provinces = ref([])
const districts = ref([])
const subDistricts = ref([])

const selectedProvince = ref(0)
const selectedDistrict = ref(0)
const selectedSubDistrict = ref(0)
const postalCode = ref('')

const loading = ref(false)

async function fetchJsonPath (path) {
  const url = config.buildApiUrl(path.startsWith('/') ? path : `/${path}`)
  const res = await fetch(url)
  return res.json()
}

async function fetchProvinces () {
  loading.value = true
  try {
    const q = encodeURIComponent(locale.value || 'zh-CN')
    const json = await fetchJsonPath(`/administrative-regions/provinces?locale=${q}`)
    if (json.success) provinces.value = json.data || []
  } finally {
    loading.value = false
  }
}

async function fetchDistricts (provinceId) {
  if (!provinceId) {
    districts.value = []
    return
  }
  loading.value = true
  try {
    const q = encodeURIComponent(locale.value || 'zh-CN')
    const json = await fetchJsonPath(`/administrative-regions/provinces/${provinceId}/districts?locale=${q}`)
    if (json.success) districts.value = json.data || []
    else districts.value = []
  } finally {
    loading.value = false
  }
}

async function fetchSubDistricts (districtId) {
  if (!districtId) {
    subDistricts.value = []
    return
  }
  loading.value = true
  try {
    const q = encodeURIComponent(locale.value || 'zh-CN')
    const json = await fetchJsonPath(`/administrative-regions/districts/${districtId}/sub-districts?locale=${q}`)
    if (json.success) subDistricts.value = json.data || []
    else subDistricts.value = []
  } finally {
    loading.value = false
  }
}

function emitChange () {
  const pid = selectedProvince.value
  const did = selectedDistrict.value
  const sid = selectedSubDistrict.value
  const value = {
    province: pid || null,
    district: did || null,
    subDistrict: sid || null,
    postalCode: postalCode.value || '',
    provinceData: provinces.value.find((p) => p.id === pid),
    districtData: districts.value.find((d) => d.id === did),
    subDistrictData: subDistricts.value.find((s) => s.id === sid)
  }
  emit('update:modelValue', value)
  emit('change', value)
}

function handleProvinceChange () {
  selectedDistrict.value = 0
  selectedSubDistrict.value = 0
  postalCode.value = ''
  districts.value = []
  subDistricts.value = []
  if (selectedProvince.value) fetchDistricts(selectedProvince.value)
  emitChange()
}

function handleDistrictChange () {
  selectedSubDistrict.value = 0
  postalCode.value = ''
  subDistricts.value = []
  if (selectedDistrict.value) fetchSubDistricts(selectedDistrict.value)
  emitChange()
}

function handleSubDistrictChange () {
  if (selectedSubDistrict.value) {
    const sub = subDistricts.value.find((s) => s.id === selectedSubDistrict.value)
    if (sub?.postal_code) postalCode.value = String(sub.postal_code).trim().slice(0, 10)
    else postalCode.value = ''
  } else {
    postalCode.value = ''
  }
  emitChange()
}

watch(locale, () => {
  fetchProvinces()
  if (selectedProvince.value) fetchDistricts(selectedProvince.value)
  if (selectedDistrict.value) fetchSubDistricts(selectedDistrict.value)
})

watch(
  () => props.modelValue,
  async (nv) => {
    if (!nv || typeof nv !== 'object') return
    selectedProvince.value = nv.province ? Number(nv.province) : 0
    selectedDistrict.value = nv.district ? Number(nv.district) : 0
    selectedSubDistrict.value = nv.subDistrict ? Number(nv.subDistrict) : 0
    postalCode.value = nv.postalCode || ''

    if (selectedProvince.value) await fetchDistricts(selectedProvince.value)
    else districts.value = []

    if (selectedDistrict.value) await fetchSubDistricts(selectedDistrict.value)
    else subDistricts.value = []
  },
  { immediate: true, deep: true }
)

onMounted(fetchProvinces)
</script>

<style scoped>
.partner-region-select {
  display: block;
  width: 100%;
  min-height: 44px;
  border-radius: 0.75rem;
  border: 1px solid rgb(209 213 219);
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
  line-height: 1.35;
  background: #fff;
  color: rgb(17 24 39);
}

.partner-region-select:focus {
  outline: none;
  border-color: rgb(13 148 136);
  box-shadow: 0 0 0 3px rgb(204 251 241);
}

.partner-region-select:disabled {
  background: rgb(249 250 251);
  color: rgb(107 114 128);
}

.partner-region-postal {
  display: block;
  width: 100%;
  min-height: 44px;
  border-radius: 0.75rem;
  border: 1px solid rgb(209 213 219);
  padding: 0.5rem 0.75rem;
  font-size: 1rem;
  background: rgb(249 250 251);
  color: rgb(75 85 99);
}

.partner-region-postal:focus {
  outline: none;
}
</style>
