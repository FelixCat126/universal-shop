<template>
  <div class="notifications-page max-w-3xl mx-auto px-3 sm:px-6 py-6">
    <!-- 标题区 -->
    <div class="flex items-center justify-between gap-3 mb-4">
      <h1 class="text-lg sm:text-xl font-bold text-gray-900">{{ t('notifications.title') }}</h1>
      <div class="flex items-center gap-2">
        <button
          v-if="unread > 0"
          type="button"
          class="px-3 py-2 text-xs sm:text-sm border border-gray-300 rounded-md hover:bg-gray-50 min-h-[44px]"
          @click="markAllRead"
        >
          {{ t('notifications.markAllRead') }}
        </button>
      </div>
    </div>

    <!-- 未读提示 -->
    <p v-if="unread > 0" class="mb-4 text-sm text-gray-600">
      {{ t('notifications.unreadCount', { count: unread }) }}
    </p>

    <!-- 列表 -->
    <div v-if="loading" class="py-16 text-center text-gray-500">
      {{ t('common.loading') }}
    </div>

    <div
      v-else-if="rows.length === 0"
      class="py-16 text-center text-gray-500 bg-white rounded-lg border border-gray-100"
    >
      {{ t('notifications.empty') }}
    </div>

    <ul v-else class="space-y-2">
      <li
        v-for="n in rows"
        :key="n.id"
        class="rounded-lg border bg-white p-3 sm:p-4 transition-colors"
        :class="n.is_read ? 'border-gray-100' : 'border-blue-200 bg-blue-50/40'"
      >
        <div class="flex items-start gap-3">
          <span
            class="mt-1.5 h-2 w-2 rounded-full shrink-0"
            :class="n.is_read ? 'bg-gray-300' : 'bg-blue-500'"
            aria-hidden="true"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm sm:text-base font-medium text-gray-900">
              {{ contentOf(n).title }}
            </p>
            <p v-if="contentOf(n).body" class="mt-1 text-xs sm:text-sm text-gray-600 leading-relaxed">
              {{ contentOf(n).body }}
            </p>
            <p class="mt-1.5 text-xs text-gray-400">
              {{ formatTime(n.created_at) }}
              <span v-if="n.link && !n.is_read" class="ml-2">
                <button
                  type="button"
                  class="text-blue-600 underline hover:text-blue-700"
                  @click="open(n)"
                >{{ t('notifications.viewDetail') }}</button>
              </span>
            </p>
          </div>
        </div>
      </li>
    </ul>

    <!--
      分页：门户端**不用 Element Plus**（三端里只有 admin 用了它）——
      这里如果写 <el-pagination>，组件未注册 → 渲染抛错 → 整个门户崩进兜底遮罩。
      所以用原生按钮。
    -->
    <div v-if="total > pageSize" class="mt-4 flex items-center justify-center gap-3">
      <button
        type="button"
        class="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="page <= 1"
        @click="goToPage(page - 1)"
      >
        {{ t('common.previous') }}
      </button>
      <span class="text-sm text-gray-600">{{ page }} / {{ totalPages }}</span>
      <button
        type="button"
        class="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        :disabled="page >= totalPages"
        @click="goToPage(page + 1)"
      >
        {{ t('common.next') }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { notificationAPI } from '../api/notifications.js'
import { formatAmountWithSymbol } from '../../shared/money.js'

const router = useRouter()
const { t, locale } = useI18n()

const rows = ref([])
const loading = ref(false)
const unread = ref(0)
const page = ref(1)
const pageSize = 20
const total = ref(0)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))

const goToPage = (p) => {
  if (p < 1 || p > totalPages.value) return
  page.value = p
  load()
}

/**
 * 把通知渲染成文案。
 *
 * 为什么在前端渲染（而不是后端存字符串）：
 * 后端**没有 i18n 框架**，存字符串会导致通知只有一种语言 ——
 * 泰国用户会收到中文通知。所以后端只存结构化数据（type + data），
 * 这里按当前 locale 渲染。
 */
function contentOf (n) {
  const d = n.data || {}
  switch (n.type) {
    case 'order_status': {
      const statusKey = `notifications.orderStatus.${d.status}`
      const title = t(statusKey, {
        order_no: d.order_no || '',
        amount: d.amount != null ? formatAmountWithSymbol(d.amount, '฿') : ''
      })
      const body = d.tracking_number
        ? t('notifications.orderStatus.tracking', { tracking: d.tracking_number })
        : ''
      return { title, body }
    }
    case 'after_sale': {
      const statusKey = `notifications.afterSale.${d.status}`
      return {
        title: t(statusKey, { order_no: d.order_no || '' }),
        body: t('notifications.afterSale.hint')
      }
    }
    case 'points': {
      const delta = Number(d.delta) || 0
      return {
        title: t('notifications.points.title', { points: Math.abs(delta) }),
        body: t('notifications.points.hint')
      }
    }
    case 'coupon': {
      return {
        title: t('notifications.coupon.title', { name: d.template_name || '' }),
        body: t('notifications.coupon.hint')
      }
    }
    case 'payment': {
      return {
        title: t('notifications.payment.title', { order_no: d.order_no || '' }),
        body: t('notifications.payment.hint')
      }
    }
    default:
      return { title: t('notifications.system.title'), body: d.message || '' }
  }
}

const formatTime = (v) => {
  if (!v) return '-'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  // 按界面语言格式化（而不是跟随浏览器语言）
  const loc = locale.value === 'th-TH' ? 'th-TH' : (locale.value === 'en-US' ? 'en-GB' : 'zh-CN')
  try {
    return new Intl.DateTimeFormat(loc, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(d)
  } catch {
    return d.toLocaleString()
  }
}

async function load () {
  loading.value = true
  try {
    const res = await notificationAPI.list({ page: page.value, pageSize })
    const data = res.data?.data || {}
    rows.value = Array.isArray(data.notifications) ? data.notifications : []
    total.value = Number(data.total) || 0
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('notifications.loadFailed'))
  } finally {
    loading.value = false
  }
  await loadUnread()
}

async function loadUnread () {
  try {
    const res = await notificationAPI.unreadCount()
    unread.value = Number(res.data?.data?.unread) || 0
  } catch {
    unread.value = 0
  }
}

async function markAllRead () {
  try {
    await notificationAPI.markAllRead()
    await load()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('notifications.markAllReadFailed'))
  }
}

/** 点"查看详情"：标记已读 + 跳到订单/售后页 */
async function open (n) {
  try {
    await notificationAPI.markRead(n.id)
  } catch {
    // 标记失败不阻断跳转
  }
  if (n.link) {
    router.push(n.link)
  } else {
    await load()
  }
}

onMounted(load)
</script>
