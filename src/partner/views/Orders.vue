<template>
  <div class="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
    <header class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="text-lg sm:text-xl font-semibold text-gray-900">{{ t('orders.title') }}</h1>
      </div>
      <button
        type="button"
        class="touch-manipulation min-h-[44px] px-4 rounded-lg border border-gray-200 bg-white text-sm font-medium hover:bg-gray-50"
        :disabled="loading || loadingMore"
        @click="refreshSameRange"
      >
        {{ t('orders.refresh') }}
      </button>
    </header>

    <!-- 下单日期筛选 -->
    <section class="mb-4 rounded-xl border border-gray-100 bg-white p-3 sm:p-4 shadow-soft">
      <p class="text-xs font-medium text-gray-600 mb-2">{{ t('orders.dateRangeLabel') }}</p>
      <div
        class="flex flex-nowrap items-end gap-2 min-w-0 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]"
      >
        <div class="min-w-0 flex-[1_1_0%]">
          <label class="block text-[11px] text-gray-500 mb-1 truncate">{{ t('orders.dateFrom') }}</label>
          <input
            v-model="filterFrom"
            type="date"
            class="w-full max-w-full min-w-0 rounded-lg border border-gray-200 min-h-[44px] px-2 sm:px-3 text-base touch-manipulation box-border"
          />
        </div>
        <div class="min-w-0 flex-[1_1_0%]">
          <label class="block text-[11px] text-gray-500 mb-1 truncate">{{ t('orders.dateTo') }}</label>
          <input
            v-model="filterTo"
            type="date"
            class="w-full max-w-full min-w-0 rounded-lg border border-gray-200 min-h-[44px] px-2 sm:px-3 text-base touch-manipulation box-border"
          />
        </div>
        <button
          type="button"
          class="shrink-0 touch-manipulation min-h-[44px] px-3 sm:px-4 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 whitespace-nowrap"
          :disabled="loading || loadingMore"
          @click="applyFilters"
        >
          {{ t('orders.applyFilter') }}
        </button>
      </div>
    </section>

    <div v-if="loading && !rows.length" class="flex flex-col items-center justify-center py-20 gap-3 text-gray-500">
      <span class="h-10 w-10 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" aria-hidden="true" />
      <span class="text-sm">{{ t('orders.loading') }}</span>
    </div>

    <ul v-else class="space-y-3 pb-8">
      <li v-if="!rows.length" class="text-center py-14 text-gray-500 text-sm">
        {{ t('orders.empty') }}
      </li>
      <li
        v-for="order in rows"
        :key="order.id"
        class="rounded-xl bg-white border border-gray-100 shadow-soft overflow-hidden"
      >
        <details class="group">
          <summary
            class="list-none cursor-pointer touch-manipulation p-4 flex items-center gap-3 [&::-webkit-details-marker]:hidden"
          >
            <div class="flex-1 min-w-0 space-y-2">
              <p class="font-mono text-[13px] sm:text-sm text-gray-900 break-all">{{ order.order_no }}</p>
              <p class="text-xs text-gray-600 whitespace-pre-wrap">
                <span class="font-medium text-gray-500">{{ t('orders.placedAt') }}：</span>{{ formatDt(order.created_at) }}
              </p>
              <p v-if="order.delivery_address" class="text-xs text-gray-600 whitespace-pre-wrap">
                <span class="font-medium text-gray-500">{{ t('orders.delivery') }}：</span>{{ order.delivery_address }}
              </p>
            </div>
            <div class="text-right shrink-0 max-w-[40%]">
              <p class="text-base font-semibold text-primary-700 tabular-nums">฿{{ money(order.total_amount_thb) }}</p>
              <span
                class="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium"
                :class="statusClass(order.status)"
              >
                {{ statusLabel(order.status) }}
              </span>
              <button
                v-if="order.status === 'pending_payment'"
                type="button"
                class="mt-2 touch-manipulation block w-full rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700"
                @click.prevent.stop="openPayForOrder(order)"
              >
                {{ t('orders.goPay') }}
              </button>
            </div>
            <ChevronDownIcon class="w-5 h-5 text-gray-400 shrink-0 transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div class="px-4 pb-4 border-t border-gray-50 bg-gray-50/70">
            <ul class="divide-y divide-gray-100 rounded-lg mt-3 bg-white ring-1 ring-gray-100">
              <li v-for="it in order.items || []" :key="it.id" class="p-3 sm:p-4 flex gap-3 text-sm">
                <div class="shrink-0 w-14 h-14 rounded-lg bg-gray-100 overflow-hidden ring-1 ring-gray-100">
                  <img
                    v-if="itemImg(it)"
                    :src="itemImg(it)"
                    alt=""
                    class="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div class="min-w-0 flex-1 flex flex-col xs:flex-row xs:justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <p class="font-medium text-gray-900 line-clamp-2">
                      {{ it.product_name_snapshot || `${t('orders.unnamedProduct')} #${it.product_id}` }}
                    </p>
                    <p class="text-xs text-gray-500 mt-0.5">{{ t('orders.sku') }} {{ it.product_id }}</p>
                  </div>
                  <div class="text-left xs:text-right shrink-0 text-gray-700">
                    <p>
                      × {{ it.quantity }} · ฿{{ money(it.unit_price_thb) }}{{ t('orders.unit') }}
                    </p>
                    <p class="font-semibold text-gray-900">{{ t('orders.subtotal') }} ฿{{ money(it.line_total_thb) }}</p>
                  </div>
                </div>
              </li>
              <li v-if="!(order.items && order.items.length)" class="p-6 text-center text-gray-400 text-sm">
                {{ t('orders.noItems') }}
              </li>
            </ul>
          </div>
        </details>
      </li>
    </ul>

    <div v-if="loadingMore" class="flex justify-center py-4 text-sm text-gray-500">
      {{ t('orders.loadingMore') }}
    </div>
    <div v-else-if="rows.length && !hasMore" class="text-center py-3 text-xs text-gray-400">
      {{ t('orders.allLoaded') }}
    </div>

    <PartnerOnlinePayModal
      v-model="payModalOpen"
      :total-thb="payModalThb"
      :qr-path="payQRPath || ''"
      :exchange-rate-usd="payExchangeUsd"
      :confirming="payConfirming"
      @cancel="closePayModalOnly"
      @confirm="confirmPartnerOrderPay"
      @qr-error="onPayQrError"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDownIcon } from '@heroicons/vue/24/outline'
