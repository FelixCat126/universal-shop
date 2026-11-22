<template>
  <div class="payment-reconciliation">
    <!-- 筛选区 -->
    <el-card shadow="never" class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item :label="t('reconciliation.filterStatus')">
          <el-select
            v-model="filters.status"
            :placeholder="t('reconciliation.filterStatus')"
            clearable
            style="width: 160px"
            @change="handleSearch"
          >
            <el-option :label="t('reconciliation.statusPending')" value="pending" />
            <el-option :label="t('reconciliation.statusReceived')" value="received" />
            <el-option :label="t('reconciliation.statusNotReceived')" value="not_received" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('reconciliation.filterType')">
          <el-select
            v-model="filters.order_type"
            :placeholder="t('reconciliation.filterType')"
            clearable
            style="width: 140px"
            @change="handleSearch"
          >
            <el-option :label="t('reconciliation.typeRetail')" value="retail" />
            <el-option :label="t('reconciliation.typePartner')" value="partner" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('reconciliation.filterOrderNo')">
          <el-input
            v-model="filters.order_no"
            :placeholder="t('reconciliation.filterOrderNoPlaceholder')"
            clearable
            style="width: 200px"
            @keyup.enter="handleSearch"
            @clear="handleSearch"
          />
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
          <el-button :loading="exporting" @click="exportRecords">
            <el-icon><Download /></el-icon>
            {{ t('reconciliation.export') }}
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 列表区 -->
    <el-card shadow="never" class="table-card">
      <template #header>
        <div class="table-header">
          <span>{{ t('reconciliation.title') }}</span>
          <span class="table-info">{{ t('reconciliation.listTotal') }} {{ pagination.total }}</span>
        </div>
      </template>
      <el-table
        :data="rows"
        v-loading="loading"
        row-key="id"
        border
        stripe
        table-layout="fixed"
        :empty-text="t('common.noData')"
      >
        <el-table-column prop="order_no" :label="t('reconciliation.orderNo')" min-width="200" show-overflow-tooltip />
        <el-table-column :label="t('reconciliation.type')" width="100">
          <template #default="{ row }">
            <el-tag :type="row.order_type === 'partner' ? 'warning' : 'info'" size="small">
              {{ row.order_type === 'partner' ? t('reconciliation.typePartner') : t('reconciliation.typeRetail') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('reconciliation.amount')" width="130" align="right">
          <template #default="{ row }">
            ฿{{ money(row.total_amount_thb) }}
          </template>
        </el-table-column>
        <el-table-column :label="t('reconciliation.status')" width="130">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.reconcile_status)" size="small">
              {{ statusText(row.reconcile_status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('reconciliation.receivedAmount')" width="130" align="right">
          <template #default="{ row }">
            <span v-if="row.received_amount != null">฿{{ money(row.received_amount) }}</span>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="bank_ref" :label="t('reconciliation.bankRef')" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.bank_ref">{{ row.bank_ref }}</span>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('reconciliation.orderCreatedAt')" width="170">
          <template #default="{ row }">{{ formatTime(row.order_created_at) }}</template>
        </el-table-column>
        <el-table-column :label="t('reconciliation.sweptAt')" width="170">
          <template #default="{ row }">{{ formatTime(row.swept_at) }}</template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="openDetail(row)">
              {{ t('reconciliation.viewDetail') }}
            </el-button>
            <el-button size="small" @click="openReview(row)">
              {{ t('reconciliation.review') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :page-sizes="[20, 50, 100]"
          :total="pagination.total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="load"
          @current-change="load"
        />
      </div>
    </el-card>

    <!-- 详情弹窗 -->
    <el-dialog v-model="detailVisible" :title="t('reconciliation.detailTitle')" width="640px">
      <el-descriptions :column="2" border>
        <el-descriptions-item :label="t('reconciliation.orderNo')">{{ current?.order_no }}</el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.type')">
          {{ current?.order_type === 'partner' ? t('reconciliation.typePartner') : t('reconciliation.typeRetail') }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.amount')">฿{{ money(current?.total_amount_thb) }}</el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.currency')">{{ current?.currency_code || 'THB' }}</el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.status')">
          {{ statusText(current?.reconcile_status) }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.receivedAmount')">
          <span v-if="current?.received_amount != null">฿{{ money(current.received_amount) }}</span>
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.bankRef')">{{ current?.bank_ref || '-' }}</el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.reconciledBy')">{{ current?.reconciled_by_label || '-' }}</el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.orderCreatedAt')">
          {{ formatTime(current?.order_created_at) }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.sweptAt')">
          {{ formatTime(current?.swept_at) }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.buyer')" :span="2">{{ current?.user_label || '-' }}</el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.contactName')">{{ current?.contact_name || '-' }}</el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.contactPhone')">{{ current?.contact_phone || '-' }}</el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.deliveryAddress')" :span="2">
          {{ current?.delivery_address || '-' }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.notes')" :span="2">
          {{ current?.notes || '-' }}
        </el-descriptions-item>
        <el-descriptions-item :label="t('reconciliation.note')" :span="2">
          {{ current?.note || '-' }}
        </el-descriptions-item>
      </el-descriptions>

      <!-- 商品明细快照（这是第 51 轮的核心价值：单子删了，货还在） -->
      <h4 class="items-title">{{ t('reconciliation.items') }}</h4>
      <el-table :data="currentItems" size="small" border :empty-text="t('reconciliation.noItems')">
        <el-table-column prop="name" :label="t('reconciliation.itemName')" min-width="180" show-overflow-tooltip />
        <el-table-column prop="quantity" :label="t('reconciliation.itemQuantity')" width="90" align="right" />
        <el-table-column :label="t('reconciliation.itemUnitPrice')" width="130" align="right">
          <template #default="{ row }">฿{{ money(row.unit_price) }}</template>
        </el-table-column>
        <el-table-column :label="t('reconciliation.itemLineTotal')" width="130" align="right">
          <template #default="{ row }">฿{{ money(row.line_total) }}</template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button @click="detailVisible = false">{{ t('common.close') }}</el-button>
      </template>
    </el-dialog>

    <!-- 标记核对结论弹窗 -->
    <el-dialog v-model="reviewVisible" :title="t('reconciliation.reviewTitle')" width="480px">
      <el-alert
        :title="t('reconciliation.reviewHint')"
        type="info"
        :closable="false"
        show-icon
        class="review-hint"
      />
      <el-form label-width="110px" class="review-form">
        <el-form-item :label="t('reconciliation.orderNo')">
          <span>{{ reviewRow?.order_no }}</span>
        </el-form-item>
        <el-form-item :label="t('reconciliation.status')">
          <el-radio-group v-model="reviewForm.reconcile_status">
            <el-radio value="received">{{ t('reconciliation.statusReceived') }}</el-radio>
            <el-radio value="not_received">{{ t('reconciliation.statusNotReceived') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="t('reconciliation.receivedAmount')">
          <el-input-number
            v-model="reviewForm.received_amount"
            :min="0"
            :precision="2"
            :step="1"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item :label="t('reconciliation.bankRef')">
          <el-input
            v-model="reviewForm.bank_ref"
            maxlength="100"
            :placeholder="t('reconciliation.bankRefPlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="t('reconciliation.note')">
          <el-input
            v-model="reviewForm.note"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            :placeholder="t('reconciliation.notePlaceholder')"
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
import { Search, Refresh, Download } from '@element-plus/icons-vue'
import { reconciliationAPI } from '../api/reconciliation.js'
import { useAdminStore } from '../stores/admin.js'

const adminStore = useAdminStore()
const { t } = useI18n()

const rows = ref([])
const loading = ref(false)
const exporting = ref(false)

const filters = reactive({ status: '', order_type: '', order_no: '' })

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

const detailVisible = ref(false)
const current = ref(null)

const reviewVisible = ref(false)
const reviewRow = ref(null)
const reviewing = ref(false)
const reviewForm = reactive({
  reconcile_status: 'received',
  received_amount: 0,
  bank_ref: '',
  note: ''
})

const STATUS_MAP = {
  pending: 'reconciliation.statusPending',
  received: 'reconciliation.statusReceived',
  not_received: 'reconciliation.statusNotReceived'
}

const statusText = (status) => t(STATUS_MAP[status] || 'reconciliation.statusPending')

const statusTagType = (status) => ({
  pending: 'warning',
  received: 'success',
  not_received: 'info'
}[status] || 'info')

const currentItems = computed(() => {
  const items = current.value?.items_snapshot
  return Array.isArray(items) ? items : []
})

const money = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0.00'
  return n.toFixed(2)
}

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
    const params = {}
    if (filters.status) params.status = filters.status
    if (filters.order_type) params.order_type = filters.order_type
    if (filters.order_no) params.order_no = filters.order_no
    params.page = pagination.page
    params.pageSize = pagination.pageSize
    const res = await reconciliationAPI.list(params)
    const data = res.data?.data || {}
    rows.value = Array.isArray(data.records) ? data.records : []
    pagination.total = Number(data.total) || 0
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('reconciliation.loadFailed'))
  } finally {
    loading.value = false
  }
}

function handleSearch () {
  pagination.page = 1
  load()
}

function resetSearch () {
  filters.status = ''
  filters.order_type = ''
  filters.order_no = ''
  pagination.page = 1
  load()
}

/** 导出当前筛选条件下的对账表（CSV：财务/ERP 能导） */
const exportRecords = async () => {
  if (exporting.value) return
  exporting.value = true
  try {
    const params = new URLSearchParams(
      Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
    )
    params.set('format', 'csv')
    const response = await adminStore.apiRequest(`/api/admin/reconciliation/export?${params}`)
    if (!response.ok) {
      ElMessage.error(t('reconciliation.exportFailed'))
      return
    }
    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'payment-reconciliation.csv'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    ElMessage.success(t('reconciliation.exportSuccess'))
  } catch (error) {
    console.error('导出对账台账失败:', error)
    ElMessage.error(t('reconciliation.exportFailed'))
  } finally {
    exporting.value = false
  }
}

async function openDetail (row) {
  try {
    const res = await reconciliationAPI.detail(row.id)
    current.value = res.data?.data || row
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('reconciliation.loadFailed'))
    current.value = row
  }
  detailVisible.value = true
}

function openReview (row) {
  reviewRow.value = { ...row }
  reviewForm.reconcile_status = row.reconcile_status === 'pending' ? 'received' : row.reconcile_status
  reviewForm.received_amount = row.received_amount != null
    ? Number(row.received_amount)
    : Number(row.total_amount_thb) || 0
  reviewForm.bank_ref = row.bank_ref || ''
  reviewForm.note = row.note || ''
  reviewVisible.value = true
}

async function submitReview () {
  if (!reviewRow.value) return
  reviewing.value = true
  try {
    const res = await reconciliationAPI.update(reviewRow.value.id, {
      reconcile_status: reviewForm.reconcile_status,
      received_amount: reviewForm.received_amount,
      bank_ref: reviewForm.bank_ref,
      note: reviewForm.note
    })
    if (res.data?.success) {
      ElMessage.success(t('reconciliation.reviewSaved'))
      reviewVisible.value = false
      load()
    } else {
      ElMessage.error(res.data?.message || t('reconciliation.reviewFailed'))
    }
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('reconciliation.reviewFailed'))
  } finally {
    reviewing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.payment-reconciliation {
  padding: 0;
}

.filter-card {
  margin-bottom: 20px;
}

.table-card {
  margin-bottom: 20px;
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  color: #303133;
}

.table-info {
  font-size: 14px;
  color: #909399;
  font-weight: normal;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.items-title {
  margin: 20px 0 10px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.review-hint {
  margin-bottom: 16px;
}

.review-form {
  margin-top: 8px;
}
</style>
