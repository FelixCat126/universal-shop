<template>
  <div class="operation-logs">
    <!-- 页面标题和操作区 -->
    <el-card class="header-card" shadow="never">
      <div class="header-section">
        <h1 class="page-title">
          <el-icon><Document /></el-icon>
          {{ t('operationLogs.title') }}
        </h1>
        <div class="actions">
          <el-button @click="loadLogs" :loading="loading" icon="Refresh">{{ t('operationLogs.refresh') }}</el-button>
          <el-button @click="resetFilters">{{ t('common.reset') }}</el-button>
        </div>
      </div>
    </el-card>

    <!-- 筛选区域 -->
    <el-card class="filter-card" shadow="never">
      <el-form :model="filters" class="filter-form">
        <el-row :gutter="20">
          <el-col :span="6">
            <el-form-item :label="t('operationLogs.administrator')">
              <el-select 
                v-model="filters.admin_id" 
                :placeholder="t('operationLogs.allAdmins')" 
                clearable 
                @change="handleFilterChange"
                style="width: 100%"
              >
                <el-option
                  v-for="admin in administrators"
                  :key="admin.id"
                  :label="`${admin.username} (${admin.real_name || admin.username})`"
                  :value="admin.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
          
          <el-col :span="6">
            <el-form-item :label="t('operationLogs.operationType')">
              <el-select 
                v-model="filters.action" 
                :placeholder="t('operationLogs.allOperations')" 
                clearable 
                @change="handleFilterChange"
                style="width: 100%"
              >
                <el-option :label="t('operationLogs.actions.login')" value="login" />
                <el-option :label="t('operationLogs.actions.create')" value="create" />
                <el-option :label="t('operationLogs.actions.update')" value="update" />
                <el-option :label="t('operationLogs.actions.delete')" value="delete" />
              </el-select>
            </el-form-item>
          </el-col>
          
          <el-col :span="6">
            <el-form-item :label="t('operationLogs.resourceType')">
              <el-select 
                v-model="filters.resource" 
                :placeholder="t('operationLogs.allResources')" 
                clearable 
                @change="handleFilterChange"
                style="width: 100%"
              >
                <el-option :label="t('operationLogs.resources.administrator')" value="administrator" />
                <el-option :label="t('operationLogs.resources.order')" value="order" />
                <el-option :label="t('operationLogs.resources.user')" value="user" />
                <el-option :label="t('operationLogs.resources.product')" value="product" />
                <el-option :label="t('operationLogs.resources.system_config')" value="system_config" />
              </el-select>
            </el-form-item>
          </el-col>
          
          <el-col :span="6">
            <el-form-item :label="t('operationLogs.dateRange')">
              <el-date-picker
                v-model="dateRange"
                type="daterange"
                range-separator="~"
                :start-placeholder="t('common.startDate')"
                :end-placeholder="t('common.endDate')"
                value-format="YYYY-MM-DD"
                @change="handleDateRangeChange"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </el-card>

    <!-- 日志表格 -->
    <el-card class="table-card" shadow="never">
      <el-table 
        :data="logs" 
        v-loading="loading"
        stripe
        border
        style="width: 100%"
        :default-sort="{ prop: 'created_at', order: 'descending' }"
      >
        <el-table-column prop="admin_username" :label="t('operationLogs.admin')" width="120" />
        
        <el-table-column prop="action" :label="t('operationLogs.operation')" width="120">
          <template #default="scope">
            <el-tag :type="getActionTagType(scope.row.action)" size="small">
              {{ getActionText(scope.row.action) }}
            </el-tag>
          </template>
        </el-table-column>
        
        <el-table-column prop="resource" :label="t('operationLogs.resource')" width="100">
          <template #default="scope">
            {{ getResourceText(scope.row.resource) }}
          </template>
        </el-table-column>
        
        <el-table-column prop="resource_id" :label="t('operationLogs.id')" width="80">
          <template #default="scope">
            <span v-if="scope.row.resource_id" class="resource-id">
              #{{ scope.row.resource_id }}
            </span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        
        <el-table-column prop="description" :label="t('operationLogs.details')" min-width="200" show-overflow-tooltip />
        
        <el-table-column prop="ip_address" :label="t('operationLogs.ipAddress')" width="120">
          <template #default="scope">
            {{ scope.row.ip_address || '-' }}
          </template>
        </el-table-column>
        
        <el-table-column prop="created_at" :label="t('operationLogs.time')" width="180">
          <template #default="scope">
            {{ formatDateTime(scope.row.created_at) }}
          </template>
        </el-table-column>
        
        <el-table-column :label="t('common.actions')" width="120" fixed="right">
          <template #default="scope">
            <el-button 
              v-if="scope.row.old_data || scope.row.new_data"
              @click="showLogDetail(scope.row)" 
              type="primary" 
              size="small"
              link
            >
              {{ t('operationLogs.viewDetails') }}
            </el-button>
            <span v-else>-</span>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.limit"
          :page-sizes="[10, 20, 50, 100]"
          :total="pagination.total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
        />
      </div>
    </el-card>

    <!-- 详情对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="`${t('operationLogs.details')} - ${currentLog?.admin_username}`"
      width="60%"
      :close-on-click-modal="false"
    >
      <div v-if="currentLog" class="log-detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item :label="t('operationLogs.admin')">{{ currentLog.admin_username }}</el-descriptions-item>
          <el-descriptions-item :label="t('operationLogs.operation')">
            <el-tag :type="getActionTagType(currentLog.action)" size="small">
              {{ getActionText(currentLog.action) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item :label="t('operationLogs.resource')">{{ getResourceText(currentLog.resource) }}</el-descriptions-item>
          <el-descriptions-item :label="t('operationLogs.id')">{{ currentLog.resource_id || '-' }}</el-descriptions-item>
          <el-descriptions-item :label="t('operationLogs.ipAddress')">{{ currentLog.ip_address || '-' }}</el-descriptions-item>
          <el-descriptions-item :label="t('operationLogs.time')">{{ formatDateTime(currentLog.created_at) }}</el-descriptions-item>
          <el-descriptions-item :label="t('operationLogs.details')" :span="2">{{ currentLog.description }}</el-descriptions-item>
          <el-descriptions-item :label="t('operationLogs.userAgent')" :span="2">
            <div class="user-agent">{{ currentLog.user_agent || '-' }}</div>
          </el-descriptions-item>
        </el-descriptions>

        <!-- 数据变更详情 -->
        <div v-if="currentLog.old_data || currentLog.new_data" class="data-changes">
          <h4>数据变更详情</h4>
          <el-row :gutter="20">
            <el-col v-if="currentLog.old_data" :span="12">
              <h5>变更前：</h5>
              <el-input
                type="textarea"
                :rows="15"
                :value="JSON.stringify(currentLog.old_data, null, 2)"
                readonly
                class="data-textarea"
              />
            </el-col>
            <el-col v-if="currentLog.new_data" :span="currentLog.old_data ? 12 : 24">
              <h5>变更后：</h5>
              <el-input
                type="textarea"
                :rows="15"
                :value="JSON.stringify(currentLog.new_data, null, 2)"
                readonly
                class="data-textarea"
              />
            </el-col>
          </el-row>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Document } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { useAdminStore } from '../stores/admin.js'

const { t } = useI18n()

const adminStore = useAdminStore()

// 响应式数据
const loading = ref(false)
const logs = ref([])
const administrators = ref([])
const dialogVisible = ref(false)
const currentLog = ref(null)
const dateRange = ref([])

// 筛选条件
const filters = reactive({
  admin_id: '',
  action: '',
  resource: '',
  start_date: '',
  end_date: ''
})

// 分页信息
const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0
})

