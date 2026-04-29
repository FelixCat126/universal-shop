<template>
  <div class="product-categories-admin">
    <div class="filter-section">
      <el-card>
        <el-form :model="searchForm" inline class="search-form">
          <el-form-item :label="t('categories.keyword')">
            <el-input
              v-model="searchForm.keyword"
              :placeholder="t('categories.keywordPlaceholder')"
              clearable
              style="width: 220px"
              @keyup.enter="handleSearch"
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
          </el-form-item>
        </el-form>
      </el-card>
    </div>

    <div class="admin-module-toolbar">
      <el-button type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>
        {{ t('categories.add') }}
      </el-button>
    </div>

    <div class="table-section">
      <el-card>
        <template #header>
          <div class="table-header">
            <span>{{ t('categories.title') }}</span>
            <span class="table-info">{{ t('categories.total') }} {{ total }}</span>
          </div>
        </template>
        <div class="table-wrapper">
          <el-table
            :data="list"
            v-loading="loading"
            border
            stripe
            style="width: 100%; min-width: 640px"
            table-layout="fixed"
          >
            <el-table-column prop="id" label="ID" width="80" />
            <el-table-column prop="name" :label="t('categories.name')" min-width="200" />
            <el-table-column prop="sort_order" :label="t('categories.sortOrder')" width="120" />
            <el-table-column :label="t('common.actions')" width="200" fixed="right">
              <template #default="{ row }">
                <el-button size="small" type="primary" @click="openEdit(row)">{{ t('common.edit') }}</el-button>
                <el-button size="small" type="danger" @click="removeRow(row)">{{ t('common.delete') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="pagination-wrap" v-if="totalPages > 1">
          <el-pagination
            layout="total, prev, pager, next"
            :total="total"
            :page-size="pageSize"
            :current-page="page"
            @current-change="handlePage"
          />
        </div>
      </el-card>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? t('categories.edit') : t('categories.add')"
      width="480px"
      destroy-on-close
      @closed="resetForm"
    >
      <el-form :model="form" :rules="rules" ref="formRef" label-width="100px">
        <el-form-item :label="t('categories.name')" prop="name">
          <el-input v-model="form.name" :placeholder="t('categories.namePlaceholder')" maxlength="100" show-word-limit />
        </el-form-item>
        <el-form-item :label="t('categories.sortOrder')" prop="sort_order">
          <el-input-number v-model="form.sort_order" :min="0" :max="99999" step="1" controls-position="right" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="save">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Plus } from '@element-plus/icons-vue'
import { categoryAdminAPI } from '../api/categories.js'

const { t } = useI18n()

const loading = ref(false)
const saving = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const totalPages = ref(0)

const searchForm = reactive({ keyword: '' })

const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref(null)
const form = reactive({
  id: null,
  name: '',
  sort_order: 0
})

const rules = {
  name: [{ required: true, message: t('categories.nameRequired'), trigger: 'blur' }]
}

const loadData = async () => {
  loading.value = true
  try {
    const res = await categoryAdminAPI.list({
      keyword: searchForm.keyword || undefined,
      page: page.value,
      pageSize: pageSize.value
    })
    if (res.data.success) {
      const d = res.data.data
      list.value = d.list || []
      total.value = d.total || 0
      totalPages.value = d.totalPages || 0
    }
  } catch (e) {
    ElMessage.error(e.response?.data?.message || e.message)
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  page.value = 1
  loadData()
}

const resetSearch = () => {
  searchForm.keyword = ''
  handleSearch()
}

const handlePage = (p) => {
  page.value = p
  loadData()
}

const openCreate = () => {
  isEdit.value = false
  resetForm()
  dialogVisible.value = true
}

const openEdit = (row) => {
  isEdit.value = true
  form.id = row.id
  form.name = row.name
  form.sort_order = row.sort_order ?? 0
  dialogVisible.value = true
}

const resetForm = () => {
  form.id = null
  form.name = ''
  form.sort_order = 0
}

const save = async () => {
  if (!formRef.value) return
  await formRef.value.validate()
  saving.value = true
  try {
    if (isEdit.value) {
      await categoryAdminAPI.update(form.id, {
        name: form.name.trim(),
        sort_order: form.sort_order
      })
      ElMessage.success(t('categories.updateSuccess'))
    } else {
      await categoryAdminAPI.create({
        name: form.name.trim(),
        sort_order: form.sort_order
      })
      ElMessage.success(t('categories.createSuccess'))
    }
    dialogVisible.value = false
    await loadData()
  } catch (e) {
    if (e !== false) {
      ElMessage.error(e.response?.data?.message || e.message)
    }
  } finally {
    saving.value = false
  }
}

const removeRow = async (row) => {
  try {
    await ElMessageBox.confirm(t('categories.confirmDelete'), t('common.confirm'), {
      type: 'warning'
    })
    const res = await categoryAdminAPI.remove(row.id)
    if (res.data.success) {
      ElMessage.success(t('categories.deleteSuccess'))
      await loadData()
    }
  } catch (e) {
    if (e !== 'cancel') {
      ElMessage.error(e.response?.data?.message || e.message)
    }
  }
}

onMounted(loadData)
</script>

<style scoped>
.filter-section {
  margin-bottom: 16px;
}

.search-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.admin-module-toolbar {
  margin-bottom: 16px;
}

.table-section {
  margin-bottom: 24px;
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.table-info {
  font-size: 14px;
  color: #909399;
}

.table-wrapper {
  overflow-x: auto;
}

.pagination-wrap {
  padding: 16px 0;
  display: flex;
  justify-content: flex-end;
}
</style>
