<template>
  <div class="bundles">
    <div class="filter-section">
      <el-card>
        <el-form :model="searchForm" inline class="search-form">
          <el-form-item :label="t('bundles.filterStatus')">
            <el-select
              v-model="searchForm.status"
              :placeholder="t('bundles.filterStatus')"
              clearable
              style="width: 140px"
              @change="handleSearch"
            >
              <el-option :label="t('bundles.statusActive')" value="active" />
              <el-option :label="t('bundles.statusInactive')" value="inactive" />
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
        {{ t('bundles.addBundle') }}
      </el-button>
    </div>

    <div class="table-section">
      <el-card>
        <template #header>
          <div class="table-header">
            <span>{{ t('bundles.title') }}</span>
            <span class="table-info">{{ t('bundles.listTotal') }} {{ totalBundles }}</span>
          </div>
        </template>
        <div class="table-wrapper">
          <el-table
            :data="bundles"
            style="width: 100%; min-width: 1200px"
            v-loading="loading"
            row-key="id"
            border
            stripe
            table-layout="fixed"
          >
            <el-table-column prop="id" label="ID" width="70" />

            <el-table-column prop="name" :label="t('bundles.name')" min-width="150" show-overflow-tooltip />

            <el-table-column :label="t('bundles.price')" width="110" align="right">
              <template #default="scope">
                <span class="price-text">{{ formatMoney(scope.row.price) }}</span>
              </template>
            </el-table-column>

            <el-table-column :label="t('bundles.standaloneTotal')" width="110" align="right">
              <template #default="scope">
                <span>{{ formatMoney(standaloneTotal(scope.row)) }}</span>
              </template>
            </el-table-column>

            <el-table-column :label="t('bundles.saveAmount')" width="100" align="right">
              <template #default="scope">
                <span v-if="saveAmount(scope.row) > 0" class="save-text">
                  {{ formatMoney(saveAmount(scope.row)) }}
                </span>
                <span v-else>-</span>
              </template>
            </el-table-column>

            <el-table-column :label="t('bundles.itemsSummary')" min-width="200" show-overflow-tooltip>
              <template #default="scope">
                <span>{{ itemsSummary(scope.row) }}</span>
              </template>
            </el-table-column>

            <el-table-column :label="t('bundles.availableStock')" width="100" align="center">
              <template #default="scope">
                <el-tag :type="availableStock(scope.row) > 0 ? 'success' : 'danger'" size="small">
                  {{ availableStock(scope.row) }}
                </el-tag>
              </template>
            </el-table-column>

            <el-table-column :label="t('bundles.status')" width="110" align="center">
              <template #default="scope">
                <el-switch
                  :model-value="scope.row.status === 'active'"
                  :loading="scope.row.__statusLoading"
                  inline-prompt
                  :active-text="t('bundles.statusActive')"
                  :inactive-text="t('bundles.statusInactive')"
                  @change="(val) => handleStatusToggle(scope.row, val)"
                />
              </template>
            </el-table-column>

            <el-table-column :label="t('bundles.actions')" width="170" fixed="right">
              <template #default="scope">
                <div class="action-buttons">
                  <el-button size="small" @click="editBundle(scope.row)">
                    {{ t('bundles.edit') }}
                  </el-button>
                  <el-button size="small" type="danger" @click="deleteBundle(scope.row)">
                    {{ t('bundles.delete') }}
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
            :total="totalBundles"
            layout="total, sizes, prev, pager, next, jumper"
            @size-change="handleSizeChange"
            @current-change="handleCurrentChange"
          />
        </div>
      </el-card>
    </div>

    <!-- 新建/编辑套餐对话框 -->
    <el-dialog
      :title="isEditing ? t('bundles.editBundle') : t('bundles.addBundle')"
      v-model="showBundleDialog"
      width="720px"
      top="3vh"
      class="bundle-dialog"
      @close="resetBundleForm"
    >
      <div class="dialog-content">
        <el-form
          :model="bundleForm"
          :rules="bundleRules"
          ref="bundleFormRef"
          label-width="110px"
        >
          <el-form-item :label="t('bundles.name')" prop="name">
            <el-input v-model="bundleForm.name" :placeholder="t('bundles.placeholders.enterName')" />
          </el-form-item>

          <el-form-item :label="t('bundles.nameTh')">
            <el-input v-model="bundleForm.nameTh" :placeholder="t('bundles.placeholders.enterNameTh')" />
          </el-form-item>

          <el-form-item :label="t('bundles.description')">
            <el-input
              v-model="bundleForm.description"
              type="textarea"
              :rows="2"
              :placeholder="t('bundles.placeholders.enterDescription')"
            />
          </el-form-item>

          <el-form-item :label="t('bundles.price')" prop="price">
            <el-input-number
              v-model="bundleForm.price"
              :min="0"
              :precision="2"
              :step="1"
              style="width: 100%"
            />
          </el-form-item>

          <el-form-item :label="t('bundles.image')">
            <el-upload
              class="image-uploader"
              action="/api/upload/product-image"
              :show-file-list="false"
              :on-success="handleImageSuccess"
              :on-error="handleImageError"
              :before-upload="beforeImageUpload"
              accept="image/*"
              name="image"
            >
              <img v-if="bundleForm.imagePreview" :src="bundleForm.imagePreview" class="image-preview" />
              <el-icon v-else class="image-uploader-icon"><Plus /></el-icon>
            </el-upload>
            <div class="image-tips">{{ t('products.image.uploadTips') }}</div>
            <div class="image-actions" v-if="bundleForm.imagePreview">
              <el-button size="small" @click="clearImage">{{ t('products.image.clearImage') }}</el-button>
            </div>
          </el-form-item>

          <!-- 组件编辑器（1-10 行，商品可搜索下拉 + 数量，商品不可重复） -->
          <el-form-item :label="t('bundles.items')">
            <div class="items-editor">
              <div class="items-header">
                <span class="item-col-label">{{ t('bundles.itemProduct') }}</span>
                <span class="item-col-label item-col-qty">{{ t('bundles.itemQuantity') }}</span>
                <span class="item-col-action"></span>
              </div>
              <div v-for="(row, index) in bundleForm.items" :key="index" class="item-row">
                <el-select
                  v-model="row.product_id"
                  filterable
                  :placeholder="t('bundles.placeholders.selectProduct')"
                  class="item-product-select"
                >
                  <el-option
                    v-for="opt in availableProductOptions(index)"
                    :key="opt.id"
                    :label="opt.name"
                    :value="opt.id"
                  />
                </el-select>
                <el-input-number
                  v-model="row.quantity"
                  :min="1"
                  :precision="0"
                  :step="1"
                  class="item-qty-input"
                />
                <el-button
                  type="danger"
                  link
                  class="item-remove"
                  :disabled="bundleForm.items.length <= 1"
                  @click="removeItem(index)"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
              <el-button size="small" :disabled="bundleForm.items.length >= 10" @click="addItem">
                <el-icon><Plus /></el-icon>
                {{ t('bundles.addItem') }}
              </el-button>
              <p class="items-hint">{{ t('bundles.itemsHint') }}</p>
            </div>
          </el-form-item>

          <el-form-item :label="t('bundles.status')">
            <el-switch
              v-model="bundleForm.status"
              active-value="active"
              inactive-value="inactive"
              inline-prompt
              :active-text="t('bundles.statusActive')"
              :inactive-text="t('bundles.statusInactive')"
            />
          </el-form-item>
        </el-form>
      </div>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showBundleDialog = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" :loading="saving" @click="saveBundle">
            {{ isEditing ? t('bundles.updateBundle') : t('bundles.addBundle') }}
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, Refresh, Delete } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { bundleAPI } from '../api/bundles.js'
import { productAPI } from '../api/products.js'

