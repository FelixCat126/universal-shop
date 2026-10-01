<template>
  <div class="promotions">
    <div class="filter-section">
      <el-card>
        <el-form :model="searchForm" inline class="search-form">
          <el-form-item :label="t('promotions.filterStatus')">
            <el-select
              v-model="searchForm.status"
              :placeholder="t('promotions.filterStatus')"
              clearable
              style="width: 140px"
              @change="handleSearch"
            >
              <el-option :label="t('promotions.statusActive')" value="active" />
              <el-option :label="t('promotions.statusInactive')" value="inactive" />
            </el-select>
          </el-form-item>
          <el-form-item :label="t('promotions.filterType')">
            <el-select
              v-model="searchForm.type"
              :placeholder="t('promotions.filterType')"
              clearable
              style="width: 160px"
              @change="handleSearch"
            >
              <el-option :label="t('promotions.typeThreshold')" value="threshold" />
              <el-option :label="t('promotions.typeBuyGet')" value="buy_x_get_y" />
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
        {{ t('promotions.addPromotion') }}
      </el-button>
    </div>

    <div class="table-section">
      <el-card>
        <template #header>
          <div class="table-header">
            <span>{{ t('promotions.title') }}</span>
            <span class="table-info">{{ t('promotions.listTotal') }} {{ totalPromotions }}</span>
          </div>
        </template>
        <div class="table-wrapper">
          <el-table
            :data="promotions"
            style="width: 100%; min-width: 1200px"
            v-loading="loading"
            row-key="id"
            border
            stripe
            table-layout="fixed"
          >
            <el-table-column prop="id" label="ID" width="70" />

            <el-table-column prop="name" :label="t('promotions.name')" min-width="150" show-overflow-tooltip />

            <el-table-column :label="t('promotions.type')" width="100" align="center">
              <template #default="scope">
                <el-tag size="small">{{ typeLabel(scope.row.type) }}</el-tag>
              </template>
            </el-table-column>

            <el-table-column :label="t('promotions.rulesSummary')" min-width="190" show-overflow-tooltip>
              <template #default="scope">
                <span>{{ rulesSummary(scope.row) }}</span>
              </template>
            </el-table-column>

            <el-table-column :label="t('promotions.scope')" width="140" align="center">
              <template #default="scope">
                <el-tag type="info" size="small">{{ scopeSummary(scope.row) }}</el-tag>
              </template>
            </el-table-column>

            <el-table-column prop="priority" :label="t('promotions.priority')" width="90" align="center" />

            <el-table-column :label="t('promotions.status')" width="110" align="center">
              <template #default="scope">
                <el-switch
                  :model-value="scope.row.status === 'active'"
                  :loading="scope.row.__statusLoading"
                  inline-prompt
                  :active-text="t('promotions.statusActive')"
                  :inactive-text="t('promotions.statusInactive')"
                  @change="(val) => handleStatusToggle(scope.row, val)"
                />
              </template>
            </el-table-column>

            <el-table-column :label="t('promotions.validity')" min-width="180">
              <template #default="scope">
                <span class="validity-text">{{ validityText(scope.row) }}</span>
              </template>
            </el-table-column>

            <el-table-column :label="t('promotions.actions')" width="170" fixed="right">
              <template #default="scope">
                <div class="action-buttons">
                  <el-button size="small" @click="editPromotion(scope.row)">
                    {{ t('promotions.edit') }}
                  </el-button>
                  <el-button size="small" type="danger" @click="deletePromotion(scope.row)">
                    {{ t('promotions.delete') }}
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
            :total="totalPromotions"
            layout="total, sizes, prev, pager, next, jumper"
            @size-change="handleSizeChange"
            @current-change="handleCurrentChange"
          />
        </div>
      </el-card>
    </div>

    <!-- 新建/编辑促销对话框 -->
    <el-dialog
      :title="isEditing ? t('promotions.editPromotion') : t('promotions.addPromotion')"
      v-model="showPromotionDialog"
      width="720px"
      top="3vh"
      class="promotion-dialog"
      @close="resetPromotionForm"
    >
      <div class="dialog-content">
        <el-form
          :model="promotionForm"
          :rules="promotionRules"
          ref="promotionFormRef"
          label-width="110px"
        >
          <el-form-item :label="t('promotions.name')" prop="name">
            <el-input v-model="promotionForm.name" :placeholder="t('promotions.placeholders.enterName')" />
          </el-form-item>

          <el-form-item :label="t('promotions.type')" prop="type">
            <el-select v-model="promotionForm.type" style="width: 100%">
              <el-option :label="t('promotions.typeThreshold')" value="threshold" />
              <el-option :label="t('promotions.typeBuyGet')" value="buy_x_get_y" />
            </el-select>
          </el-form-item>

          <!-- 满减档位动态编辑器（1-5 档，行内校验 off<min） -->
          <el-form-item v-if="promotionForm.type === 'threshold'" :label="t('promotions.tiers')">
            <div class="tiers-editor">
              <div class="tiers-header">
                <span class="tier-col-label">{{ t('promotions.tierMin') }}</span>
                <span class="tier-col-label">{{ t('promotions.tierOff') }}</span>
                <span class="tier-col-action"></span>
              </div>
              <div v-for="(tier, index) in promotionForm.tiers" :key="index" class="tier-row">
                <div class="tier-fields">
                  <el-input-number
                    v-model="tier.min"
                    :min="0"
                    :precision="2"
                    :step="1"
                    :placeholder="t('promotions.placeholders.enterMin')"
                    class="tier-input"
                  />
                  <el-input-number
                    v-model="tier.off"
                    :min="0"
                    :precision="2"
                    :step="1"
                    :placeholder="t('promotions.placeholders.enterOff')"
                    class="tier-input"
                  />
                  <el-button
                    type="danger"
                    link
                    class="tier-remove"
                    :disabled="promotionForm.tiers.length <= 1"
                    @click="removeTier(index)"
                  >
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </div>
                <p v-if="tierRowError(tier)" class="tier-row-error">{{ tierRowError(tier) }}</p>
              </div>
              <el-button size="small" :disabled="promotionForm.tiers.length >= 5" @click="addTier">
                <el-icon><Plus /></el-icon>
                {{ t('promotions.addTier') }}
              </el-button>
              <p class="tiers-hint">{{ t('promotions.tiersHint') }}</p>
            </div>
          </el-form-item>

          <!-- 买多赠一规则编辑器（赠同品用 0 占位，提交时归一为 null） -->
          <el-form-item v-else-if="promotionForm.type === 'buy_x_get_y'" :label="t('promotions.buyGetRules')">
            <div class="tiers-editor">
              <div class="buyget-fields">
                <div class="buyget-field">
                  <span class="tier-col-label">{{ t('promotions.buyQuantity') }}</span>
                  <el-input-number
                    v-model="promotionForm.buyGet.buy"
                    :min="1"
                    :precision="0"
                    :step="1"
                    :placeholder="t('promotions.placeholders.enterBuy')"
                  />
                </div>
                <div class="buyget-field">
                  <span class="tier-col-label">{{ t('promotions.getQuantity') }}</span>
                  <el-input-number
                    v-model="promotionForm.buyGet.get"
                    :min="1"
                    :precision="0"
                    :step="1"
                    :placeholder="t('promotions.placeholders.enterGet')"
                  />
                </div>
              </div>
              <el-select
                v-model="promotionForm.buyGet.giftProductId"
                filterable
                :placeholder="t('promotions.placeholders.selectGiftProduct')"
                style="width: 100%"
              >
                <el-option
                  v-if="allowSameAsPurchased"
                  :label="t('promotions.giftSameAsPurchased')"
                  :value="0"
                />
                <el-option
                  v-for="opt in productOptions"
                  :key="opt.id"
                  :label="opt.name"
                  :value="opt.id"
                />
              </el-select>
              <p class="tiers-hint">{{ buyGetGiftHint }}</p>
            </div>
          </el-form-item>

          <el-form-item :label="t('promotions.scope')">
            <el-radio-group v-model="promotionForm.scopeType" @change="handleScopeTypeChange">
              <el-radio value="all">{{ t('promotions.scopeAll') }}</el-radio>
              <el-radio value="category">{{ t('promotions.scopeCategory') }}</el-radio>
              <el-radio value="product">{{ t('promotions.scopeProduct') }}</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item v-if="promotionForm.scopeType === 'category'" :label="t('promotions.scopeCategory')">
            <el-select
              v-model="promotionForm.scopeIds"
              multiple
              collapse-tags
              collapse-tags-tooltip
              :placeholder="t('promotions.placeholders.selectCategories')"
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

          <el-form-item v-if="promotionForm.scopeType === 'product'" :label="t('promotions.scopeProduct')">
            <el-select
              v-model="promotionForm.scopeIds"
              multiple
              filterable
              collapse-tags
              collapse-tags-tooltip
              :placeholder="t('promotions.placeholders.selectProducts')"
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

          <el-form-item :label="t('promotions.validity')">
            <el-date-picker
              v-model="promotionForm.timeRange"
              type="datetimerange"
              :start-placeholder="t('promotions.validityStart')"
              :end-placeholder="t('promotions.validityEnd')"
              value-format="YYYY-MM-DD HH:mm:ss"
              style="width: 100%"
            />
          </el-form-item>

          <el-row :gutter="20" class="form-row">
            <el-col :span="12">
              <el-form-item :label="t('promotions.priority')">
                <el-input-number
                  v-model="promotionForm.priority"
                  :min="0"
                  :precision="0"
                  :step="1"
                  style="width: 100%"
                />
                <p class="field-hint">{{ t('promotions.priorityHint') }}</p>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item :label="t('promotions.status')">
                <el-switch
                  v-model="promotionForm.status"
                  active-value="active"
                  inactive-value="inactive"
                  inline-prompt
                  :active-text="t('promotions.statusActive')"
                  :inactive-text="t('promotions.statusInactive')"
                />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
      </div>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showPromotionDialog = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" @click="savePromotion">
            {{ isEditing ? t('promotions.updatePromotion') : t('promotions.addPromotion') }}
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, Refresh, Delete } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { promotionAPI } from '../api/promotions.js'
import { productAPI } from '../api/products.js'

