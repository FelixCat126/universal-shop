<template>
  <div class="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
    <div class="grid grid-cols-1 lg:grid-cols-5 gap-4 lg:gap-6">
      <!-- 移动端：商品在上；lg 仍为左栏 -->
      <section class="lg:col-span-3 space-y-3 sm:space-y-4 order-1 lg:order-1">
        <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 bg-white rounded-xl border border-gray-100 shadow-soft p-3 sm:p-4">
          <h2 class="text-base sm:text-lg font-semibold text-gray-900 shrink-0">
            {{ t('shop.title') }}
          </h2>
          <div class="flex-1 flex flex-col xs:flex-row gap-2 min-w-0">
            <input
              v-model.trim="keyword"
              type="search"
              enterkeyhint="search"
              :placeholder="t('shop.search')"
              class="flex-1 rounded-lg border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-base py-2.5 px-3"
              @keyup.enter="runSearch"
            />
            <button
              type="button"
              class="touch-manipulation min-h-[44px] px-4 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 sm:shrink-0"
              @click="runSearch"
            >
              {{ t('shop.searchBtn') }}
            </button>
          </div>
        </div>

        <div
          v-if="isAgent"
          class="rounded-xl border border-amber-200 bg-amber-50 text-amber-950 px-3 py-2.5 text-xs sm:text-sm leading-relaxed shadow-soft"
          role="status"
        >
          {{ t('shop.agentRuleBanner') }}
        </div>

        <!-- 分类 Tab（与零售门户首页一致：横滑滚动；列表区单独支持左右滑切换分类） -->
        <div
          v-if="categories.length"
          class="sticky top-0 z-20 -mx-3 sm:-mx-4 mb-3 px-3 sm:px-4 py-2 bg-gray-50/95 backdrop-blur-md border-b border-gray-200/90 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
        >
          <div
            class="flex gap-2 overflow-x-auto overflow-y-hidden pb-1 -mx-1 px-1 touch-pan-x [scrollbar-width:thin]"
          >
            <button
              v-for="c in categories"
              :key="c.id"
              type="button"
              class="shrink-0 px-4 py-2 rounded-full text-sm font-medium border transition-colors whitespace-nowrap touch-manipulation"
              :class="Number(selectedCategoryId) === Number(c.id)
                ? 'bg-blue-600 text-white border-blue-600 shadow'
                : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'"
              @click="selectCategory(c.id)"
            >
              {{ categoryTabLabel(c) }}
            </button>
          </div>
        </div>

        <!-- 商品列表区：左右滑切换分类（Tab 条仅横向滚动，手势不在该条上触发） -->
        <section
          class="partner-product-swipe-zone min-h-[8rem]"
          @touchstart.passive="onProductAreaTouchStart"
          @touchend.passive="onProductAreaTouchEnd"
        >
          <div v-if="loading" class="flex flex-col items-center justify-center py-16 text-gray-500 gap-3">
            <span class="h-10 w-10 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" aria-hidden="true" />
            <span class="text-sm">{{ t('shop.loading') }}</span>
          </div>

          <ul v-else class="space-y-3">
            <li
              v-for="row in products"
              :key="row.id"
              class="bg-white rounded-xl border border-gray-100 shadow-soft overflow-hidden flex flex-col xs:flex-row xs:items-stretch gap-3 p-3 sm:p-4"
            >
              <div class="shrink-0 flex xs:block justify-center">
                <div class="w-24 h-24 sm:w-28 sm:h-28 rounded-lg bg-gray-100 overflow-hidden ring-1 ring-gray-100">
                  <img
                    v-if="imgUrl(row.image)"
                    :src="imgUrl(row.image)"
                    alt=""
                    class="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div v-else class="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                    {{ t('shop.noImage') }}
                  </div>
                </div>
              </div>
              <div class="flex-1 min-w-0 flex flex-col gap-2">
                <h3 class="font-semibold text-gray-900 text-[15px] sm:text-base leading-snug">{{ row.name || '-' }}</h3>
                <p class="text-sm text-gray-600">
                  <span class="font-medium text-primary-700">{{ thbMoney(row.unit_price_thb) }}</span>
                </p>
                <p class="text-xs text-gray-500">
                  {{ t('shop.cartHint', { min: moqU(row), step: moqM(row) }) }}
                </p>
                <div class="flex flex-wrap items-end gap-2 sm:gap-3 mt-auto pt-1">
                  <div class="w-full xs:w-auto xs:min-w-[8rem]">
                    <label class="sr-only">{{ t('shop.qty') }}</label>
                    <input
                      v-model.number="row._qty"
                      type="number"
                      :min="moqU(row)"
                      :step="moqM(row)"
                      inputmode="numeric"
                      class="block w-full rounded-lg border-gray-300 text-base py-2.5 px-3 focus:border-primary-500 focus:ring-primary-500 touch-manipulation"
                    />
                  </div>
                  <button
                    type="button"
                    class="touch-manipulation min-h-[44px] flex-1 xs:flex-none px-4 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700"
                    @click="add(row)"
                  >
                    {{ t('shop.addCart') }}
                  </button>
                </div>
              </div>
            </li>
            <li v-if="!products.length" class="text-center py-14 text-gray-500 text-sm">{{ t('shop.noProducts') }}</li>
          </ul>

          <div v-if="total > pageSize" class="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p class="text-xs text-gray-500">
              {{ t('shop.pagination', { total, page, pages: totalPages }) }}
            </p>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="touch-manipulation min-h-[44px] px-4 rounded-lg border border-gray-200 bg-white text-sm font-medium disabled:opacity-45"
                :disabled="page <= 1 || loading"
                @click="prevPage"
              >
                {{ t('shop.prev') }}
              </button>
              <button
                type="button"
                class="touch-manipulation min-h-[44px] px-4 rounded-lg border border-gray-200 bg-white text-sm font-medium disabled:opacity-45"
                :disabled="page >= totalPages || loading"
                @click="nextPage"
              >
                {{ t('shop.next') }}
              </button>
            </div>
          </div>
        </section>
      </section>

      <!-- 移动端：订货清单与结算在底部；lg 仍为右侧栏 -->
      <aside class="lg:col-span-2 order-2 lg:order-2">
        <div
          class="space-y-3 lg:sticky lg:top-[4.75rem]"
          :style="{ paddingBottom: 'max(0px, env(safe-area-inset-bottom, 0px))' }"
        >
          <div class="bg-white rounded-xl border border-gray-100 shadow-soft p-3 sm:p-4">
            <h2 class="text-base font-semibold text-gray-900 mb-1">{{ t('shop.cartTitle') }}</h2>
            <ul v-if="partnerStore.cart.length" class="divide-y divide-gray-100 max-h-[40vh] lg:max-h-none overflow-y-auto overscroll-contain">
              <li v-for="line in partnerStore.cart" :key="line.product_id" class="flex flex-col gap-3 py-3 first:pt-0">
                <div class="flex gap-3 min-w-0">
                  <div class="w-14 h-14 rounded-lg bg-gray-100 overflow-hidden shrink-0 ring-1 ring-gray-100">
                    <img v-if="imgUrl(line.image)" :src="imgUrl(line.image)" alt="" class="w-full h-full object-cover" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="font-medium text-gray-900 text-sm truncate">{{ line.name }}</p>
                    <p class="text-xs text-gray-500">{{ thbMoney(line.unit_price_thb) }} × {{ line.quantity }}</p>
                  </div>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                  <label class="text-xs text-gray-500 whitespace-nowrap">{{ t('shop.qty') }}</label>
                  <input
                    v-model.number="line.quantity"
                    type="number"
                    :min="moqU(line)"
                    :step="moqM(line)"
                    inputmode="numeric"
                    class="w-full xs:w-28 rounded-lg border-gray-300 text-sm py-2 px-2 focus:border-primary-500 focus:ring-primary-500 touch-manipulation"
                    @change="chgQtyCommit(line)"
                  />
                  <button type="button" class="text-sm text-red-600 font-medium touch-manipulation px-2 min-h-[44px]" @click="partnerStore.removeFromCart(line.product_id)">
                    {{ t('shop.remove') }}
                  </button>
                </div>
              </li>
            </ul>
            <p v-else class="text-center py-8 text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg">{{ t('shop.cartEmpty') }}</p>
            <div class="mt-4 pt-3 border-t border-gray-100">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-sm text-gray-600">{{ t('shop.estTotal') }}</span>
                <div class="text-right">
                  <strong class="text-xl text-primary-700 tabular-nums">{{ thbMoney(cartSum) }}</strong>
                </div>
              </div>
            </div>
          </div>

          <div class="bg-white rounded-xl border border-gray-100 shadow-soft p-3 sm:p-4 space-y-3">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <h3 class="text-sm font-semibold text-gray-900">{{ t('shop.addressTitle') }}</h3>
              <router-link to="/addresses" class="text-xs font-medium text-primary-600">{{ t('shop.manageAddresses') }}</router-link>
            </div>
            <p class="text-xs text-gray-500">{{ t('shop.addressHint') }}</p>
            <div v-if="addresses.length">
              <label class="block text-xs font-medium text-gray-600 mb-1">{{ t('shop.selectAddress') }}</label>
              <select v-model.number="selectedAddressId" class="w-full rounded-lg border-gray-300 text-base py-2.5 px-3 touch-manipulation">
                <option v-for="a in addresses" :key="a.id" :value="a.id">{{ addressOneLine(a) }}</option>
              </select>
              <pre v-if="selectedAddress" class="mt-2 text-xs text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-2 border border-gray-100">{{ formatAddressFull(selectedAddress) }}</pre>
            </div>
            <p v-else class="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-3">{{ t('shop.noAddress') }}</p>
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">{{ t('shop.notes') }}</label>
              <textarea v-model="checkout.notes" rows="2" :placeholder="t('shop.notesPh')" class="block w-full rounded-lg border-gray-300 text-base py-2.5 px-3" />
            </div>
            <button
              type="button"
              :disabled="submitting || !partnerStore.cart.length || !selectedAddressId || (isAgent && cartDistinctSku > 3)"
              class="w-full touch-manipulation min-h-[48px] rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2"
              @click="openConfirm"
            >
              {{ t('shop.submit') }}
            </button>
          </div>
        </div>
      </aside>
    </div>

    <Teleport to="body">
      <div
        v-if="confirmOpen"
        class="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
        @click.self="confirmOpen = false"
      >
        <div
          class="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-strong"
          :style="{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }"
          @click.stop
        >
          <h3 class="text-lg font-semibold text-gray-900">{{ t('shop.confirmTitle') }}</h3>
          <p class="text-xs text-gray-500 mt-1">{{ t('shop.confirmHint') }}</p>
          <div class="mt-4 space-y-2">
            <p class="text-xs font-medium text-gray-600">{{ t('shop.confirmAddress') }}</p>
            <pre class="text-sm text-gray-800 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 border border-gray-100">{{ selectedAddress ? formatAddressFull(selectedAddress) : '' }}</pre>
          </div>
          <div class="mt-4">
            <p class="text-xs font-medium text-gray-600 mb-2">{{ t('shop.confirmItems') }}</p>
            <ul class="space-y-2 max-h-48 overflow-y-auto">
              <li v-for="line in partnerStore.cart" :key="line.product_id" class="flex gap-2 text-sm border-b border-gray-100 pb-2">
                <img v-if="imgUrl(line.image)" :src="imgUrl(line.image)" class="w-10 h-10 rounded object-cover shrink-0" alt="" />
                <div class="min-w-0 flex-1">
                  <p class="font-medium truncate">{{ line.name }}</p>
                  <p class="text-xs text-gray-500">× {{ line.quantity }} · {{ thbMoney(line.unit_price_thb) }}</p>
                </div>
              </li>
            </ul>
            <p class="mt-2 text-right text-sm text-gray-700">
              {{ t('shop.estTotal') }} <strong class="text-primary-700">{{ thbMoney(cartSum) }}</strong>
            </p>
          </div>
          <div class="mt-5 flex gap-2">
            <button type="button" class="flex-1 py-3 rounded-xl border border-gray-200 font-medium touch-manipulation" @click="confirmOpen = false">
              {{ t('shop.confirmCancel') }}
            </button>
            <button type="button" class="flex-1 py-3 rounded-xl bg-green-600 text-white font-semibold touch-manipulation" :disabled="submitting" @click="doSubmit">
              {{ submitting ? t('shop.submitting') : t('shop.confirmOk') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <PartnerOnlinePayModal
      v-model="showPaymentModal"
      :total-thb="paidOrderThb"
      :qr-path="paymentQRCode || ''"
      :exchange-rate-usd="exchangeRateUsd"
      :confirming="submittingPay"
      @cancel="onAgentPayCancel"
      @confirm="finishAgentPaymentUi"
      @qr-error="handleQRCodeError"
    />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import config from '../../config/index.js'
import { formatPhoneDisplay } from '../../portal/utils/phoneValidation.js'
import { usePartnerStore } from '../stores/partner.js'
import { useToast } from '../composables/useToast.js'
import PartnerOnlinePayModal from '../components/PartnerOnlinePayModal.vue'

const { t } = useI18n()
const router = useRouter()
const partnerStore = usePartnerStore()
const toast = useToast()

const loading = ref(false)
const submitting = ref(false)
const products = ref([])
const keyword = ref('')
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const categories = ref([])
const selectedCategoryId = ref(null)
const productSwipeStart = ref({ x: 0, y: 0 })
const addresses = ref([])
const selectedAddressId = ref(null)
const confirmOpen = ref(false)
const showPaymentModal = ref(false)
const paymentQRCode = ref(null)
const exchangeRateUsd = ref(0)
const paidOrderThb = ref(0)
const pendingPartnerOrderId = ref(null)
const submittingPay = ref(false)

const checkout = reactive({ notes: '' })

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const cartSum = computed(() => partnerStore.cart.reduce((s, l) => s + Number(l.unit_price_thb) * Number(l.quantity), 0))
const isAgent = computed(() => partnerStore.isAgentPartner())
const cartDistinctSku = computed(() => new Set(partnerStore.cart.map((c) => c.product_id)).size)

const selectedAddress = computed(() => addresses.value.find((a) => a.id === selectedAddressId.value) || null)

function moqU (row) {
  return Math.max(1, Number(row.moq_unit) || 50)
}
function moqM (row) {
  return Math.max(1, Number(row.moq_multiplier) || 1)
}

function money (v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

function thbMoney (v) {
  return `฿${money(v)}`
}

function imgUrl (p) {
  if (!p) return ''
  return config.buildStaticUrl(p)
}

function partnerPhoneCc (a) {
  const c = a?.phone_country_code != null ? String(a.phone_country_code).trim() : ''
  if (c === '+86' || c === '+66' || c === '+60') return c
  return '+66'
}

function addressOneLine (a) {
  const tag = a.label ? `[${a.label}] ` : ''
  return `${tag}${a.recipient_name} · ${formatPhoneDisplay(a.phone, partnerPhoneCc(a))}`
}

function formatAddressFull (a) {
  if (!a) return ''
  const head = `${a.recipient_name}  ${formatPhoneDisplay(a.phone, partnerPhoneCc(a))}`
  const geoParts = [a.province, a.city, a.district].filter(Boolean)
  let geoLine = geoParts.join(' ')
  const pc = a.postal_code != null ? String(a.postal_code).trim() : ''
  if (pc) geoLine = geoLine ? `${geoLine} ${pc}` : pc
  return [head, geoLine, a.detail].filter(Boolean).join('\n')
}

async function loadCategories () {
  try {
    const res = await fetch(config.buildApiUrl('/api/product-categories'))
    if (!res.ok) return
    const json = await res.json()
    if (!json.success || !Array.isArray(json.data)) return
    categories.value = json.data
    const ids = categories.value.map((c) => Number(c.id)).filter((n) => Number.isFinite(n))
    if (!ids.length) return
    const cur = selectedCategoryId.value
    if (cur == null || !ids.includes(Number(cur))) {
      selectedCategoryId.value = ids[0]
    }
  } catch {
    /* ignore */
  }
}

function categoryTabLabel (c) {
  return c?.name != null ? String(c.name) : ''
}

async function selectCategory (id) {
  const n = Number(id)
  if (!Number.isFinite(n) || selectedCategoryId.value === n) return
  selectedCategoryId.value = n
  page.value = 1
  await load()
}

const onProductAreaTouchStart = (e) => {
  const touch = e.touches?.[0] ?? e.changedTouches?.[0]
  if (!touch) return
  productSwipeStart.value = { x: touch.clientX, y: touch.clientY }
}

const onProductAreaTouchEnd = (e) => {
  if (categories.value.length < 2 || selectedCategoryId.value == null) return
  const touch = e.changedTouches?.[0]
  if (!touch) return
  const dx = touch.clientX - productSwipeStart.value.x
  const dyAbs = Math.abs(touch.clientY - productSwipeStart.value.y)
  if (Math.abs(dx) < 52 || dyAbs > 90) return
  const idx = categories.value.findIndex((c) => Number(c.id) === Number(selectedCategoryId.value))
  if (idx < 0) return
  if (dx < 0 && idx < categories.value.length - 1) {
    selectCategory(categories.value[idx + 1].id)
  } else if (dx > 0 && idx > 0) {
    selectCategory(categories.value[idx - 1].id)
  }
}

async function loadAddresses () {
  try {
    const res = await partnerStore.api('/addresses')
    const json = await res.json()
    if (!json.success) return
    addresses.value = json.data || []
    if (!selectedAddressId.value && addresses.value.length) {
      const def = addresses.value.find((x) => x.is_default)
      selectedAddressId.value = (def || addresses.value[0]).id
    }
  } catch {
    /* ignore */
  }
}

async function load () {
  loading.value = true
  try {
    const q = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize.value) })
    if (keyword.value.trim()) q.set('name', keyword.value.trim())
    if (categories.value.length && selectedCategoryId.value != null) {
      q.set('category_id', String(selectedCategoryId.value))
    }
    const res = await partnerStore.api(`/products?${q.toString()}`)
    const json = await res.json()
    if (!json.success) {
      toast.error(json.message || t('common.error'))
      return
    }
    products.value = (json.data.products || []).map((p) => ({
      ...p,
      _qty: moqU(p)
    }))
    total.value = json.data.pagination?.total ?? 0
  } finally {
    loading.value = false
  }
}

