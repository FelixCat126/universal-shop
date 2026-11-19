<template>
  <div class="partners-mgmt">
    <el-card class="toolbar-card">
      <el-button type="primary" @click="openCreate">{{ t('partnersMgmt.create') }}</el-button>
      <el-button @click="load">{{ t('partnersMgmt.refresh') }}</el-button>
      <!-- CSV 批量导入/导出：合作方开户是成批的，一个一个填既慢又容易填错 -->
      <el-button @click="openCsvImport">{{ t('csv.importTitle') }}</el-button>
      <el-button @click="exportCsv">{{ t('csv.exportTitle') }}</el-button>
    </el-card>

    <!-- CSV 导入对话框 -->
    <CsvImportDialog
      ref="csvImportRef"
      type="partners"
      subject-key="login"
      :hint="t('partnersMgmt.csvHint')"
      :valid-columns="partnerCsvColumns"
      @imported="load"
    />

    <!-- 检索区：与其他后台页面同构（filter-section + search-form） -->
    <div class="filter-section" style="margin-top: 16px;">
      <el-card>
        <el-form :model="searchForm" inline class="search-form" @submit.prevent="handleSearch">
          <el-form-item :label="t('partnersMgmt.login')">
            <el-input
              v-model="searchForm.keyword"
              :placeholder="t('partnersMgmt.loginPlaceholder')"
              clearable
              style="width: 180px"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="handleSearch">{{ t('common.search') }}</el-button>
            <el-button @click="resetSearch">{{ t('common.reset') }}</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>

    <el-card class="table-section">
      <el-table v-loading="loading" :data="rows" stripe border style="width: 100%">
        <el-table-column prop="id" label="ID" width="72" />
        <el-table-column prop="login" :label="t('partnersMgmt.login')" min-width="110" />
        <el-table-column prop="display_name" :label="t('partnersMgmt.displayName')" min-width="110" />
        <el-table-column prop="account_kind" :label="t('partnersMgmt.accountKind')" min-width="100">
          <template #default="{ row }">{{ accountKindLabel(row.account_kind) }}</template>
        </el-table-column>
        <el-table-column prop="discount_percent" min-width="108" align="right">
          <template #header>
            <span class="partners-col-discount">{{ t('partnersMgmt.discountPercent') }}</span>
          </template>
          <template #default="{ row }">{{ formatNum(row.discount_percent) }}</template>
        </el-table-column>
        <el-table-column :label="t('partnersMgmt.active')" width="90">
          <template #default="{ row }">
            <el-tag :type="row.is_active ? 'success' : 'info'">{{ row.is_active ? t('partnersMgmt.active') : t('partnersMgmt.inactive') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="last_login_at" :label="t('partnersMgmt.lastLogin')" min-width="160">
          <template #default="{ row }">{{ formatDateTime(row.last_login_at) }}</template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="200" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="openEdit(row)">{{ t('partnersMgmt.edit') }}</el-button>
            <el-button type="warning" link size="small" @click="openPwd(row)">{{ t('partnersMgmt.resetPwd') }}</el-button>
            <el-button type="danger" link size="small" @click="confirmDelete(row)">{{ t('partnersMgmt.delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap" v-if="pagination.totalPages > 1">
        <el-pagination
          layout="total, sizes, prev, pager, next"
          :total="pagination.total"
          :page-size="pagination.pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :current-page="pagination.page"
          @current-change="handlePageChange"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>

    <el-dialog v-model="createVisible" :title="t('partnersMgmt.createTitle')" width="480px">
      <el-form label-width="100px">
        <el-form-item :label="t('partnersMgmt.login')">
          <el-input v-model="createForm.login" :placeholder="t('partnersMgmt.loginPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('partnersMgmt.password')">
          <el-input v-model="createForm.password" type="password" show-password :placeholder="t('partnersMgmt.passwordHint')" />
        </el-form-item>
        <el-form-item :label="t('partnersMgmt.displayName')">
          <el-input v-model="createForm.display_name" :placeholder="t('partnersMgmt.displayNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('partnersMgmt.accountKind')">
          <el-radio-group v-model="createForm.account_kind">
            <el-radio label="dealer">{{ t('partnersMgmt.kindDealer') }}</el-radio>
            <el-radio label="agent">{{ t('partnersMgmt.kindAgent') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="t('partnersMgmt.discountPercent')">
          <el-input-number v-model="createForm.discount_percent" :min="0" :max="100" :step="1" controls-position="right" />
        </el-form-item>
        <el-form-item :label="t('partnersMgmt.active')">
          <el-switch v-model="createForm.is_active" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="submitCreate">{{ t('partnersMgmt.save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editVisible" :title="t('partnersMgmt.editTitle')" width="480px">
      <el-form label-width="100px">
        <el-form-item :label="t('partnersMgmt.login')">
          <span>{{ editing?.login }}</span>
        </el-form-item>
        <el-form-item :label="t('partnersMgmt.displayName')">
          <el-input v-model="editForm.display_name" />
        </el-form-item>
        <el-form-item :label="t('partnersMgmt.accountKind')">
          <el-radio-group v-model="editForm.account_kind">
            <el-radio label="dealer">{{ t('partnersMgmt.kindDealer') }}</el-radio>
            <el-radio label="agent">{{ t('partnersMgmt.kindAgent') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="t('partnersMgmt.discountPercent')">
          <el-input-number v-model="editForm.discount_percent" :min="0" :max="100" :step="1" controls-position="right" />
        </el-form-item>
        <el-form-item :label="t('partnersMgmt.active')">
          <el-switch v-model="editForm.is_active" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">{{ t('partnersMgmt.save') }}</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="pwdVisible" :title="t('partnersMgmt.resetPwd')" width="400px">
      <el-input v-model="pwdForm.password" type="password" show-password :placeholder="t('partnersMgmt.pwdPlaceholder')" />
      <template #footer>
        <el-button @click="pwdVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="pwdSaving" @click="submitPwd">{{ t('partnersMgmt.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue'
import { useAutoSearch } from '../composables/useAutoSearch.js'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import { useAdminStore } from '../stores/admin.js'
import CsvImportDialog from '../components/CsvImportDialog.vue'
import api from '../api/index.js'

const { t } = useI18n()
const adminStore = useAdminStore()

const loading = ref(false)
const saving = ref(false)
const pwdSaving = ref(false)
const rows = ref([])
/** 检索与分页状态（与其它后台页面同构） */
const searchForm = reactive({ keyword: '' })
const pagination = reactive({ total: 0, page: 1, pageSize: 20, totalPages: 1 })

/* ---------------- CSV 批量导入 / 导出 ---------------- */

const csvImportRef = ref(null)
const openCsvImport = () => {
  csvImportRef.value?.open()
}

/** 预览表里"可导入行"显示的列（与后端 CSV 列一致） */
const partnerCsvColumns = [
  { key: 'login', label: t('partnersMgmt.login'), minWidth: 130 },
  { key: 'display_name', label: t('partnersMgmt.displayName'), minWidth: 130 },
  { key: 'account_kind', label: t('partnersMgmt.accountKind'), width: 100 },
  { key: 'discount_percent', label: t('partnersMgmt.discountPercent'), width: 110 }
]

/** 导出合作方为 CSV（财务/运营核对名单用） */
const exportCsv = async () => {
  try {
    const res = await api.get('/admin/partners/export.csv', { responseType: 'blob' })
    const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `partners-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('common.error'))
  }
}

const createVisible = ref(false)
const editVisible = ref(false)
const pwdVisible = ref(false)
const editing = ref(null)

const createForm = reactive({
  login: '',
  password: '',
  display_name: '',
  account_kind: 'dealer',
  discount_percent: 0,
  is_active: true
})

const editForm = reactive({
  display_name: '',
  account_kind: 'dealer',
  discount_percent: 0,
  is_active: true
})

const pwdForm = reactive({
  partnerId: null,
  password: ''
})

function formatNum (v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : '0'
}

function accountKindLabel (kind) {
  return kind === 'agent' ? t('partnersMgmt.kindAgent') : t('partnersMgmt.kindDealer')
}

function formatDateTime (v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 删除合作方：确认后调用 DELETE /api/admin/partners/:id（后端校验无未完成订单）
async function confirmDelete (row) {
  try {
    await ElMessageBox.confirm(
      t('partnersMgmt.confirmDelete'),
      t('partnersMgmt.delete'),
      { type: 'warning', confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel') }
    )
  } catch {
    return
  }
  try {
    const res = await adminStore.apiRequest(`/api/admin/partners/${row.id}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.success) {
      ElMessage.success(t('partnersMgmt.deleteOk'))
      await load()
    } else {
      ElMessage.error(json.message || t('partnersMgmt.deleteFailed'))
    }
  } catch {
    ElMessage.error(t('partnersMgmt.deleteFailed'))
  }
}

async function load () {
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: String(pagination.page),
      pageSize: String(pagination.pageSize)
    })
    if (searchForm.keyword) params.set('keyword', searchForm.keyword)
    const res = await adminStore.apiRequest(`/api/admin/partners?${params.toString()}`)
    const json = await res.json()
    if (json.success) {
      rows.value = json.data || []
      const pg = json.pagination || {}
      pagination.total = Number(pg.total) || 0
      pagination.page = Number(pg.page) || 1
      pagination.pageSize = Number(pg.pageSize) || pagination.pageSize
      pagination.totalPages = Number(pg.totalPages) || 1
    } else {
      ElMessage.error(json.message || t('partnersMgmt.loadFailed'))
    }
  } catch (e) {
    ElMessage.error(t('partnersMgmt.loadFailed'))
  } finally {
    loading.value = false
  }
}

function openCreate () {
  createForm.login = ''
  createForm.password = ''
  createForm.display_name = ''
  createForm.discount_percent = 0
  createForm.account_kind = 'dealer'
  createForm.is_active = true
  createVisible.value = true
}

async function submitCreate () {
  saving.value = true
  try {
    const res = await adminStore.apiRequest('/api/admin/partners', {
      method: 'POST',
      body: JSON.stringify({
        login: createForm.login,
        password: createForm.password,
        display_name: createForm.display_name,
        account_kind: createForm.account_kind,
        discount_percent: createForm.discount_percent,
        is_active: createForm.is_active
      })
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success(t('partnersMgmt.createOk'))
      createVisible.value = false
      await load()
    } else {
      ElMessage.error(json.message || t('common.error'))
    }
  } catch {
    ElMessage.error(t('common.error'))
  } finally {
    saving.value = false
  }
}

function openEdit (row) {
  editing.value = row
  editForm.display_name = row.display_name || ''
  editForm.account_kind = row.account_kind === 'agent' ? 'agent' : 'dealer'
  editForm.discount_percent = formatNum(row.discount_percent)
  editForm.is_active = !!row.is_active
  editVisible.value = true
}

async function submitEdit () {
  if (!editing.value) return
  saving.value = true
  try {
    const res = await adminStore.apiRequest(`/api/admin/partners/${editing.value.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        display_name: editForm.display_name,
        account_kind: editForm.account_kind,
        discount_percent: editForm.discount_percent,
        is_active: editForm.is_active
      })
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success(t('partnersMgmt.updateOk'))
      editVisible.value = false
      await load()
    } else {
      ElMessage.error(json.message || t('common.error'))
    }
  } catch {
    ElMessage.error(t('common.error'))
  } finally {
    saving.value = false
  }
}

function openPwd (row) {
  pwdForm.partnerId = row.id
  pwdForm.password = ''
  pwdVisible.value = true
}

async function submitPwd () {
  pwdSaving.value = true
  try {
    const res = await adminStore.apiRequest(`/api/admin/partners/${pwdForm.partnerId}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password: pwdForm.password })
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success(t('partnersMgmt.resetOk'))
      pwdVisible.value = false
    } else {
      ElMessage.error(json.message || t('common.error'))
    }
  } catch {
    ElMessage.error(t('common.error'))
  } finally {
    pwdSaving.value = false
  }
}

function handleSearch () {
  pagination.page = 1
  load()
}

// 筛选条件改动 → 自动搜索（debounce 300ms），省掉每次"打字后再点搜索"
useAutoSearch(searchForm, handleSearch)


function resetSearch () {
  searchForm.keyword = ''
  pagination.page = 1
  load()
}

function handlePageChange (page) {
  pagination.page = page
  load()
}

function handleSizeChange (size) {
  pagination.pageSize = size
  pagination.page = 1
  load()
}

onMounted(() => {
  load()
})
</script>

<style scoped>
.toolbar-card :deep(.el-card__body) {
  padding: 12px 16px;
}
.partners-col-discount {
  white-space: nowrap;
}
</style>