const { t } = useI18n()

const loading = ref(false)
const showPromotionDialog = ref(false)
const isEditing = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
const totalPromotions = ref(0)
const promotionFormRef = ref(null)

// 搜索表单
const searchForm = reactive({
  status: '',
  type: ''
})

// 促销表单（timeRange 为 [start_at, end_at] 字符串对，提交时展开）
// buyGet.giftProductId 用 0 表示「同购买商品」（仅单个商品范围可选），提交时归一为 null
const promotionForm = reactive({
  id: null,
  name: '',
  type: 'threshold',
  tiers: [{ min: null, off: null }],
  buyGet: { buy: 3, get: 1, giftProductId: null },
  scopeType: 'all',
  scopeIds: [],
  timeRange: null,
  priority: 0,
  status: 'active'
})

const promotionRules = {
  name: [
    { required: true, message: t('promotions.validation.nameRequired'), trigger: 'blur' }
  ],
  type: [
    { required: true, message: t('promotions.validation.typeRequired'), trigger: 'change' }
  ]
}

const promotions = ref([])
const categoryOptions = ref([])
const productOptions = ref([])

// rules/scope 在服务端可能是对象或 JSON 字符串，编辑/展示前统一归一
const parseMaybeJson = (val, fallback) => {
  if (val == null) return fallback
  if (typeof val === 'object') return val
  try {
    return JSON.parse(val)
  } catch (_) {
    return fallback
  }
}