function runSearch () {
  page.value = 1
  load()
}

function prevPage () {
  page.value = Math.max(1, page.value - 1)
  load()
}

function nextPage () {
  page.value = Math.min(totalPages.value, page.value + 1)
  load()
}

function add (row) {
  const q = typeof row._qty === 'number' ? row._qty : parseInt(row._qty, 10)
  const r = partnerStore.addToCart(row, q)
  if (!r.ok) {
    toast.warning(r.code === 'AGENT_MAX_3_SKU' ? t('shop.agentMaxSkuExceeded') : r.message)
    return
  }
  toast.success(t('shop.cartAdded'))
}

function chgQtyCommit (line) {
  const r = partnerStore.updateCartQty(line, line.quantity)
  if (!r.ok) toast.warning(r.message)
}

function openConfirm () {
  if (!selectedAddressId.value) {
    toast.warning(t('shop.noAddress'))
    return
  }
  if (partnerStore.isAgentPartner() && cartDistinctSku.value > 3) {
    toast.warning(t('shop.agentMaxSkuExceeded'))
    return
  }
  confirmOpen.value = true
}

async function loadPublicPaymentConfig () {
  try {
    const response = await fetch(config.buildApiUrl('/api/system-config/public'))
    if (!response.ok) return
    const data = await response.json()
    if (data.success && data.data) {
      paymentQRCode.value = data.data.payment_qrcode
      exchangeRateUsd.value = parseFloat(data.data.exchange_rate ?? data.data.exchange_rates?.USD ?? '0') || 0
    }
  } catch {
    /* silent */
  }
}