// 获取操作日志
const loadLogs = async () => {
  try {
    loading.value = true
    
    const params = new URLSearchParams({
      page: pagination.page,
      limit: pagination.limit,
      ...Object.fromEntries(Object.entries(filters).filter(([_, v]) => v))
    })
    
    const response = await adminStore.apiRequest(`/api/admin/operation-logs?${params}`)
    const data = await response.json()
    
    if (data.success) {
      logs.value = data.data.logs
      pagination.total = data.data.total
      pagination.totalPages = data.data.totalPages
    } else {
      ElMessage.error(t('operationLogs.messages.loadFailed') + ': ' + data.message)
    }
  } catch (error) {
    console.error('获取操作日志失败:', error)
    ElMessage.error(t('operationLogs.messages.loadFailed') + ': ' + error.message)
  } finally {
    loading.value = false
  }
}

// 获取管理员列表
const loadAdministrators = async () => {
  try {
    const response = await adminStore.apiRequest('/api/admin/administrators?limit=100')
    const data = await response.json()
    
    if (data.success) {
      administrators.value = data.data.administrators
    }
  } catch (error) {
    console.error('获取管理员列表失败:', error)
  }
}

// 显示日志详情
const showLogDetail = (log) => {
  currentLog.value = log
  dialogVisible.value = true
}