const typeLabel = (type) => {
  if (type === 'threshold') return t('promotions.typeThreshold')
  if (type === 'buy_x_get_y') return t('promotions.typeBuyGet')
  return type || '-'
}

// 赠品名称：空值表示赠同品；productOptions 未覆盖时回退 #id
const giftNameOf = (giftProductId) => {
  const id = Number(giftProductId)
  if (!Number.isInteger(id) || id <= 0) return t('promotions.giftSameProduct')
  const found = productOptions.value.find(p => Number(p.id) === id)
  return found ? found.name : `#${id}`
}

const rulesSummary = (row) => {
  const rules = parseMaybeJson(row.rules, {})
  if (row.type === 'buy_x_get_y') {
    const buy = Number(rules.buy)
    const get = Number(rules.get)
    if (!Number.isInteger(buy) || !Number.isInteger(get) || buy < 1 || get < 1) return '-'
    return t('promotions.buyGetSummary', { buy, get, gift: giftNameOf(rules.gift_product_id) })
  }
  const tiers = Array.isArray(rules.tiers) ? rules.tiers : []
  if (!tiers.length) return '-'
  return tiers.map(tier => t('promotions.tierSummary', { min: tier.min, off: tier.off })).join('; ')
}

const scopeSummary = (row) => {
  const scope = parseMaybeJson(row.scope, {})
  const count = Array.isArray(scope.ids) ? scope.ids.length : 0
  if (scope.type === 'category') return t('promotions.scopeCategoryCount', { count })
  if (scope.type === 'product') return t('promotions.scopeProductCount', { count })
  return t('promotions.scopeAll')
}

