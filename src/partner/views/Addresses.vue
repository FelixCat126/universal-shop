<template>
  <div class="max-w-lg mx-auto px-3 sm:px-4 py-4 sm:py-6">
    <header class="mb-4">
      <h1 class="text-lg font-semibold text-gray-900">{{ t('addresses.title') }}</h1>
      <p class="text-xs text-gray-500 mt-1">{{ t('addresses.subtitle') }}</p>
    </header>

    <button
      type="button"
      class="w-full mb-4 touch-manipulation min-h-[48px] rounded-xl bg-primary-600 text-white font-semibold hover:bg-primary-700 active:opacity-95"
      @click="openCreate"
    >
      + {{ t('addresses.add') }}
    </button>

    <ul v-if="!loading && list.length" class="space-y-3">
      <li
        v-for="a in list"
        :key="a.id"
        class="rounded-xl border border-gray-100 bg-white shadow-soft p-4"
      >
        <div class="flex justify-between items-start gap-2 mb-2">
          <div>
            <span v-if="a.is_default" class="text-[10px] font-semibold uppercase tracking-wide text-primary-700 bg-primary-50 px-2 py-0.5 rounded">
              {{ t('addresses.defaultTag') }}
            </span>
            <span v-if="a.label" class="ml-2 text-sm text-gray-700 font-medium">{{ a.label }}</span>
          </div>
        </div>
        <p class="text-sm font-semibold text-gray-900">
          {{ a.recipient_name }} · {{ displayPhone(a) }}
        </p>
        <p class="text-xs text-gray-600 mt-1 whitespace-pre-line leading-relaxed">{{ formatLines(a) }}</p>
        <div class="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          <button
            type="button"
            class="text-sm text-primary-600 font-medium touch-manipulation min-h-[44px] px-1"
            @click="openEdit(a)"
          >
            {{ t('addresses.edit') }}
          </button>
          <button
            v-if="!a.is_default"
            type="button"
            class="text-sm text-gray-600 font-medium touch-manipulation min-h-[44px] px-1"
            @click="makeDefault(a)"
          >
            {{ t('addresses.setDefault') }}
          </button>
          <button
            type="button"
            class="text-sm text-red-600 font-medium touch-manipulation min-h-[44px] px-1"
            @click="remove(a)"
          >
            {{ t('addresses.delete') }}
          </button>
        </div>
      </li>
    </ul>

    <p
      v-else-if="!loading"
      class="text-center text-sm text-gray-500 py-12 border border-dashed border-gray-200 rounded-xl"
    >
      {{ t('shop.noAddress') }}
    </p>
    <div v-else class="flex justify-center py-12">
      <span class="h-10 w-10 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
    </div>

    <Teleport to="body">
      <div
        v-if="dialog"
        class="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm"
        @pointerdown.self="editOverlayPointerDown"
        @pointerup.self="editOverlayPointerUp"
        @pointercancel.self="editOverlayDismissCancel"
      >
        <div
          class="partner-addr-sheet w-full sm:max-w-md max-h-[92vh] flex flex-col overflow-hidden rounded-t-[1.35rem] sm:rounded-2xl bg-white shadow-[0_-8px_40px_rgba(0,0,0,0.12)] ring-1 ring-black/5"
          @pointerdown.stop="clearEditOverlayDismissArm"
        >
          <div class="sm:hidden flex justify-center pt-2 pb-1 shrink-0" aria-hidden="true">
            <span class="h-1 w-9 rounded-full bg-gray-200" />
          </div>

          <header
            class="relative shrink-0 px-4 py-3 border-b border-gray-100 bg-gradient-to-b from-gray-50/90 to-white"
          >
            <button
              type="button"
              class="touch-manipulation absolute left-2 top-1/2 -translate-y-1/2 p-2.5 rounded-full text-gray-500 hover:bg-gray-100/90 active:bg-gray-200 min-h-[44px] min-w-[44px] flex items-center justify-center"
              :aria-label="t('addresses.closeModal')"
              @click="dialog = false"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h2 class="text-center text-[17px] font-semibold tracking-tight text-gray-900 px-11">
              {{ editId ? t('addresses.edit') : t('addresses.add') }}
            </h2>
          </header>

          <div
            class="overflow-y-auto overscroll-contain flex-1 px-4 py-4"
            :style="{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }"
          >
            <form class="space-y-4 pb-16" @submit.prevent="save">
              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">{{ t('addresses.recipient') }}</label>
                <input
                  v-model="form.recipient_name"
                  required
                  autocomplete="name"
                  class="w-full rounded-xl border-gray-300 min-h-[44px] py-2.5 px-3 text-base touch-manipulation shadow-sm focus:border-primary-500 focus:ring-primary-500"
                />
              </div>

              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">{{ t('addresses.phone') }}</label>
                <p class="text-[11px] text-gray-500 mb-2 leading-snug">{{ t('addresses.phoneSuffix') }}</p>
                <div class="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <div class="w-full sm:w-[7.75rem] shrink-0">
                    <PhoneCountryCode v-model="form.phone_country_code" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <input
                      v-model="form.phone"
                      required
                      inputmode="tel"
                      autocomplete="tel-national"
                      class="w-full rounded-xl border-gray-300 min-h-[44px] py-2.5 px-3 text-base touch-manipulation shadow-sm focus:border-primary-500 focus:ring-primary-500"
                    />
                  </div>
                </div>
              </div>

              <div class="rounded-xl bg-gray-50/80 border border-gray-100 px-3 py-3 space-y-1">
                <ThailandAddressSelector v-model="regionModel" @change="onRegionChange" />
              </div>

              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">{{ t('addresses.detail') }}</label>
                <textarea
                  v-model="form.detail"
                  required
                  rows="3"
                  :placeholder="t('addresses.detailPh')"
                  class="w-full rounded-xl border-gray-300 py-2.5 px-3 text-base touch-manipulation shadow-sm focus:border-primary-500 focus:ring-primary-500"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600 mb-1">{{ t('addresses.label') }}</label>
                <input
                  v-model="form.label"
                  class="w-full rounded-xl border-gray-300 min-h-[44px] py-2.5 px-3 text-base touch-manipulation shadow-sm focus:border-primary-500 focus:ring-primary-500"
                  :placeholder="t('addresses.labelPh')"
                />
              </div>

              <label class="flex items-center gap-3 text-sm text-gray-700 py-2 min-h-[44px] touch-manipulation">
                <input v-model="form.is_default" type="checkbox" class="rounded border-gray-300 text-primary-600 size-5" />
                {{ t('addresses.setDefault') }}
              </label>
            </form>
          </div>

          <footer
            class="shrink-0 flex gap-2 px-4 pt-2 border-t border-gray-100 bg-white/95 backdrop-blur-sm pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            <button
              type="button"
              class="flex-1 py-3.5 rounded-xl border border-gray-200 font-medium text-gray-800 min-h-[48px] touch-manipulation bg-white hover:bg-gray-50"
              @click="dialog = false"
            >
              {{ t('addresses.cancel') }}
            </button>
            <button
              type="button"
              class="flex-1 py-3.5 rounded-xl bg-primary-600 text-white font-semibold min-h-[48px] touch-manipulation shadow-soft hover:bg-primary-700 active:opacity-95"
              @click="save"
            >
              {{ t('addresses.save') }}
            </button>
          </footer>
        </div>
      </div>
    </Teleport>

    <!-- 删除地址二次确认（非浏览器原生 confirm） -->
    <Teleport to="body">
      <div
        v-if="deleteConfirmOpen"
        class="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="addr-del-title"
        @pointerdown.self="deleteOverlayPointerDown"
        @pointerup.self="deleteOverlayPointerUp"
        @pointercancel.self="deleteOverlayDismissCancel"
      >
        <div
          class="partner-addr-del-sheet w-full max-w-sm sm:max-w-md flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_16px_48px_rgba(0,0,0,0.18)] ring-1 ring-black/5"
          @pointerdown.stop="clearDeleteOverlayDismissArm"
        >
          <div class="px-5 pt-5 pb-3">
            <h2 id="addr-del-title" class="text-base font-semibold text-gray-900">{{ t('addresses.deleteConfirmTitle') }}</h2>
            <p class="mt-2 text-sm text-gray-600 leading-relaxed">{{ t('addresses.deleteConfirmBody') }}</p>
            <p class="mt-3 text-xs text-gray-500 line-clamp-2">{{ pendingDeleteHint }}</p>
          </div>
          <div class="flex border-t border-gray-100">
            <button
              type="button"
              class="flex-1 py-3.5 text-[15px] font-medium text-gray-700 hover:bg-gray-50 min-h-[52px] touch-manipulation disabled:opacity-50"
              :disabled="deleteSubmitting"
              @click="closeDeleteConfirm"
            >
              {{ t('addresses.cancel') }}
            </button>
            <button
              type="button"
              class="flex-1 py-3.5 text-[15px] font-semibold text-red-600 hover:bg-red-50 min-h-[52px] touch-manipulation disabled:opacity-50 border-l border-gray-100"
              :disabled="deleteSubmitting"
              @click="confirmRemove"
            >
              {{ deleteSubmitting ? t('addresses.deleting') : t('addresses.delete') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import config from '../../config/index.js'
import ThailandAddressSelector from '../components/ThailandAddressSelector.vue'
import PhoneCountryCode from '../components/PhoneCountryCode.vue'
import { validatePhoneI18n, formatPhoneDisplay } from '../../portal/utils/phoneValidation.js'
import { usePartnerStore } from '../stores/partner.js'
import { useToast } from '../composables/useToast.js'

const { t, locale } = useI18n()
const store = usePartnerStore()
const toast = useToast()

const loading = ref(true)
const list = ref([])
const dialog = ref(false)
const editId = ref(null)

const deleteConfirmOpen = ref(false)
const pendingDeleteRow = ref(null)
const deleteSubmitting = ref(false)

/** 遮罩关闭：仅当 pointer 在遮罩上按下且在同元素上抬起，避免输入框内拖选松手在遮罩上误关窗 */
const editOverlayDismissArmed = ref(false)
const deleteOverlayDismissArmed = ref(false)

function editOverlayPointerDown (e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  editOverlayDismissArmed.value = e.target === e.currentTarget
}

function editOverlayPointerUp (e) {
  if (editOverlayDismissArmed.value && e.target === e.currentTarget) dialog.value = false
  editOverlayDismissArmed.value = false
}

function editOverlayDismissCancel () {
  editOverlayDismissArmed.value = false
}

function clearEditOverlayDismissArm () {
  editOverlayDismissArmed.value = false
}

function deleteOverlayPointerDown (e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  deleteOverlayDismissArmed.value = e.target === e.currentTarget
}

function deleteOverlayPointerUp (e) {
  if (deleteSubmitting.value) {
    deleteOverlayDismissArmed.value = false
    return
  }
  if (deleteOverlayDismissArmed.value && e.target === e.currentTarget) closeDeleteConfirm()
  deleteOverlayDismissArmed.value = false
}

function deleteOverlayDismissCancel () {
  deleteOverlayDismissArmed.value = false
}

function clearDeleteOverlayDismissArm () {
  deleteOverlayDismissArmed.value = false
}

const pendingDeleteHint = computed(() => {
  const a = pendingDeleteRow.value
  if (!a) return ''
  const summary = `${a.recipient_name} · ${displayPhone(a)}`
  const geo = formatLines(a)
  return geo && geo !== summary ? `${summary} · ${geo.replace(/\n+/g, ' · ')}` : summary
})

function closeDeleteConfirm () {
  deleteOverlayDismissArmed.value = false
  if (deleteSubmitting.value) return
  deleteConfirmOpen.value = false
  pendingDeleteRow.value = null
}

const regionModel = ref({
  province: null,
  district: null,
  subDistrict: null,
  postalCode: ''
})

const form = reactive({
  recipient_name: '',
  phone_country_code: '+66',
  phone: '',
  province: '',
  city: '',
  district: '',
  postal_code: '',
  detail: '',
  label: '',
  is_default: false
})

function displayPhone (a) {
  return formatPhoneDisplay(a.phone, normalizeCc(a.phone_country_code))
}

function normalizeCc (cc) {
  const c = cc != null ? String(cc).trim() : ''
  if (c === '+86' || c === '+66' || c === '+60') return c
  return '+66'
}

function resetRegion () {
  regionModel.value = { province: null, district: null, subDistrict: null, postalCode: '' }
}

function onRegionChange (regionData) {
  form.province = regionData.provinceData?.name ? String(regionData.provinceData.name) : ''
  form.city = regionData.districtData?.name ? String(regionData.districtData.name) : ''
  form.district = regionData.subDistrictData?.name ? String(regionData.subDistrictData.name) : ''
  form.postal_code = regionData.postalCode ? String(regionData.postalCode).trim().slice(0, 10) : ''
}

function formatLines (a) {
  const geoParts = [a.province, a.city, a.district].filter(Boolean)
  let top = geoParts.join(' ')
  const pc = a.postal_code != null ? String(a.postal_code).trim() : ''
  if (pc) top = top ? `${top} ${pc}` : pc
  return [top, a.detail].filter(Boolean).join('\n')
}

async function fetchJsonPath (path) {
  const res = await fetch(config.buildApiUrl(path.startsWith('/') ? path : `/${path}`))
  return res.json()
}


async function resolveSavedToRegionModel (addr) {
  const result = {
    province: null,
    district: null,
    subDistrict: null,
    postalCode: addr.postal_code ? String(addr.postal_code).trim().slice(0, 10) : ''
  }

  const provName = typeof addr?.province === 'string' ? addr.province.trim() : ''
  if (!provName) return result

  const localesTry = [locale.value, 'zh-CN', 'th-TH', 'en-US'].filter((x, i, a) => a.indexOf(x) === i)

  for (const loc of localesTry) {
    const q = encodeURIComponent(loc)
    const pj = await fetchJsonPath(`/administrative-regions/provinces?locale=${q}`)
    if (!pj.success || !Array.isArray(pj.data) || !pj.data.length) continue

    const prov = pj.data.find((x) => x.name === provName)
    if (!prov) continue
    result.province = prov.id

    const dj = await fetchJsonPath(`/administrative-regions/provinces/${prov.id}/districts?locale=${q}`)
    if (!dj.success || !Array.isArray(dj.data) || !dj.data.length) return result

    const cityName = typeof addr.city === 'string' ? addr.city.trim() : ''
    const subName = typeof addr.district === 'string' ? addr.district.trim() : ''

    let amphoeId = null
    if (cityName) amphoeId = dj.data.find((x) => x.name === cityName)?.id ?? null
    else if (subName) amphoeId = dj.data.find((x) => x.name === subName)?.id ?? null

    if (!amphoeId) return result
    result.district = amphoeId

    const sj = await fetchJsonPath(`/administrative-regions/districts/${amphoeId}/sub-districts?locale=${q}`)
    if (!sj.success || !Array.isArray(sj.data) || !sj.data.length) return result

    if (cityName && subName) {
      const tambon = sj.data.find((x) => x.name === subName)
      if (tambon) {
        result.subDistrict = tambon.id
        if (tambon.postal_code) result.postalCode = String(tambon.postal_code).trim().slice(0, 10)
      }
    }
    return result
  }

  return result
}

async function load () {
  loading.value = true
  try {
    const res = await store.api('/addresses')
    const json = await res.json()
    if (json.success) list.value = json.data || []
    else toast.error(json.message || t('addresses.loadFail'))
  } catch {
    toast.error(t('addresses.loadFail'))
  } finally {
    loading.value = false
  }
}

function openCreate () {
  editOverlayDismissArmed.value = false
  editId.value = null
  dialog.value = true
  Object.assign(form, {
    recipient_name: '',
    phone_country_code: '+66',
    phone: '',
    province: '',
    city: '',
    district: '',
    postal_code: '',
    detail: '',
    label: '',
    is_default: list.value.length === 0
  })
  resetRegion()
}

async function openEdit (a) {
  editOverlayDismissArmed.value = false
  editId.value = a.id
  dialog.value = true
  Object.assign(form, {
    recipient_name: a.recipient_name,
    phone_country_code: normalizeCc(a.phone_country_code),
    phone: typeof a.phone === 'string' ? a.phone : '',
    province: typeof a.province === 'string' ? a.province : '',
    city: typeof a.city === 'string' ? a.city : '',
    district: typeof a.district === 'string' ? a.district : '',
    postal_code: typeof a.postal_code === 'string' ? a.postal_code : '',
    detail: a.detail,
    label: a.label || '',
    is_default: !!a.is_default
  })
  regionModel.value = await resolveSavedToRegionModel(a)
}

async function save () {
  if (!form.recipient_name?.trim() || !form.phone?.trim() || !form.detail?.trim()) {
    toast.warning(t('addresses.validation'))
    return
  }
  const pv = validatePhoneI18n(form.phone, form.phone_country_code, t)
  if (!pv.isValid) {
    toast.warning(pv.message)
    return
  }

  if (!form.province?.trim() || !form.city?.trim() || !form.district?.trim() || !String(form.postal_code || '').trim()) {
    toast.warning(t('addresses.regionRequired'))
    return
  }

  const payload = {
    recipient_name: form.recipient_name.trim(),
    phone_country_code: normalizeCc(form.phone_country_code),
    phone: form.phone.replace(/[\s-]/g, '').trim(),
    province: form.province.trim(),
    city: form.city.trim(),
    district: form.district.trim(),
    postal_code: String(form.postal_code).trim().slice(0, 10),
    detail: form.detail.trim(),
    label: form.label?.trim() || null,
    is_default: form.is_default
  }
  try {
    const url = editId.value ? `/addresses/${editId.value}` : '/addresses'
    const method = editId.value ? 'PUT' : 'POST'
    const res = await store.api(url, { method, body: JSON.stringify(payload) })
    const json = await res.json()
    if (!json.success) {
      toast.error(json.message || t('common.error'))
      return
    }
    toast.success(t('addresses.saveOk'))
    dialog.value = false
    await load()
  } catch {
    toast.error(t('common.error'))
  }
}

function remove (a) {
  deleteOverlayDismissArmed.value = false
  pendingDeleteRow.value = a
  deleteConfirmOpen.value = true
}

async function confirmRemove () {
  const a = pendingDeleteRow.value
  if (!a || deleteSubmitting.value) return
  deleteSubmitting.value = true
  try {
    const res = await store.api(`/addresses/${a.id}`, { method: 'DELETE' })
    const json = await res.json()
    if (!json.success) {
      toast.error(json.message || t('common.error'))
      return
    }
    toast.success(t('addresses.deleteOk'))
    closeDeleteConfirm()
    await load()
  } catch {
    toast.error(t('common.error'))
  } finally {
    deleteSubmitting.value = false
  }
}

async function makeDefault (a) {
  try {
    const res = await store.api(`/addresses/${a.id}/default`, { method: 'PUT' })
    const json = await res.json()
    if (!json.success) {
      toast.error(json.message || t('common.error'))
      return
    }
    toast.success(t('addresses.defaultOk'))
    await load()
  } catch {
    toast.error(t('common.error'))
  }
}

onMounted(load)
</script>