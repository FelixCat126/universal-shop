<template>
  <div class="coupon-templates">
    <div class="filter-section">
      <el-card>
        <el-form :model="searchForm" inline class="search-form">
          <el-form-item :label="t('coupons.filterStatus')">
            <el-select
              v-model="searchForm.status"
              :placeholder="t('coupons.filterStatus')"
              clearable
              style="width: 140px"
              @change="handleSearch"
            >
              <el-option :label="t('coupons.statusActive')" value="active" />
              <el-option :label="t('coupons.statusInactive')" value="inactive" />
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

    <div class="admin-module-toolbar">
      <el-button type="primary" @click="showAddDialog">
        <el-icon><Plus /></el-icon>
        {{ t('coupons.addTemplate') }}
      </el-button>
    </div>

    <div class="table-section">
      <el-card>
        <template #header>
          <div class="table-header">
            <span>{{ t('coupons.title') }}</span>
            <span class="table-info">{{ t('coupons.listTotal') }} {{ totalTemplates }}</span>
          </div>
        </template>
        <div class="table-wrapper">
          <el-table
            :data="templates"
            style="width: 100%; min-width: 1400px"
            v-loading="loading"
            row-key="id"
            border
            stripe
            table-layout="fixed"
          >
            <el-table-column prop="id" label="ID" width="70" />

            <el-table-column prop="name" :label="t('coupons.name')" min-width="140" show-overflow-tooltip />

            <el-table-column :label="t('coupons.amount')" width="100" align="right">
              <template #default="scope">
                <span class="amount-text">{{ formatAmount(scope.row.amount) }}</span>
              </template>
            </el-table-column>

            <el-table-column :label="t('coupons.minSpend')" width="110" align="right">
              <template #default="scope">
                <span>{{ minSpendText(scope.row) }}</span>
              </template>
            </el-table-column>

            <el-table-column :label="t('coupons.total')" width="90" align="center">
              <template #default="scope">
                <span>{{ scope.row.total == null ? t('coupons.totalUnlimited') : scope.row.total }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="issued_count" :label="t('coupons.issuedCount')" width="80" align="center" />

            <el-table-column prop="used_count" :label="t('coupons.usedCount')" width="80" align="center" />

            <el-table-column prop="per_user" :label="t('coupons.perUser')" width="90" align="center" />

            <el-table-column :label="t('coupons.scope')" width="130" align="center">
              <template #default="scope">
                <el-tag type="info" size="small">{{ scopeSummary(scope.row) }}</el-tag>
              </template>
            </el-table-column>

            <el-table-column :label="t('coupons.registerGift')" width="90" align="center">
              <template #default="scope">
                <el-tag v-if="scope.row.register_gift" type="success" size="small">{{ t('coupons.registerGiftYes') }}</el-tag>
                <span v-else class="muted-text">—</span>
              </template>
            </el-table-column>

            <el-table-column :label="t('coupons.validity')" min-width="180">
              <template #default="scope">
                <span class="validity-text">{{ validityText(scope.row) }}</span>
              </template>
            </el-table-column>

            <el-table-column :label="t('coupons.status')" width="110" align="center">
              <template #default="scope">
                <el-switch
                  :model-value="scope.row.status === 'active'"
                  :loading="scope.row.__statusLoading"
                  inline-prompt
                  :active-text="t('coupons.statusActive')"
                  :inactive-text="t('coupons.statusInactive')"
                  @change="(val) => handleStatusToggle(scope.row, val)"
                />
              </template>
            </el-table-column>

            <el-table-column :label="t('coupons.actions')" width="230" fixed="right">
              <template #default="scope">
                <div class="action-buttons">
                  <el-button size="small" @click="showInstances(scope.row)">
                    {{ t('coupons.instances') }}
                  </el-button>
                  <el-button size="small" @click="editTemplate(scope.row)">
                    {{ t('coupons.edit') }}
                  </el-button>
                  <el-button size="small" type="danger" @click="deleteTemplate(scope.row)">
                    {{ t('coupons.delete') }}
                  </el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="pagination-section">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="totalTemplates"
            layout="total, sizes, prev, pager, next, jumper"
            @size-change="handleSizeChange"
            @current-change="handleCurrentChange"
          />
        </div>
      </el-card>
    </div>

    <!-- 新建/编辑券模板对话框 -->
    <el-dialog
      :title="isEditing ? t('coupons.editTemplate') : t('coupons.addTemplate')"
      v-model="showTemplateDialog"
      width="720px"
      top="3vh"
      class="coupon-dialog"
      @close="resetTemplateForm"
    >
      <div class="dialog-content">
        <el-form
          :model="templateForm"
          :rules="templateRules"
          ref="templateFormRef"
          label-width="110px"
        >
          <el-form-item :label="t('coupons.name')" prop="name">
            <el-input v-model="templateForm.name" :placeholder="t('coupons.placeholders.enterName')" />
          </el-form-item>

          <el-row :gutter="20" class="form-row">
            <el-col :span="12">
              <el-form-item :label="t('coupons.amount')" prop="amount">
                <el-input-number
                  v-model="templateForm.amount"
                  :min="0"
                  :precision="2"
                  :step="1"
                  style="width: 100%"
                />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="t('coupons.minSpend')">
                <el-input-number
                  v-model="templateForm.min_spend"
                  :min="0"
                  :precision="2"
                  :step="1"
                  style="width: 100%"
                />
                <p class="field-hint">{{ t('coupons.minSpendHint') }}</p>
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="20" class="form-row">
            <el-col :span="12">
              <el-form-item :label="t('coupons.total')">
                <el-input-number
                  v-model="templateForm.total"
                  :min="1"
                  :precision="0"
                  :step="1"
                  style="width: 100%"
                />
                <p class="field-hint">{{ t('coupons.totalHint') }}</p>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="t('coupons.perUser')">
                <el-input-number
                  v-model="templateForm.per_user"
                  :min="1"
                  :precision="0"
                  :step="1"
                  style="width: 100%"
                />
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item :label="t('coupons.validity')">
            <el-date-picker
              v-model="templateForm.timeRange"
              type="datetimerange"
              :start-placeholder="t('coupons.validityStart')"
              :end-placeholder="t('coupons.validityEnd')"
              value-format="YYYY-MM-DD HH:mm:ss"
              style="width: 100%"
            />
          </el-form-item>

          <el-form-item :label="t('coupons.scope')">
            <el-radio-group v-model="templateForm.scopeType" @change="handleScopeTypeChange">
              <el-radio value="all">{{ t('coupons.scopeAll') }}</el-radio>
              <el-radio value="category">{{ t('coupons.scopeCategory') }}</el-radio>
              <el-radio value="product">{{ t('coupons.scopeProduct') }}</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item v-if="templateForm.scopeType === 'category'" :label="t('coupons.scopeCategory')">
            <el-select
              v-model="templateForm.scopeIds"
              multiple
              collapse-tags
              collapse-tags-tooltip
              :placeholder="t('coupons.placeholders.selectCategories')"
              style="width: 100%"
            >
              <el-option
                v-for="opt in categoryOptions"
                :key="opt.id"
                :label="opt.name"
                :value="opt.id"
              />
            </el-select>
          </el-form-item>

          <el-form-item v-if="templateForm.scopeType === 'product'" :label="t('coupons.scopeProduct')">
            <el-select
              v-model="templateForm.scopeIds"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              :placeholder="t('coupons.placeholders.selectProducts')"
              style="width: 100%"
            >
              <el-option
                v-for="opt in productOptions"
                :key="opt.id"
                :label="opt.name"
                :value="opt.id"
              />
            </el-select>
          </el-form-item>

          <el-row :gutter="20" class="form-row">
            <el-col :span="12">
              <el-form-item :label="t('coupons.registerGift')">
                <el-switch v-model="templateForm.register_gift" />
                <p class="field-hint">{{ t('coupons.registerGiftHint') }}</p>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="t('coupons.status')">
                <el-switch
                  v-model="templateForm.status"
                  active-value="active"
                  inactive-value="inactive"
                  inline-prompt
                  :active-text="t('coupons.statusActive')"
                  :inactive-text="t('coupons.statusInactive')"
                />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </div>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showTemplateDialog = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" @click="saveTemplate">
            {{ isEditing ? t('coupons.updateTemplate') : t('coupons.addTemplate') }}
          </el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 券实例弹窗 -->
    <el-dialog
      :title="t('coupons.instancesTitle', { name: instancesTemplate?.name || '' })"
      v-model="showInstancesDialog"
      width="760px"
      top="5vh"
      class="coupon-dialog"
    >
      <el-table :data="instances" v-loading="loadingInstances" border stripe style="width: 100%">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column :label="t('coupons.instanceUser')" min-width="140" show-overflow-tooltip>
          <template #default="scope">
            <span>{{ instanceUserText(scope.row) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="code" :label="t('coupons.instanceCode')" min-width="130" show-overflow-tooltip />
        <el-table-column :label="t('coupons.instanceStatus')" width="90" align="center">
          <template #default="scope">
            <el-tag
              size="small"
              :type="scope.row.status === 'unused' ? 'success' : scope.row.status === 'used' ? 'info' : 'danger'"
            >{{ instanceStatusText(scope.row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('coupons.instanceClaimedAt')" min-width="150">
          <template #default="scope">
            <span class="validity-text">{{ scope.row.claimed_at || scope.row.created_at || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('coupons.instanceUsedAt')" min-width="150">
          <template #default="scope">
            <span class="validity-text">{{ scope.row.used_at || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-section">
        <el-pagination
          v-model:current-page="instancesPage"
          v-model:page-size="instancesPageSize"
          :total="instancesTotal"
          layout="total, prev, pager, next"
          @current-change="loadInstances"
        />
      </div>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showInstancesDialog = false">{{ t('common.close') }}</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, Refresh } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { couponAPI } from '../api/coupons.js'
import { productAPI } from '../api/products.js'

const { t } = useI18n()

const loading = ref(false)
const showTemplateDialog = ref(false)
const isEditing = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
const totalTemplates = ref(0)
const templateFormRef = ref(null)

// 搜索表单
const searchForm = reactive({
  status: ''
})

// 券模板表单（total 可空 = 不限量；timeRange 为 [valid_from, valid_to] 字符串对，提交时展开）
const templateForm = reactive({
  id: null,
  name: '',
  amount: null,
  min_spend: 0,
  total: null,
  per_user: 1,
  timeRange: null,
  scopeType: 'all',
  scopeIds: [],
  register_gift: false,
  status: 'active'
})

const templateRules = {
  name: [
    { required: true, message: t('coupons.validation.nameRequired'), trigger: 'blur' }
  ]
}

const templates = ref([])
const categoryOptions = ref([])
const productOptions = ref([])

// 券实例弹窗
const showInstancesDialog = ref(false)
const loadingInstances = ref(false)
const instances = ref([])
const instancesTotal = ref(0)
const instancesPage = ref(1)
const instancesPageSize = ref(10)
const instancesTemplate = ref(null)

// scope 在服务端可能是对象或 JSON 字符串，编辑/展示前统一归一
const parseMaybeJson = (val, fallback) => {
  if (val == null) return fallback
  if (typeof val === 'object') return val
  try {
    return JSON.parse(val)
  } catch (_) {
    return fallback
  }
}

const formatAmount = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

const minSpendText = (row) => {
  const n = Number(row.min_spend)
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : t('coupons.noMinSpend')
}

const scopeSummary = (row) => {
  const scope = parseMaybeJson(row.scope, {})
  const count = Array.isArray(scope.ids) ? scope.ids.length : 0
  if (scope.type === 'category') return t('coupons.scopeCategoryCount', { count })
  if (scope.type === 'product') return t('coupons.scopeProductCount', { count })
  return t('coupons.scopeAll')
}

const validityText = (row) => {
  if (!row.valid_from && !row.valid_to) return t('coupons.validityForever')
  return `${row.valid_from || '…'} ~ ${row.valid_to || '…'}`
}

const instanceUserText = (row) => {
  const u = row.user
  if (u && typeof u === 'object') {
    return u.nickname || u.phone || u.email || `#${u.id ?? row.user_id ?? ''}`
  }
  return row.user_nickname || row.user_phone || (row.user_id != null ? `#${row.user_id}` : '—')
}

const instanceStatusText = (status) => {
  if (status === 'used') return t('coupons.instanceStatusUsed')
  if (status === 'expired') return t('coupons.instanceStatusExpired')
  return t('coupons.instanceStatusUnused')
}

// 切换范围类型时清空已选项，避免残留上一类型的 id
const handleScopeTypeChange = () => {
  templateForm.scopeIds = []
}

const validateTemplateForm = () => {
  const amount = Number(templateForm.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    ElMessage.error(t('coupons.validation.amountPositive'))
    return false
  }
  const minSpend = Number(templateForm.min_spend)
  if (!Number.isFinite(minSpend) || minSpend < 0) {
    ElMessage.error(t('coupons.validation.minSpendInvalid'))
    return false
  }
  if (templateForm.total != null) {
    const total = Number(templateForm.total)
    if (!Number.isInteger(total) || total <= 0) {
      ElMessage.error(t('coupons.validation.totalPositive'))
      return false
    }
  }
  const perUser = Number(templateForm.per_user)
  if (!Number.isInteger(perUser) || perUser < 1) {
    ElMessage.error(t('coupons.validation.perUserPositive'))
    return false
  }
  const [start, end] = templateForm.timeRange || []
  if (!start || !end) {
    ElMessage.error(t('coupons.validation.timeRangeRequired'))
    return false
  }
  if (new Date(start).getTime() >= new Date(end).getTime()) {
    ElMessage.error(t('coupons.validation.timeRangeInvalid'))
    return false
  }
  if (templateForm.scopeType !== 'all' && templateForm.scopeIds.length === 0) {
    ElMessage.error(t('coupons.validation.scopeIdsRequired'))
    return false
  }
  return true
}

const buildPayload = () => {
  const [start, end] = templateForm.timeRange || []
  return {
    name: templateForm.name.trim(),
    amount: Number(templateForm.amount),
    min_spend: Number(templateForm.min_spend) || 0,
    total: templateForm.total == null ? null : Number(templateForm.total),
    per_user: Number(templateForm.per_user) || 1,
    valid_from: start || null,
    valid_to: end || null,
    scope: {
      type: templateForm.scopeType,
      ids: templateForm.scopeType === 'all' ? [] : [...templateForm.scopeIds]
    },
    status: templateForm.status,
    register_gift: !!templateForm.register_gift
  }
}

const showAddDialog = () => {
  isEditing.value = false
  resetTemplateForm()
  setTimeout(() => {
    showTemplateDialog.value = true
  }, 10)
}

const editTemplate = (row) => {
  isEditing.value = true
  const scope = parseMaybeJson(row.scope, {})
  Object.assign(templateForm, {
    id: row.id,
    name: row.name || '',
    amount: Number(row.amount) || null,
    min_spend: Number(row.min_spend) || 0,
    total: row.total == null ? null : Number(row.total),
    per_user: Number(row.per_user) || 1,
    timeRange: row.valid_from || row.valid_to ? [row.valid_from || null, row.valid_to || null] : null,
    scopeType: ['all', 'category', 'product'].includes(scope.type) ? scope.type : 'all',
    scopeIds: Array.isArray(scope.ids) ? scope.ids.map(Number) : [],
    register_gift: !!row.register_gift,
    status: row.status === 'inactive' ? 'inactive' : 'active'
  })
  showTemplateDialog.value = true
}

const resetTemplateForm = () => {
  if (templateFormRef.value) {
    templateFormRef.value.resetFields()
    templateFormRef.value.clearValidate()
  }
  templateForm.id = null
  templateForm.name = ''
  templateForm.amount = null
  templateForm.min_spend = 0
  templateForm.total = null
  templateForm.per_user = 1
  templateForm.timeRange = null
  templateForm.scopeType = 'all'
  templateForm.scopeIds = []
  templateForm.register_gift = false
  templateForm.status = 'active'
  setTimeout(() => {
    if (templateFormRef.value) {
      templateFormRef.value.clearValidate()
    }
  }, 50)
}

const saveTemplate = async () => {
  if (!templateFormRef.value) return

  try {
    await templateFormRef.value.validate()
    if (!validateTemplateForm()) return

    const confirmMessage = isEditing.value
      ? t('coupons.messages.confirmUpdate')
      : t('coupons.messages.confirmAdd')

    await ElMessageBox.confirm(
      confirmMessage,
      t('common.confirm'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )

    const payload = buildPayload()
    const response = isEditing.value
      ? await couponAPI.update(templateForm.id, payload)
      : await couponAPI.create(payload)

    if (response.data.success) {
      ElMessage.success(isEditing.value
        ? t('coupons.messages.updateSuccess')
        : t('coupons.messages.addSuccess'))
      showTemplateDialog.value = false
      resetTemplateForm()
      loadTemplates()
    } else {
      ElMessage.error(response.data.message || t('coupons.messages.saveFailed'))
    }
  } catch (error) {
    if (error === 'cancel') return
    console.error('保存券模板失败:', error)
    ElMessage.error(t('coupons.messages.saveFailed') + ': ' + (error.response?.data?.message || error.message))
  }
}

const deleteTemplate = async (row) => {
  try {
    await ElMessageBox.confirm(
      t('coupons.messages.confirmDelete', { name: row.name }),
      t('common.confirm'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )

    const response = await couponAPI.remove(row.id)
    if (response.data.success) {
      ElMessage.success(t('coupons.messages.deleteSuccess'))
      loadTemplates()
    } else {
      ElMessage.error(response.data.message || t('coupons.messages.deleteFailed'))
    }
  } catch (error) {
    if (error === 'cancel') return
    ElMessage.error(t('coupons.messages.deleteFailed') + ': ' + (error.response?.data?.message || error.message))
  }
}

const handleStatusToggle = async (row, val) => {
  const status = val ? 'active' : 'inactive'
  row.__statusLoading = true
  try {
    const response = await couponAPI.updateStatus(row.id, status)
    if (response.data?.success) {
      row.status = status
      ElMessage.success(t('coupons.messages.statusUpdateSuccess'))
    } else {
      ElMessage.error(response.data?.message || t('coupons.messages.statusUpdateFailed'))
    }
  } catch (error) {
    ElMessage.error(t('coupons.messages.statusUpdateFailed') + ': ' + (error.response?.data?.message || error.message))
  } finally {
    row.__statusLoading = false
  }
}

const handleSearch = () => {
  currentPage.value = 1
  loadTemplates()
}

const resetSearch = () => {
  Object.assign(searchForm, { status: '' })
  currentPage.value = 1
  loadTemplates()
}

const handleSizeChange = (val) => {
  pageSize.value = val
  currentPage.value = 1
  loadTemplates()
}

const handleCurrentChange = (val) => {
  currentPage.value = val
  loadTemplates()
}

const loadTemplates = async () => {
  try {
    loading.value = true
    const params = {
      page: currentPage.value,
      pageSize: pageSize.value,
      status: searchForm.status || undefined
    }
    const response = await couponAPI.list(params)
    if (response.data.success) {
      const data = response.data.data || {}
      templates.value = Array.isArray(data.list)
        ? data.list
        : (Array.isArray(data.templates) ? data.templates : [])
      const pg = data.pagination || {}
      totalTemplates.value = Number(pg.total ?? data.total ?? 0)

      // 删除后当前页可能超出总页数，回退到最后一页
      const totalPages = Number(pg.totalPages) || Math.ceil(totalTemplates.value / pageSize.value)
      if (totalPages > 0 && currentPage.value > totalPages) {
        currentPage.value = totalPages
        await loadTemplates()
        return
      }
    }
  } catch (error) {
    console.error('加载券模板列表失败:', error)
    ElMessage.error(t('coupons.messages.loadFailed') + ': ' + (error.response?.data?.message || error.message))
  } finally {
    loading.value = false
  }
}

const showInstances = (row) => {
  instancesTemplate.value = row
  instancesPage.value = 1
  instances.value = []
  showInstancesDialog.value = true
  loadInstances()
}

const loadInstances = async () => {
  const tpl = instancesTemplate.value
  if (!tpl?.id) return
  loadingInstances.value = true
  try {
    const response = await couponAPI.instances(tpl.id, {
      page: instancesPage.value,
      pageSize: instancesPageSize.value
    })
    if (response.data?.success) {
      const data = response.data.data || {}
      instances.value = Array.isArray(data.list)
        ? data.list
        : (Array.isArray(data.instances) ? data.instances : [])
      const pg = data.pagination || {}
      instancesTotal.value = Number(pg.total ?? data.total ?? instances.value.length)
    } else {
      instances.value = []
      instancesTotal.value = 0
      ElMessage.error(response.data?.message || t('coupons.messages.instancesLoadFailed'))
    }
  } catch (error) {
    instances.value = []
    instancesTotal.value = 0
    ElMessage.error(t('coupons.messages.instancesLoadFailed') + ': ' + (error.response?.data?.message || error.message))
  } finally {
    loadingInstances.value = false
  }
}

const loadCategoryOptions = async () => {
  try {
    const res = await productAPI.getProductCategories()
    if (res.data?.success && Array.isArray(res.data.data)) {
      categoryOptions.value = res.data.data
    }
  } catch (e) {
    console.error('加载商品类别失败:', e)
  }
}

const loadProductOptions = async () => {
  try {
    const res = await productAPI.getProducts({ page: 1, pageSize: 200 })
    if (res.data?.success) {
      productOptions.value = res.data.data?.products || []
    }
  } catch (e) {
    console.error('加载商品列表失败:', e)
  }
}

onMounted(async () => {
  await Promise.all([loadCategoryOptions(), loadProductOptions()])
  await loadTemplates()
})
</script>

<style scoped>
.coupon-templates {
  padding: 0;
}

.filter-section {
  margin-bottom: 20px;
}

.search-form {
  padding: 8px 0;
}

.table-section {
  margin-bottom: 20px;
}

.table-wrapper {
  overflow-x: auto;
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

.amount-text {
  font-weight: 600;
  color: #f56c6c;
}

.validity-text {
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
}

.muted-text {
  color: #c0c4cc;
}

.pagination-section {
  padding: 20px;
  text-align: center;
  border-top: 1px solid #EBEEF5;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.action-buttons {
  display: flex;
  gap: 8px;
  justify-content: center;
  align-items: center;
  white-space: nowrap;
}

.action-buttons .el-button {
  margin: 0 !important;
  min-width: 60px;
  flex-shrink: 0;
}

.field-hint {
  margin: 6px 0 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.45;
}

.coupon-dialog .el-select {
  width: 100%;
}

.coupon-dialog .el-input-number {
  width: 100%;
}

.coupon-dialog .el-dialog__footer {
  padding: 20px 24px;
  border-top: 1px solid #ebeef5;
  background: #fafbfc;
}
</style>