const validityText = (row) => {
  if (!row.start_at && !row.end_at) return t('promotions.validityForever')
  return `${row.start_at || '…'} ~ ${row.end_at || '…'}`
}

// 行内校验：min>0、off>0、off<min（未填写的行不报错，提交时统一拦截）
const tierRowError = (tier) => {
  const min = Number(tier.min)
  const off = Number(tier.off)
  const minFilled = tier.min !== null && tier.min !== undefined && Number.isFinite(min)
  const offFilled = tier.off !== null && tier.off !== undefined && Number.isFinite(off)
  if (minFilled && min <= 0) return t('promotions.validation.minPositive')
  if (offFilled && off <= 0) return t('promotions.validation.offPositive')
  if (minFilled && offFilled && min > 0 && off >= min) return t('promotions.validation.offLessThanMin')
  return ''
}

// 「同购买商品」赠品仅当范围为单个商品时可选
const allowSameAsPurchased = computed(() =>
  promotionForm.scopeType === 'product' && promotionForm.scopeIds.length === 1
)

const buyGetGiftHint = computed(() =>
  allowSameAsPurchased.value
    ? t('promotions.giftHintSingle')
    : t('promotions.giftHintRequired')
)

// 范围不再是单个商品时，「同购买商品」选项失效，重置为未选
watch(
  () => [promotionForm.scopeType, promotionForm.scopeIds.length],
  () => {
    if (!allowSameAsPurchased.value && promotionForm.buyGet.giftProductId === 0) {
      promotionForm.buyGet.giftProductId = null
    }
  }
)

const addTier = () => {
  if (promotionForm.tiers.length >= 5) return
  promotionForm.tiers.push({ min: null, off: null })
}

const removeTier = (index) => {
  if (promotionForm.tiers.length <= 1) return
  promotionForm.tiers.splice(index, 1)
}

// 切换范围类型时清空已选项，避免残留上一类型的 id
const handleScopeTypeChange = () => {
  promotionForm.scopeIds = []
}

const validatePromotionForm = () => {
  if (promotionForm.type === 'buy_x_get_y') {
    const buy = Number(promotionForm.buyGet.buy)
    const get = Number(promotionForm.buyGet.get)
    if (!Number.isInteger(buy) || buy < 1) {
      ElMessage.error(t('promotions.validation.buyPositive'))
      return false
    }
    if (!Number.isInteger(get) || get < 1) {
      ElMessage.error(t('promotions.validation.getPositive'))
      return false
    }
    // 范围为全场/分类/多个商品时必须指定具体赠品；单个商品时可不选（赠同品）
    const giftId = Number(promotionForm.buyGet.giftProductId)
    if (!allowSameAsPurchased.value && (!Number.isInteger(giftId) || giftId < 1)) {
      ElMessage.error(t('promotions.validation.giftRequired'))
      return false
    }
  } else {
    const tiers = promotionForm.tiers
    if (!tiers.length || tiers.length > 5) {
      ElMessage.error(t('promotions.validation.tiersCount'))
      return false
    }
    for (const tier of tiers) {
      const min = Number(tier.min)
      const off = Number(tier.off)
      if (!Number.isFinite(min) || min <= 0) {
        ElMessage.error(t('promotions.validation.minPositive'))
        return false
      }
      if (!Number.isFinite(off) || off <= 0) {
        ElMessage.error(t('promotions.validation.offPositive'))
        return false
      }
      if (off >= min) {
        ElMessage.error(t('promotions.validation.offLessThanMin'))
        return false
      }
    }
  }
  if (promotionForm.scopeType !== 'all' && promotionForm.scopeIds.length === 0) {
    ElMessage.error(t('promotions.validation.scopeIdsRequired'))
    return false
  }
  const [start, end] = promotionForm.timeRange || []
  if (start && end && new Date(start).getTime() >= new Date(end).getTime()) {
    ElMessage.error(t('promotions.validation.timeRangeInvalid'))
    return false
  }
  return true
}