import config from '../../config/index.js'
import { usePartnerStore } from '../stores/partner.js'
import { useToast } from '../composables/useToast.js'
import PartnerOnlinePayModal from '../components/PartnerOnlinePayModal.vue'

const PAGE_SIZE = 5

const { t, locale } = useI18n()
const partnerStore = usePartnerStore()
const toast = useToast()

const loading = ref(false)
const loadingMore = ref(false)
const rows = ref([])
const page = ref(1)
const total = ref(0)
const filterFrom = ref('')
const filterTo = ref('')
const sentinelRef = ref(null)

const payModalOpen = ref(false)
const payModalOrderId = ref(null)
const payModalThb = ref(0)
const payQRPath = ref(null)
const payExchangeUsd = ref(0)
const payConfirming = ref(false)

let io = null
let ioCooldown = false

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const hasMore = computed(() => page.value < totalPages.value)

function pad2 (n) {
  return String(n).padStart(2, '0')
}

/** 与服务端默认一致：UTC 日历日，同日向前推 3 个自然月 */
function defaultUtcRangeStrings () {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  const fromDate = new Date(Date.UTC(y, m - 3, d))
  return {
    from: `${fromDate.getUTCFullYear()}-${pad2(fromDate.getUTCMonth() + 1)}-${pad2(fromDate.getUTCDate())}`,
    to: `${y}-${pad2(m + 1)}-${pad2(d)}`
  }
}