function handleQRCodeError () {
  paymentQRCode.value = null
}

async function finishAgentPaymentUi () {
  const oid = pendingPartnerOrderId.value
  if (!oid) {
    showPaymentModal.value = false
    return
  }
  submittingPay.value = true
  try {
    const res = await partnerStore.api(`/orders/${oid}/confirm-payment`, {
      method: 'POST',
      body: '{}'
    })
    const json = await res.json()
    if (!json.success) {
      toast.error(json.message || t('common.error'))
      return
    }
    pendingPartnerOrderId.value = null
    showPaymentModal.value = false
    paymentQRCode.value = null
    toast.success(t('payment.complete'))
    router.push('/orders')
  } finally {
    submittingPay.value = false
  }
}

function onAgentPayCancel () {
  showPaymentModal.value = false
  router.push('/orders')
}

async function doSubmit () {
  submitting.value = true
  try {
    const body = {
      partner_address_id: selectedAddressId.value,
      items: partnerStore.cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity })),
      notes: checkout.notes
    }
    const res = await partnerStore.api('/orders', { method: 'POST', body: JSON.stringify(body) })
    const json = await res.json()
    if (!json.success) {
      toast.error(json.message || t('common.error'))
      return
    }
    partnerStore.cart.splice(0)
    checkout.notes = ''
    confirmOpen.value = false
    const agent = partnerStore.isAgentPartner()
    const totalStr = json.data?.total_amount_thb
    const thb = parseFloat(totalStr)
    if (agent) {
      paidOrderThb.value = Number.isFinite(thb) ? thb : 0
      pendingPartnerOrderId.value = json.data?.id ?? null
      await loadPublicPaymentConfig()
      showPaymentModal.value = true
      toast.success(t('shop.orderPendingPay'))
      return
    }
    toast.success(t('shop.orderOk'))
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  await partnerStore.refreshProfile()
  await loadAddresses()
  await loadCategories()
  load()
})
</script>