const buildPayload = () => {
  const [start, end] = promotionForm.timeRange || []
  const rules = promotionForm.type === 'buy_x_get_y'
    ? {
        buy: Number(promotionForm.buyGet.buy),
        get: Number(promotionForm.buyGet.get),
        gift_product_id: Number(promotionForm.buyGet.giftProductId) > 0
          ? Number(promotionForm.buyGet.giftProductId)
          : null
      }
    : {
        tiers: promotionForm.tiers.map(tier => ({ min: Number(tier.min), off: Number(tier.off) }))
      }
  return {
    name: promotionForm.name.trim(),
    type: promotionForm.type,
    rules,
    scope: {
      type: promotionForm.scopeType,
      ids: promotionForm.scopeType === 'all' ? [] : [...promotionForm.scopeIds]
    },
    start_at: start || null,
    end_at: end || null,
    priority: Number(promotionForm.priority) || 0,
    status: promotionForm.status
  }
}

const showAddDialog = () => {
  isEditing.value = false
  resetPromotionForm()
  setTimeout(() => {
    showPromotionDialog.value = true
  }, 10)
}

const editPromotion = (row) => {
  isEditing.value = true
  const rules = parseMaybeJson(row.rules, {})
  const scope = parseMaybeJson(row.scope, {})
  const scopeType = ['all', 'category', 'product'].includes(scope.type) ? scope.type : 'all'
  const scopeIds = Array.isArray(scope.ids) ? scope.ids.map(Number) : []
  const tiers = Array.isArray(rules.tiers) && rules.tiers.length
    ? rules.tiers.map(tier => ({ min: Number(tier.min), off: Number(tier.off) }))
    : [{ min: null, off: null }]
  const giftId = Number(rules.gift_product_id)
  const singleProductScope = scopeType === 'product' && scopeIds.length === 1
  Object.assign(promotionForm, {
    id: row.id,
    name: row.name || '',
    type: row.type || 'threshold',
    tiers,
    buyGet: row.type === 'buy_x_get_y'
      ? {
          buy: Number(rules.buy) || null,
          get: Number(rules.get) || null,
          giftProductId: Number.isInteger(giftId) && giftId > 0 ? giftId : (singleProductScope ? 0 : null)
        }
      : { buy: 3, get: 1, giftProductId: null },
    scopeType,
    scopeIds,
    timeRange: row.start_at || row.end_at ? [row.start_at || null, row.end_at || null] : null,
    priority: Number(row.priority) || 0,
    status: row.status === 'inactive' ? 'inactive' : 'active'
  })
  showPromotionDialog.value = true
}

const resetPromotionForm = () => {
  if (promotionFormRef.value) {
    promotionFormRef.value.resetFields()
    promotionFormRef.value.clearValidate()
  }
  promotionForm.id = null
  promotionForm.name = ''
  promotionForm.type = 'threshold'
  promotionForm.tiers = [{ min: null, off: null }]
  promotionForm.buyGet = { buy: 3, get: 1, giftProductId: null }
  promotionForm.scopeType = 'all'
  promotionForm.scopeIds = []
  promotionForm.timeRange = null
  promotionForm.priority = 0
  promotionForm.status = 'active'
  setTimeout(() => {
    if (promotionFormRef.value) {
      promotionFormRef.value.clearValidate()
    }
  }, 50)
}

const savePromotion = async () => {
  if (!promotionFormRef.value) return

  try {
    await promotionFormRef.value.validate()
    if (!validatePromotionForm()) return

    const confirmMessage = isEditing.value
      ? t('promotions.messages.confirmUpdate')
      : t('promotions.messages.confirmAdd')

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
      ? await promotionAPI.update(promotionForm.id, payload)
      : await promotionAPI.create(payload)

    if (response.data.success) {
      ElMessage.success(isEditing.value
        ? t('promotions.messages.updateSuccess')
        : t('promotions.messages.addSuccess'))
      showPromotionDialog.value = false
      resetPromotionForm()
      loadPromotions()
    } else {
      ElMessage.error(response.data.message || t('promotions.messages.saveFailed'))
    }
  } catch (error) {
    if (error === 'cancel') return
    console.error('保存促销失败:', error)
    ElMessage.error(t('promotions.messages.saveFailed') + ': ' + (error.response?.data?.message || error.message))
  }
}