// 处理筛选条件变更
const handleFilterChange = () => {
  pagination.page = 1
  loadLogs()
}

// 处理日期范围变更
const handleDateRangeChange = (dates) => {
  if (dates && dates.length === 2) {
    filters.start_date = dates[0]
    filters.end_date = dates[1]
  } else {
    filters.start_date = ''
    filters.end_date = ''
  }
  handleFilterChange()
}

// 重置筛选条件
const resetFilters = () => {
  Object.assign(filters, {
    admin_id: '',
    action: '',
    resource: '',
    start_date: '',
    end_date: ''
  })
  dateRange.value = []
  pagination.page = 1
  loadLogs()
}

// 分页大小变更
const handleSizeChange = (size) => {
  pagination.limit = size
  pagination.page = 1
  loadLogs()
}

// 当前页变更
const handleCurrentChange = (page) => {
  pagination.page = page
  loadLogs()
}

// 获取操作类型标签类型
const getActionTagType = (action) => {
  const typeMap = {
    'login': 'info',
    'create': 'success',
    'update': 'warning',
    'delete': 'danger',
    'reset': 'warning'
  }
  const baseAction = action.split('_')[0]
  return typeMap[baseAction] || 'info'
}

// 获取操作类型文本
const getActionText = (action) => {
  return t(`operationLogs.actions.${action}`) || action
}

// 获取资源类型文本
const getResourceText = (resource) => {
  return t(`operationLogs.resources.${resource}`) || resource
}

// 格式化日期时间
const formatDateTime = (dateString) => {
  if (!dateString) return '-'
  const date = new Date(dateString)
  return date.toLocaleString()
}

// 页面加载
onMounted(() => {
  Promise.all([
    loadLogs(),
    loadAdministrators()
  ])
})
</script>

<style scoped>
.operation-logs {
  padding: 20px;
}

.header-card,
.filter-card,
.table-card {
  margin-bottom: 20px;
}

.header-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.page-title {
  font-size: 24px;
  font-weight: bold;
  color: #333;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

.resource-id {
  font-family: monospace;
  color: #666;
}

.log-detail {
  max-height: 70vh;
  overflow-y: auto;
}

.data-changes {
  margin-top: 20px;
}

.data-changes h4 {
  margin: 0 0 15px 0;
  color: #333;
  font-size: 16px;
}

.data-changes h5 {
  margin: 0 0 8px 0;
  color: #666;
  font-size: 14px;
}

.data-textarea {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
}

.user-agent {
  max-width: 100%;
  word-break: break-all;
  color: #666;
  font-size: 12px;
  line-height: 1.4;
}

/* 筛选表单样式 */
.filter-form .el-form-item {
  margin-bottom: 16px;
}

.filter-form .el-form-item__label {
  font-weight: 500;
}

.filter-card {
  margin-bottom: 16px;
}

/* 响应式布局 */
@media (max-width: 768px) {
  .operation-logs {
    padding: 10px;
  }
  
  .page-title {
    font-size: 20px;
  }
  
  .header-section {
    flex-direction: column;
    gap: 10px;
  }
}
</style>