const { t } = useI18n()

const loading = ref(false)
const saving = ref(false)
const showBundleDialog = ref(false)
const isEditing = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
const totalBundles = ref(0)
const bundleFormRef = ref(null)

// 搜索表单
const searchForm = reactive({
  status: ''
})

// 套餐表单（items 为动态组件行，提交时归一为 [{ product_id, quantity }]）
const bundleForm = reactive({
  id: null,
  name: '',
  nameTh: '',
  description: '',
  price: null,
  image: '',
  imagePreview: '', // 用于预览显示
  status: 'active',
  items: [{ product_id: null, quantity: 1 }]
})

const bundleRules = {
  name: [
    { required: true, message: t('bundles.validation.nameRequired'), trigger: 'blur' }
  ]
}

const bundles = ref([])
const productOptions = ref([])

// items 在服务端可能是数组或 JSON 字符串，编辑/展示前统一归一
const parseMaybeJson = (val, fallback) => {
  if (val == null) return fallback
  if (typeof val === 'object') return val
  try {
    return JSON.parse(val)
  } catch (_) {
    return fallback
  }
}

const itemsOf = (row) => {
  const items = parseMaybeJson(row?.items, [])
  return Array.isArray(items) ? items : []
}

const formatMoney = (val) => {
  const n = Number(val)
  return Number.isFinite(n) ? n.toFixed(2) : '-'
}

