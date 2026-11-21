<template>
  <div class="after-sales">
    <div class="filter-section">
      <el-card>
        <el-form :model="searchForm" inline class="search-form">
          <el-form-item :label="t('afterSales.filterStatus')">
            <el-select
              v-model="searchForm.status"
              :placeholder="t('afterSales.filterStatus')"
              clearable
              style="width: 160px"
              @change="handleSearch"
            >
              <el-option :label="t('afterSales.statusPending')" value="pending" />
              <el-option :label="t('afterSales.statusApproved')" value="approved" />
              <el-option :label="t('afterSales.statusRejected')" value="rejected" />
              <el-option :label="t('afterSales.statusReceived')" value="received" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="handleSearch">
              <el-icon><Search /></el-icon>
              {{ t('common.search') }}
            </el-button>
            <el-button @click="resetSearch">
              <el-icon><Refresh /></el-icon>
              {{ t('common.reset') }}
            </el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>

    <div class="table-section">
      <el-card>
        <template #header>
          <div class="table-header">
            <span>{{ t('afterSales.title') }}</span>
            <span class="table-info">{{ t('afterSales.listTotal') }} {{ rows.length }}</span>
          </div>
        </template>
        <div class="table-wrapper">
          <el-table
            :data="rows"
            style="width: 100%; min-width: 1100px"
            v-loading="loading"
            row-key="id"
            border
            stripe
            table-layout="fixed"
          >
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column prop="order_id" :label="t('afterSales.orderId')" width="90" />
            <el-table-column
              prop="order_no"
              :label="t('afterSales.orderNo')"
              min-width="180"
              show-overflow-tooltip
            >
              <template #default="{ row }">
                {{ row.order?.order_no || `#${row.order_id}` }}
              </template>
            </el-table-column>
            <el-table-column :label="t('afterSales.type')" width="120">
              <template #default="{ row }">
                <el-tag :type="row.type === 'refund' ? 'warning' : 'info'" size="small">
                  {{ row.type === 'refund' ? t('afterSales.typeRefund') : t('afterSales.typeReturn') }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="reason" :label="t('afterSales.reason')" min-width="200" show-overflow-tooltip />
            <el-table-column :label="t('afterSales.status')" width="110">
              <template #default="{ row }">
                <el-tag :type="statusTagType(row.status)" size="small">
                  {{ statusText(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column :label="t('afterSales.appliedAt')" width="170">
              <template #default="{ row }">
                {{ formatTime(row.created_at) }}
              </template>
            </el-table-column>
            <el-table-column :label="t('common.actions')" width="240" fixed="right">
              <template #default="{ row }">
                <!--
                  审核是**资损级写操作**（同意 = 订单取消 + 收积分 + 收券），
                  后端要求 admin/super_admin（adminRoutes.js: requireAdminOnly）。
                  操作员可以**看**列表（客服日常），但不能审核 → 按钮按角色隐藏。
                -->
                <template v-if="row.status === 'pending' && canReview">
                  <el-button size="small" type="primary" @click="openReview(row, 'approved')">
                    {{ t('afterSales.approve') }}
                  </el-button>
                  <el-button size="small" type="danger" plain @click="openReview(row, 'rejected')">
                    {{ t('afterSales.reject') }}
                  </el-button>
                </template>
                <!-- 已同意且是"退货退款"：货到了才能确认收货入库（回补库存） -->
                <el-button
                  v-else-if="row.status === 'approved' && row.type === 'return' && canReview"
                  size="small"
                  type="success"
                  @click="openReview(row, 'received')"
                >
                  {{ t('afterSales.confirmReceived') }}
                </el-button>
                <span v-else class="text-gray-400 text-xs">{{ statusText(row.status) }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-card>
    </div>

    <!-- 审核弹窗 -->
    <el-dialog v-model="reviewVisible" :title="reviewTitle" width="480px">
      <el-form label-width="90px">
        <el-form-item :label="t('afterSales.type')">
          <span>{{ reviewRow?.type === 'refund' ? t('afterSales.typeRefund') : t('afterSales.typeReturn') }}</span>
        </el-form-item>
        <el-form-item :label="t('afterSales.reason')">
          <span>{{ reviewRow?.reason }}</span>
        </el-form-item>
        <el-form-item :label="t('afterSales.adminNote')">
          <el-input
            v-model="reviewNote"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            :placeholder="t('afterSales.adminNotePlaceholder')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="reviewing" @click="submitReview">
          {{ t('common.confirm') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Search, Refresh } from '@element-plus/icons-vue'
import { afterSaleAPI } from '../api/afterSales.js'
import { useAdminStore } from '../stores/admin.js'

const adminStore = useAdminStore()

const { t } = useI18n()

/**
 * 能不能审核（第 47 轮）：与后端 requireAdminOnly 同一把尺子（admin/super_admin）。
 * 操作员能看列表（客服日常），但审核按钮不出现 —— 避免"点了才知道没权限"。
 */
const canReview = computed(() => adminStore.isAdminOrAbove)

const rows = ref([])
const loading = ref(false)
const searchForm = reactive({ status: '' })

const reviewVisible = ref(false)
const reviewRow = ref(null)
const reviewNote = ref('')
const reviewing = ref(false)

const STATUS_MAP = {
  pending: 'afterSales.statusPending',
  approved: 'afterSales.statusApproved',
  rejected: 'afterSales.statusRejected',
  received: 'afterSales.statusReceived'
}

const statusText = (status) => t(STATUS_MAP[status] || 'afterSales.statusPending')

const statusTagType = (status) => ({
  pending: 'warning',
  approved: 'primary',
  rejected: 'danger',
  received: 'success'
}[status] || 'info')

const formatTime = (v) => {
  if (!v) return '-'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load () {
  loading.value = true
  try {
    const res = await afterSaleAPI.list(searchForm.status ? { status: searchForm.status } : {})
    rows.value = Array.isArray(res.data?.data) ? res.data.data : []
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('afterSales.loadFailed'))
  } finally {
    loading.value = false
  }
}

function handleSearch () {
  load()
}

function resetSearch () {
  searchForm.status = ''
  load()
}

const reviewTitle = computed(() => {
  const s = reviewRow.value?.status
  if (s === 'approved') return t('afterSales.approve')
  if (s === 'rejected') return t('afterSales.reject')
  return t('afterSales.confirmReceived')
})

function openReview (row, status) {
  reviewRow.value = { ...row, __next: status }
  reviewNote.value = row.admin_note || ''
  reviewVisible.value = true
}

async function submitReview () {
  if (!reviewRow.value) return
  reviewing.value = true
  try {
    const res = await afterSaleAPI.review(reviewRow.value.id, reviewRow.value.__next, reviewNote.value)
    if (res.data?.success) {
      ElMessage.success(t('afterSales.reviewDone'))
      reviewVisible.value = false
      await load()
    } else {
      ElMessage.error(res.data?.message || t('afterSales.reviewFailed'))
    }
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('afterSales.reviewFailed'))
  } finally {
    reviewing.value = false
  }
}

onMounted(load)
</script>