function money (v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

function itemImg (it) {
  const p = it.product_image_snapshot
  if (!p) return ''
  return config.buildStaticUrl(p)
}

function formatDt (raw) {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return String(raw)
  try {
    return new Intl.DateTimeFormat(locale.value === 'th-TH' ? 'th-TH' : locale.value === 'en-US' ? 'en-GB' : 'zh-CN', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(d)
  } catch {
    return d.toLocaleString()
  }
}

function statusClass (status) {
  const map = {
    pending_payment: 'bg-yellow-100 text-yellow-900',
    submitted: 'bg-amber-100 text-amber-800',
    processing: 'bg-blue-100 text-blue-800',
    shipped: 'bg-indigo-100 text-indigo-800',
    settled: 'bg-emerald-100 text-emerald-800',
    cancelled: 'bg-gray-200 text-gray-700'
  }
  return map[status] || 'bg-gray-100 text-gray-700'
}

function statusLabel (status) {
  const key = `orders.status.${status}`
  const s = t(key)
  return s === key ? String(status || '—') : s
}

async function loadPublicPaymentConfigPay () {
  try {
    const response = await fetch(config.buildApiUrl('/api/system-config/public'))
    if (!response.ok) return
    const data = await response.json()
    if (data.success && data.data) {
      payQRPath.value = data.data.payment_qrcode
      payExchangeUsd.value =
        parseFloat(data.data.exchange_rate ?? data.data.exchange_rates?.USD ?? '0') || 0
    }
  } catch {
    /* ignore */
  }
}

function onPayQrError () {
  payQRPath.value = null
}

function openPayForOrder (order) {
  payModalOrderId.value = order.id
  const thb = parseFloat(order.total_amount_thb)
  payModalThb.value = Number.isFinite(thb) ? thb : 0
  loadPublicPaymentConfigPay()
  payModalOpen.value = true
}

function closePayModalOnly () {
  payModalOpen.value = false
}

async function confirmPartnerOrderPay () {
  const oid = payModalOrderId.value
  if (!oid) return
  payConfirming.value = true
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
    payModalOpen.value = false
    payModalOrderId.value = null
    toast.success(t('payment.complete'))
    await loadFirstPage()
  } finally {
    payConfirming.value = false
  }
}

function disconnectIo () {
  if (io) {
    io.disconnect()
    io = null
  }
}

function setupIo () {
  disconnectIo()
  const el = sentinelRef.value
  if (!el) return
  io = new IntersectionObserver(
    (entries) => {
      const hit = entries.some((e) => e.isIntersecting)
      if (!hit || ioCooldown) return
      if (!hasMore.value || loading.value || loadingMore.value) return
      ioCooldown = true
      loadNextPage().finally(() => {
        setTimeout(() => {
          ioCooldown = false
        }, 200)
      })
    },
    { root: null, rootMargin: '160px', threshold: 0 }
  )
  io.observe(el)
}

async function fetchOrders (append) {
  if (!filterFrom.value || !filterTo.value) {
    const d = defaultUtcRangeStrings()
    filterFrom.value = d.from
    filterTo.value = d.to
  }

  if (append) loadingMore.value = true
  else loading.value = true

  try {
    const q = new URLSearchParams({
      page: String(page.value),
      pageSize: String(PAGE_SIZE),
      from: filterFrom.value,
      to: filterTo.value
    })
    const res = await partnerStore.api(`/orders?${q}`)
    const json = await res.json()
    if (!json.success) {
      toast.error(json.message || t('common.error'))
      if (!append) {
        rows.value = []
        total.value = 0
      }
      return
    }
    const list = json.data.orders || []
    total.value = json.data.pagination?.total ?? 0
    if (append) rows.value = rows.value.concat(list)
    else rows.value = list
  } catch {
    toast.error(t('common.error'))
    if (!append) {
      rows.value = []
      total.value = 0
    }
  } finally {
    if (append) loadingMore.value = false
    else loading.value = false
    await nextTick()
    setupIo()
  }
}

async function loadFirstPage () {
  page.value = 1
  await fetchOrders(false)
  await nextTick()
  await fillShortViewport()
}

async function loadNextPage () {
  if (!hasMore.value || loading.value || loadingMore.value) return
  page.value += 1
  await fetchOrders(true)
  await nextTick()
  await fillShortViewport()
}

/** 首屏项少、哨兵已在视口内时连拉几页，避免必须微动才翻页 */
async function fillShortViewport () {
  let guard = 0
  while (guard++ < 12 && hasMore.value && !loading.value && !loadingMore.value) {
    const el = sentinelRef.value
    if (!el) break
    const r = el.getBoundingClientRect()
    if (r.top > window.innerHeight + 200) break
    page.value += 1
    await fetchOrders(true)
    await nextTick()
  }
}

function applyFilters () {
  if (!filterFrom.value || !filterTo.value) {
    toast.warning(t('orders.dateRequired'))
    return
  }
  loadFirstPage()
}

function refreshSameRange () {
  loadFirstPage()
}

onMounted(async () => {
  const d = defaultUtcRangeStrings()
  filterFrom.value = d.from
  filterTo.value = d.to
  await loadFirstPage()
})

onUnmounted(() => {
  disconnectIo()
})
</script>