// 单独总价：优先用服务端 standalone_total，缺失时按组件现价求和兜底
const standaloneTotal = (row) => {
  const v = Number(row?.standalone_total)
  if (Number.isFinite(v)) return v
  return itemsOf(row).reduce((sum, it) =>
    sum + Number(it.product?.price || 0) * Number(it.quantity || 0), 0)
}

const saveAmount = (row) => {
  const save = standaloneTotal(row) - Number(row?.price)
  return Number.isFinite(save) && save > 0 ? save : 0
}

// 组件摘要：A×2 + B×1
const itemsSummary = (row) => {
  const items = itemsOf(row)
  if (!items.length) return '-'
  return items
    .map(it => `${it.product?.name || `#${it.product_id}`}×${it.quantity}`)
    .join(' + ')
}

// 可售套数：优先用服务端 available_stock，缺失时按组件库存取 min(floor(stock/qty)) 兜底
const availableStock = (row) => {
  const v = Number(row?.available_stock)
  if (Number.isFinite(v)) return v
  const items = itemsOf(row)
  if (!items.length) return 0
  return Math.min(...items.map(it =>
    Math.floor(Number(it.product?.stock ?? 0) / (Number(it.quantity) || 1))
  ))
}

// 当前行可选商品：排除其他行已选商品，避免重复组件
const availableProductOptions = (rowIndex) => {
  const selectedElsewhere = new Set(
    bundleForm.items
      .map((r, i) => (i !== rowIndex ? Number(r.product_id) : null))
      .filter(id => Number.isInteger(id) && id > 0)
  )
  return productOptions.value.filter(p => !selectedElsewhere.has(Number(p.id)))
}

const addItem = () => {
  if (bundleForm.items.length >= 10) return
  bundleForm.items.push({ product_id: null, quantity: 1 })
}

const removeItem = (index) => {
  if (bundleForm.items.length <= 1) return
  bundleForm.items.splice(index, 1)
}

const validateBundleForm = () => {
  const price = Number(bundleForm.price)
  if (!Number.isFinite(price) || price <= 0) {
    ElMessage.error(t('bundles.validation.pricePositive'))
    return false
  }
  const items = bundleForm.items
  if (!items.length || items.length > 10) {
    ElMessage.error(t('bundles.validation.itemsCount'))
    return false
  }
  const seen = new Set()
  for (const row of items) {
    const pid = Number(row.product_id)
    if (!Number.isInteger(pid) || pid < 1) {
      ElMessage.error(t('bundles.validation.itemProductRequired'))
      return false
    }
    const qty = Number(row.quantity)
    if (!Number.isInteger(qty) || qty < 1) {
      ElMessage.error(t('bundles.validation.itemQuantityPositive'))
      return false
    }
    if (seen.has(pid)) {
      ElMessage.error(t('bundles.validation.itemDuplicate'))
      return false
    }
    seen.add(pid)
  }
  return true
}

const buildPayload = () => {
  const nameTh = bundleForm.nameTh.trim()
  const description = bundleForm.description.trim()
  return {
    name: bundleForm.name.trim(),
    ...(nameTh ? { name_th: nameTh } : {}),
    ...(description ? { description } : {}),
    price: Number(bundleForm.price),
    ...(bundleForm.image ? { image: bundleForm.image } : {}),
    status: bundleForm.status,
    items: bundleForm.items.map(row => ({
      product_id: Number(row.product_id),
      quantity: Number(row.quantity)
    }))
  }
}

// 弹窗商品选项懒加载：首次打开对话框时才拉取，只拉一次
let dialogOptionsPromise = null
const ensureDialogOptions = () => {
  if (!dialogOptionsPromise) {
    dialogOptionsPromise = loadProductOptions()
  }
  return dialogOptionsPromise
}

const showAddDialog = () => {
  isEditing.value = false
  resetBundleForm()
  ensureDialogOptions()
  setTimeout(() => {
    showBundleDialog.value = true
  }, 10)
}

const editBundle = (row) => {
  isEditing.value = true
  ensureDialogOptions()
  const items = itemsOf(row)
  Object.assign(bundleForm, {
    id: row.id,
    name: row.name || '',
    nameTh: row.name_th || '',
    description: row.description || '',
    price: Number(row.price) || null,
    image: row.image || '',
    imagePreview: row.image || '', // 显示现有图片
    status: row.status === 'inactive' ? 'inactive' : 'active',
    items: items.length
      ? items.map(it => ({ product_id: Number(it.product_id), quantity: Number(it.quantity) || 1 }))
      : [{ product_id: null, quantity: 1 }]
  })
  showBundleDialog.value = true
}

const resetBundleForm = () => {
  if (bundleFormRef.value) {
    bundleFormRef.value.resetFields()
    bundleFormRef.value.clearValidate()
  }
  bundleForm.id = null
  bundleForm.name = ''
  bundleForm.nameTh = ''
  bundleForm.description = ''
  bundleForm.price = null
  bundleForm.image = ''
  bundleForm.imagePreview = ''
  bundleForm.status = 'active'
  bundleForm.items = [{ product_id: null, quantity: 1 }]
  setTimeout(() => {
    if (bundleFormRef.value) {
      bundleFormRef.value.clearValidate()
    }
  }, 50)
}

const saveBundle = async () => {
  if (!bundleFormRef.value || saving.value) return

  try {
    await bundleFormRef.value.validate()
    if (!validateBundleForm()) return

    const confirmMessage = isEditing.value
      ? t('bundles.messages.confirmUpdate')
      : t('bundles.messages.confirmAdd')

    await ElMessageBox.confirm(
      confirmMessage,
      t('common.confirm'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )

    // 确认后禁用保存按钮，防止请求期间重复提交
    saving.value = true
    const payload = buildPayload()
    const response = isEditing.value
      ? await bundleAPI.update(bundleForm.id, payload)
      : await bundleAPI.create(payload)

    if (response.data.success) {
      ElMessage.success(isEditing.value
        ? t('bundles.messages.updateSuccess')
        : t('bundles.messages.addSuccess'))
      showBundleDialog.value = false
      resetBundleForm()
      loadBundles()
    } else {
      ElMessage.error(response.data.message || t('bundles.messages.saveFailed'))
    }
  } catch (error) {
    if (error === 'cancel') return
    console.error('保存套餐失败:', error)
    ElMessage.error(t('bundles.messages.saveFailed') + ': ' + (error.response?.data?.message || error.message))
  } finally {
    saving.value = false
  }
}

const deleteBundle = async (row) => {
  try {
    await ElMessageBox.confirm(
      t('bundles.messages.confirmDelete', { name: row.name }),
      t('common.confirm'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )

    const response = await bundleAPI.remove(row.id)
    if (response.data.success) {
      ElMessage.success(t('bundles.messages.deleteSuccess'))
      loadBundles()
    } else {
      ElMessage.error(response.data.message || t('bundles.messages.deleteFailed'))
    }
  } catch (error) {
    if (error === 'cancel') return
    ElMessage.error(t('bundles.messages.deleteFailed') + ': ' + (error.response?.data?.message || error.message))
  }
}

const handleStatusToggle = async (row, val) => {
  const status = val ? 'active' : 'inactive'
  row.__statusLoading = true
  try {
    const response = await bundleAPI.updateStatus(row.id, status)
    if (response.data?.success) {
      row.status = status
      ElMessage.success(t('bundles.messages.statusUpdateSuccess'))
    } else {
      ElMessage.error(response.data?.message || t('bundles.messages.statusUpdateFailed'))
    }
  } catch (error) {
    ElMessage.error(t('bundles.messages.statusUpdateFailed') + ': ' + (error.response?.data?.message || error.message))
  } finally {
    row.__statusLoading = false
  }
}

const handleImageSuccess = (response, file) => {
  if (response.success) {
    // 使用服务器返回的图片URL
    bundleForm.image = response.data.url
    bundleForm.imagePreview = response.data.url
    ElMessage.success('图片上传成功')
  } else {
    ElMessage.error(response.message || t('products.image.uploadFailed'))
  }
}

const handleImageError = (error, file) => {
  console.error('图片上传失败:', error)
  ElMessage.error(t('products.image.uploadFailed') + '，请重试')
}

const clearImage = () => {
  bundleForm.image = ''
  bundleForm.imagePreview = ''
  ElMessage.info('图片已清除')
}

const beforeImageUpload = (file) => {
  const isJPGOrPNG = file.type === 'image/jpeg' || file.type === 'image/png'
  const isLt2M = file.size / 1024 / 1024 < 2

  if (!isJPGOrPNG) {
    ElMessage.error(t('products.image.onlyImageAllowed'))
    return false
  }
  if (!isLt2M) {
    ElMessage.error(t('products.image.imageTooLarge'))
    return false
  }
  return true
}

const handleSearch = () => {
  currentPage.value = 1
  loadBundles()
}

const resetSearch = () => {
  Object.assign(searchForm, { status: '' })
  currentPage.value = 1
  loadBundles()
}

const handleSizeChange = (val) => {
  pageSize.value = val
  currentPage.value = 1
  loadBundles()
}

const handleCurrentChange = (val) => {
  currentPage.value = val
  loadBundles()
}

const loadBundles = async () => {
  try {
    loading.value = true
    const params = {
      page: currentPage.value,
      pageSize: pageSize.value,
      status: searchForm.status || undefined
    }
    const response = await bundleAPI.list(params)
    if (response.data.success) {
      const data = response.data.data || {}
      bundles.value = Array.isArray(data)
        ? data
        : (Array.isArray(data.list) ? data.list : (Array.isArray(data.bundles) ? data.bundles : []))
      const pg = data.pagination || {}
      totalBundles.value = Number(pg.total ?? data.total ?? bundles.value.length)

      // 删除后当前页可能超出总页数，回退到最后一页
      const totalPages = Number(pg.totalPages) || Math.ceil(totalBundles.value / pageSize.value)
      if (totalPages > 0 && currentPage.value > totalPages) {
        currentPage.value = totalPages
        await loadBundles()
        return
      }
    }
  } catch (error) {
    console.error('加载组合套餐失败:', error)
    ElMessage.error(t('bundles.messages.loadFailed') + ': ' + (error.response?.data?.message || error.message))
  } finally {
    loading.value = false
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
  // 弹窗商品选项改为首次打开对话框时懒加载，见 ensureDialogOptions
  await loadBundles()
})
</script>

<style scoped>
.bundles {
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

.price-text {
  font-weight: 600;
  color: #303133;
}

.save-text {
  color: #F56C6C;
  font-weight: 500;
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

/* 组件编辑器 */
.items-editor {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.items-header {
  display: flex;
  gap: 10px;
}

.item-col-label {
  flex: 1;
  font-size: 12px;
  color: #909399;
}

.item-col-qty {
  flex: 0 0 140px;
}

.item-col-action {
  width: 32px;
  flex-shrink: 0;
}

.item-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.item-product-select {
  flex: 1;
}

.item-qty-input {
  flex: 0 0 140px;
}

.item-remove {
  width: 32px;
  flex-shrink: 0;
}

.items-hint {
  margin: 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.45;
}

/* 图片上传（与商品管理一致） */
.image-uploader {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.image-uploader:hover {
  border-color: #409EFF;
}

.image-uploader-icon {
  font-size: 28px;
  color: #8c939d;
}

.image-preview {
  width: 120px;
  height: 120px;
  object-fit: cover;
}

.image-tips {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
}

.image-actions {
  margin-top: 8px;
  text-align: center;
}

.bundle-dialog .el-select {
  width: 100%;
}

.bundle-dialog .el-dialog__footer {
  padding: 20px 24px;
  border-top: 1px solid #ebeef5;
  background: #fafbfc;
}
</style>
