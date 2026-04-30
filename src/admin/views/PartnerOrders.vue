<template>
  <div class="partner-orders-mgmt">
    <el-card>
      <el-form :inline="true" class="filters">
        <el-form-item :label="t('partnerOrdersMgmt.filterPartner')">
          <el-input
            v-model.trim="filters.partner_keyword"
            clearable
            :placeholder="t('partnerOrdersMgmt.filterPartnerPlaceholder')"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item :label="t('partnerOrdersMgmt.filterStatus')">
          <el-select
            v-model="filters.status"
            clearable
            style="width: 180px"
            :placeholder="t('partnerOrdersMgmt.filterStatusPlaceholder')"
          >
            <el-option v-for="s in statusOptions" :key="s" :label="partnerOrderStatusLabel(s)" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('partnerOrdersMgmt.dateFrom')">
          <el-date-picker v-model="filters.from" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item :label="t('partnerOrdersMgmt.dateTo')">
          <el-date-picker v-model="filters.to" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">{{ t('partnerOrdersMgmt.search') }}</el-button>
          <el-button @click="resetFilters">{{ t('partnerOrdersMgmt.reset') }}</el-button>
          <el-button type="success" :loading="exporting" @click="exportXlsx">{{ t('partnerOrdersMgmt.export') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card style="margin-top: 16px">
      <el-table v-loading="loading" :data="orders" stripe border style="width: 100%">
        <el-table-column type="expand">
          <template #default="{ row }">
            <el-table :data="row.items || []" size="small" border style="margin: 8px 24px;">
              <el-table-column :label="t('partnerOrdersMgmt.productImage')" width="72" align="center">
                <template #default="{ row: it }">
                  <el-image
                    v-if="itemImg(it)"
                    :src="itemImg(it)"
                    fit="cover"
                    style="width: 48px; height: 48px; border-radius: 4px"
                    :preview-src-list="[itemImg(it)]"
                    preview-teleported
                  />
                  <span v-else class="text-gray-400">—</span>
                </template>
              </el-table-column>
              <el-table-column prop="product_id" :label="t('partnerOrdersMgmt.sku')" width="90" />
              <el-table-column prop="product_name_snapshot" :label="t('partnerOrdersMgmt.snapshotName')" min-width="160" />
              <el-table-column prop="quantity" :label="t('partnerOrdersMgmt.qty')" width="80" />
              <el-table-column prop="unit_price_thb" :label="t('partnerOrdersMgmt.unitPrice')" />
              <el-table-column prop="line_total_thb" :label="t('partnerOrdersMgmt.lineTotal')" />
            </el-table>
          </template>
        </el-table-column>
        <el-table-column prop="order_no" :label="t('partnerOrdersMgmt.orderNo')" min-width="150" />
        <el-table-column :label="t('partnerOrdersMgmt.partner')" min-width="160">
          <template #default="{ row }">{{ row.partner?.login }} {{ row.partner?.display_name ? `（${row.partner.display_name}）` : '' }}</template>
        </el-table-column>
        <el-table-column prop="total_amount_thb" :label="t('partnerOrdersMgmt.totalThb')" width="120">
          <template #default="{ row }">{{ parseFloat(row.total_amount_thb)?.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column prop="status" :label="t('partnerOrdersMgmt.status')" width="124">
          <template #default="{ row }">
            <div class="partner-order-status-cell">
              <el-select
                :model-value="row.status"
                size="small"
                placement="bottom-end"
                :teleported="true"
                :fit-input-width="false"
                popper-class="partner-order-status-popper"
                @change="(v) => onStatusChange(row, v)"
              >
                <el-option v-for="s in statusOptions" :key="s" :label="partnerOrderStatusLabel(s)" :value="s" />
              </el-select>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="contact_name" :label="t('partnerOrdersMgmt.contactName')" width="100" />
        <el-table-column prop="contact_phone" :label="t('partnerOrdersMgmt.contactPhone')" width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ displayPartnerPhone(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('partnerOrdersMgmt.address')" min-width="320" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="whitespace-pre-wrap">{{ row.delivery_address || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" :label="t('partnerOrdersMgmt.createdAt')" width="174">
          <template #default="{ row }">
            {{ formatCreatedAt(row.created_at) }}
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          layout="total, prev, pager, next, jumper"
          @current-change="loadOrders"
          @size-change="loadOrders"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import config from '../../config/index.js'
import { useAdminStore } from '../stores/admin.js'

const { t } = useI18n()
const adminStore = useAdminStore()

const statusOptions = ['pending_payment', 'submitted', 'processing', 'shipped', 'settled', 'cancelled']

const loading = ref(false)
const exporting = ref(false)
const orders = ref([])
const filters = reactive({
  partner_keyword: '',
  status: '',
  from: '',
  to: ''
})
const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

function buildQuery () {
  const q = new URLSearchParams({
    page: String(pagination.page),
    pageSize: String(pagination.pageSize)
  })
  const kw = String(filters.partner_keyword || '').trim()
  if (kw) q.set('partner_keyword', kw)
  if (filters.status) q.set('status', filters.status)
  if (filters.from && filters.to) {
    q.set('from', filters.from)
    q.set('to', filters.to)
  }
  return q.toString()
}

async function loadOrders () {
  loading.value = true
  try {
    const res = await adminStore.apiRequest(`/api/admin/partner-orders?${buildQuery()}`)
    const json = await res.json()
    if (json.success) {
      orders.value = json.data.orders || []
      pagination.total = json.data.pagination?.total ?? 0
    } else {
      if (import.meta.env.DEV && json.message) console.warn('[partner-orders]', json.message)
      ElMessage.error(t('partnerOrdersMgmt.loadFailed'))
    }
  } catch {
    ElMessage.error(t('partnerOrdersMgmt.loadFailed'))
  } finally {
    loading.value = false
  }
}

function search () {
  pagination.page = 1
  loadOrders()
}

function resetFilters () {
  filters.partner_keyword = ''
  filters.status = ''
  filters.from = ''
  filters.to = ''
  pagination.page = 1
  loadOrders()
}

async function exportXlsx () {
  exporting.value = true
  try {
    const q = new URLSearchParams()
    const kw = String(filters.partner_keyword || '').trim()
    if (kw) q.set('partner_keyword', kw)
    if (filters.status) q.set('status', filters.status)
    if (filters.from && filters.to) {
      q.set('from', filters.from)
      q.set('to', filters.to)
    }
    const url = `${config.buildApiUrl('/api/admin/partner-orders/export')}?${q.toString()}`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${adminStore.token}`
      }
    })
    if (!res.ok) {
      ElMessage.error(t('partnerOrdersMgmt.exportFail'))
      return
    }
    const blob = await res.blob()
    const link = document.createElement('a')
    link.href = window.URL.createObjectURL(blob)
    link.download = `partner_orders_${new Date().toISOString().slice(0, 10)}.xlsx`
    link.click()
    window.URL.revokeObjectURL(link.href)
  } catch {
    ElMessage.error(t('partnerOrdersMgmt.exportFail'))
  } finally {
    exporting.value = false
  }
}

async function onStatusChange (row, status) {
  try {
    const res = await adminStore.apiRequest(`/api/admin/partner-orders/${row.id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    })
    const json = await res.json()
    if (json.success) {
      row.status = status
      ElMessage.success(t('partnerOrdersMgmt.updateStatusOk'))
    } else {
      if (import.meta.env.DEV && json.message) console.warn('[partner-order-status]', json.message)
      ElMessage.error(t('partnerOrdersMgmt.statusUpdateFailed'))
      loadOrders()
    }
  } catch {
    ElMessage.error(t('partnerOrdersMgmt.statusUpdateFailed'))
    loadOrders()
  }
}

function itemImg (it) {
  const p = it?.product_image_snapshot
  if (!p) return ''
  return config.buildStaticUrl(p)
}

function formatCreatedAt (raw) {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function escapeRegExp (s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 兼容旧订单：联系电话列曾含「姓名 + 空格 + 号码」 */
function displayPartnerPhone (row) {
  let p = row.contact_phone != null ? String(row.contact_phone).trim() : ''
  if (!p) return '—'
  const name = row.contact_name != null ? String(row.contact_name).trim() : ''
  if (name) {
    p = p.replace(new RegExp(`^${escapeRegExp(name)}\\s+`), '').trim()
  }
  return p || '—'
}

function partnerOrderStatusLabel (code) {
  return t(`partnerOrdersMgmt.orderStatus.${code}`)
}

onMounted(() => {
  loadOrders()
})
</script>

<style scoped>
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

.partner-order-status-cell {
  min-width: 0;
  padding-right: 2px;
  box-sizing: border-box;
}

.partner-order-status-cell :deep(.el-select) {
  width: 100%;
  max-width: 100%;
}
</style>

<style>
/* teleported dropdown：避免长文案下拉被挤窄 */
.partner-order-status-popper.el-select-dropdown,
.partner-order-status-popper.el-popper {
  min-width: 12rem;
}
</style>