const deletePromotion = async (row) => {
  try {
    await ElMessageBox.confirm(
      t('promotions.messages.confirmDelete', { name: row.name }),
      t('common.confirm'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )

    const response = await promotionAPI.remove(row.id)
    if (response.data.success) {
      ElMessage.success(t('promotions.messages.deleteSuccess'))
      loadPromotions()
    } else {
      ElMessage.error(response.data.message || t('promotions.messages.deleteFailed'))
    }
  } catch (error) {
    if (error === 'cancel') return
    ElMessage.error(t('promotions.messages.deleteFailed') + ': ' + (error.response?.data?.message || error.message))
  }
}

const handleStatusToggle = async (row, val) => {
  const status = val ? 'active' : 'inactive'
  row.__statusLoading = true
  try {
    const response = await promotionAPI.updateStatus(row.id, status)
    if (response.data?.success) {
      row.status = status
      ElMessage.success(t('promotions.messages.statusUpdateSuccess'))
    } else {
      ElMessage.error(response.data?.message || t('promotions.messages.statusUpdateFailed'))
    }
  } catch (error) {
    ElMessage.error(t('promotions.messages.statusUpdateFailed') + ': ' + (error.response?.data?.message || error.message))
  } finally {
    row.__statusLoading = false
  }
}

const handleSearch = () => {
  currentPage.value = 1
  loadPromotions()
}

const resetSearch = () => {
  Object.assign(searchForm, { status: '', type: '' })
  currentPage.value = 1
  loadPromotions()
}

const handleSizeChange = (val) => {
  pageSize.value = val
  currentPage.value = 1
  loadPromotions()
}

const handleCurrentChange = (val) => {
  currentPage.value = val
  loadPromotions()
}

const loadPromotions = async () => {
  try {
    loading.value = true
    const params = {
      page: currentPage.value,
      pageSize: pageSize.value,
      status: searchForm.status || undefined,
      type: searchForm.type || undefined
    }
    const response = await promotionAPI.list(params)
    if (response.data.success) {
      const data = response.data.data || {}
      promotions.value = Array.isArray(data.list)
        ? data.list
        : (Array.isArray(data.promotions) ? data.promotions : [])
      const pg = data.pagination || {}
      totalPromotions.value = Number(pg.total ?? data.total ?? 0)

      // 删除后当前页可能超出总页数，回退到最后一页
      const totalPages = Number(pg.totalPages) || Math.ceil(totalPromotions.value / pageSize.value)
      if (totalPages > 0 && currentPage.value > totalPages) {
        currentPage.value = totalPages
        await loadPromotions()
        return
      }
    }
  } catch (error) {
    console.error('加载促销列表失败:', error)
    ElMessage.error(t('promotions.messages.loadFailed') + ': ' + (error.response?.data?.message || error.message))
  } finally {
    loading.value = false
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
  await loadPromotions()
})
</script>

<style scoped>
.promotions {
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

.validity-text {
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
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

/* 档位编辑器 */
.tiers-editor {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tiers-header {
  display: flex;
  gap: 10px;
}

.tier-col-label {
  flex: 1;
  font-size: 12px;
  color: #909399;
}

.tier-col-action {
  width: 32px;
  flex-shrink: 0;
}

.tier-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tier-fields {
  display: flex;
  gap: 10px;
  align-items: center;
}

.tier-input {
  flex: 1;
}

/* 买多赠一编辑器 */
.buyget-fields {
  display: flex;
  gap: 10px;
}

.buyget-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tier-remove {
  width: 32px;
  flex-shrink: 0;
}

.tier-row-error {
  margin: 0;
  font-size: 12px;
  color: #F56C6C;
  line-height: 1.4;
}

.tiers-hint {
  margin: 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.45;
}

.field-hint {
  margin: 6px 0 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.45;
}

.promotion-dialog .el-select {
  width: 100%;
}

.promotion-dialog .el-input-number {
  width: 100%;
}

.promotion-dialog .tier-input {
  width: auto;
}

.promotion-dialog .el-dialog__footer {
  padding: 20px 24px;
  border-top: 1px solid #ebeef5;
  background: #fafbfc;
}
</style>
