<template>
  <div class="partners-mgmt">
    <el-card class="toolbar-card">
      <el-button type="primary" @click="openCreate">{{ t('partnersMgmt.create') }}</el-button>
      <el-button @click="load">{{ t('partnersMgmt.refresh') }}</el-button>
    </el-card>

    <el-card style="margin-top: 16px">
      <el-table v-loading="loading" :data="rows" stripe border style="width: 100%">
        <el-table-column prop="id" label="ID" width="72" />
        <el-table-column prop="login" :label="t('partnersMgmt.login')" min-width="120" />
        <el-table-column prop="display_name" :label="t('partnersMgmt.displayName')" min-width="120" />
        <el-table-column prop="account_kind" :label="t('partnersMgmt.accountKind')" min-width="100">
          <template #default="{ row }">{{ accountKindLabel(row.account_kind) }}</template>
        </el-table-column>
        <el-table-column prop="discount_percent" min-width="118" align="right">
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
        <el-table-column prop="last_login_at" :label="t('partnersMgmt.lastLogin')" min-width="170">
          <template #default="{ row }">{{ row.last_login_at || '—' }}</template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="220" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openEdit(row)">{{ t('partnersMgmt.edit') }}</el-button>
            <el-button type="warning" link @click="openPwd(row)">{{ t('partnersMgmt.resetPwd') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
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
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useAdminStore } from '../stores/admin.js'

const { t } = useI18n()
const adminStore = useAdminStore()

const loading = ref(false)
const saving = ref(false)
const pwdSaving = ref(false)
const rows = ref([])

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

async function load () {
  loading.value = true
  try {
    const res = await adminStore.apiRequest('/api/admin/partners')
    const json = await res.json()
    if (json.success) {
      rows.value = json.data || []
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
