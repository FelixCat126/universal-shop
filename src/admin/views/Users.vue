<template>
  <div class="users-management">
    <!-- 页面标题 -->
    <div class="page-header">
      <h2 class="page-title">{{ t('users.title') }}</h2>
      <p class="page-description">{{ t('users.description') }}</p>
    </div>

    <!-- 搜索和筛选 -->
    <div class="filter-section">
      <el-card>
        <el-form :model="searchForm" inline class="search-form">
          <el-form-item :label="t('users.email')">
            <el-input
              v-model="searchForm.email"
              :placeholder="t('users.enterEmail')"
              clearable
              style="width: 200px"
            />
          </el-form-item>
          
          <el-form-item :label="t('users.phone')">
            <el-input
              v-model="searchForm.phone"
              :placeholder="t('users.enterPhone')"
              clearable
              style="width: 200px"
            />
          </el-form-item>
          
          <el-form-item :label="t('users.referralCode')">
            <el-input
              v-model="searchForm.referral_code"
              :placeholder="t('users.enterReferralCode')"
              clearable
              style="width: 200px"
            />
          </el-form-item>
          
          <el-form-item>
            <el-button type="primary" @click="handleSearch" :loading="isLoading">
              <el-icon><Search /></el-icon>
              {{ t('users.search') }}
            </el-button>
            <el-button @click="resetSearch">
              <el-icon><Refresh /></el-icon>
              {{ t('users.reset') }}
            </el-button>
            <el-button type="success" @click="exportUsers" :loading="isExporting">
              <el-icon><Download /></el-icon>
              {{ t('users.exportUsers') }}
            </el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>

    <!-- 用户统计 -->
    <div class="stats-section">
      <el-row :gutter="20">
        <el-col :span="6">
          <el-card class="stats-card">
            <div class="stats-content">
              <div class="stats-value">{{ totalUsers }}</div>
              <div class="stats-label">{{ t('users.totalUsers') }}</div>
            </div>
            <el-icon class="stats-icon"><User /></el-icon>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stats-card">
            <div class="stats-content">
              <div class="stats-value">{{ todayRegistrations }}</div>
              <div class="stats-label">{{ t('users.newUsersToday') }}</div>
            </div>
            <el-icon class="stats-icon"><Plus /></el-icon>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stats-card">
            <div class="stats-content">
              <div class="stats-value">{{ weekRegistrations }}</div>
              <div class="stats-label">{{ t('users.newUsersThisWeek') }}</div>
            </div>
            <el-icon class="stats-icon"><TrendCharts /></el-icon>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stats-card">
            <div class="stats-content">
              <div class="stats-value">{{ monthRegistrations }}</div>
              <div class="stats-label">{{ t('users.newUsersThisMonth') }}</div>
            </div>
            <el-icon class="stats-icon"><Calendar /></el-icon>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- 用户列表 -->
    <div class="table-section">
      <el-card>
        <template #header>
          <div class="table-header">
            <span>{{ t('users.title') }}</span>
            <span class="table-info">{{ t('users.totalUsers') }} {{ totalUsers }}</span>
          </div>
        </template>

        <div class="table-wrapper">
          <el-table
          :data="userList"
          v-loading="isLoading"
          stripe
          border
          style="width: 100%; min-width: 1400px"
          :default-sort="{ prop: 'created_at', order: 'descending' }"
          table-layout="fixed"
          class="user-table"
        >
          <el-table-column prop="id" :label="t('users.id')" width="80" align="center" />
          
          <el-table-column :label="t('users.nickname')" width="180" min-width="150">
            <template #default="scope">
              <div class="user-nickname">
                {{ scope.row.nickname || t('common.notSet') }}
              </div>
            </template>
          </el-table-column>

          <el-table-column :label="t('users.phone')" width="200" min-width="180">
            <template #default="scope">
              <div class="user-phone">
                <div class="phone-display" v-if="scope.row.phone">
                  <CountryFlag :country-code="scope.row.country_code || '+86'" />
                  <span class="country-code">{{ scope.row.country_code || '+86' }}</span>
                  <span class="phone-number">{{ scope.row.phone }}</span>
                </div>
                <span v-else class="no-phone">{{ t('common.notSet') }}</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column :label="t('users.email')" width="220" min-width="200">
            <template #default="scope">
              <div class="user-email">
                {{ scope.row.email || t('common.notSet') }}
              </div>
            </template>
          </el-table-column>

          <el-table-column :label="t('users.referredBy')" width="160" min-width="140">
            <template #default="scope">
              <div class="referrer-info">
                <span v-if="scope.row.referred_by_code" class="referrer-code">
                  {{ scope.row.referred_by_code }}
                </span>
                <span v-else class="no-referrer">{{ t('common.none') }}</span>
              </div>
            </template>
          </el-table-column>

          <el-table-column :label="t('users.status')" width="120" align="center">
            <template #default="scope">
              <el-tag 
                :type="scope.row.is_active ? 'success' : 'danger'"
                size="small"
              >
                {{ scope.row.is_active ? t('users.active') : t('users.inactive') }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column :label="t('users.registrationTime')" width="200" align="center">
            <template #default="scope">
              <div class="registration-time">
                <div class="datetime">{{ formatDateTime(scope.row.created_at) }}</div>
              </div>
            </template>
          </el-table-column>

          <el-table-column :label="t('users.actions')" width="200" align="center" fixed="right">
            <template #default="scope">
              <div class="action-buttons">
                <el-button 
                  :type="scope.row.is_active ? 'warning' : 'success'"
                  size="small"
                  @click="toggleUserStatus(scope.row)"
                  :loading="scope.row.updating"
                >
                  {{ scope.row.is_active ? t('users.ban') : t('users.unban') }}
                </el-button>
                <el-button
                  type="primary"
                  size="small"
                  @click="viewUserDetail(scope.row)"
                >
                  {{ t('users.viewDetails') }}
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
        </div>

        <!-- 分页 -->
        <div class="pagination-wrapper">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :small="false"
            :disabled="isLoading"
            :background="true"
            layout="total, sizes, prev, pager, next, jumper"
            :total="totalUsers"
            @size-change="handleSizeChange"
            @current-change="handleCurrentChange"
          />
        </div>
      </el-card>
    </div>

    <!-- 用户详情对话框 -->
    <el-dialog
      v-model="showUserDialog"
      :title="t('users.userDetails')"
      width="600px"
      :before-close="closeUserDialog"
    >
      <div v-if="selectedUser" class="user-detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item :label="t('users.id')">{{ selectedUser.id }}</el-descriptions-item>
          <el-descriptions-item :label="t('users.email')">{{ selectedUser.email }}</el-descriptions-item>
          <el-descriptions-item :label="t('users.phone')">
            <div v-if="selectedUser.phone" class="phone-detail">
              <CountryFlag :country-code="selectedUser.country_code || '+86'" />
              <span class="country-code">{{ selectedUser.country_code || '+86' }}</span>
              <span class="phone-number">{{ selectedUser.phone }}</span>
            </div>
            <span v-else>{{ t('common.notSet') }}</span>
          </el-descriptions-item>
          <el-descriptions-item :label="t('users.referralCode')">
            <el-tag v-if="selectedUser.referral_code" type="success">{{ selectedUser.referral_code }}</el-tag>
            <span v-else class="text-gray">{{ t('common.notSet') }}</span>
          </el-descriptions-item>
          <el-descriptions-item :label="t('users.referredBy')">
            <el-tag v-if="selectedUser.referred_by_code" type="info">{{ selectedUser.referred_by_code }}</el-tag>
            <span v-else class="text-gray">{{ t('common.none') }}</span>
          </el-descriptions-item>
          <el-descriptions-item :label="t('users.registrationTime')" :span="2">
            {{ formatDateTime(selectedUser.created_at) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('common.updateTime')" :span="2">
            {{ formatDateTime(selectedUser.updated_at) }}
          </el-descriptions-item>
        </el-descriptions>
      </div>
      
      <template #footer>
        <el-button @click="closeUserDialog">{{ t('common.close') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Download, User, Plus, TrendCharts, Calendar } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { userAPI } from '../api/users.js'
import { useAdminStore } from '../stores/admin.js'
import CountryFlag from '../components/CountryFlag.vue'

const { t } = useI18n()

// 用户管理页面已加载

// 使用store
const adminStore = useAdminStore()

// 响应式数据
const isLoading = ref(false)
const isExporting = ref(false)
const userList = ref([])
const totalUsers = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)

// 搜索表单
const searchForm = reactive({
  email: '',
  phone: '',
  referral_code: ''
})

// 用户详情对话框
const showUserDialog = ref(false)
const selectedUser = ref(null)

// 统计数据计算
const todayRegistrations = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  
  return userList.value.filter(user => {
    const userDate = new Date(user.created_at)
    return userDate >= today && userDate < tomorrow
  }).length
})

const weekRegistrations = computed(() => {
  const now = new Date()
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - now.getDay()) // 本周开始（周日）
  startOfWeek.setHours(0, 0, 0, 0)
  
  return userList.value.filter(user => {
    const userDate = new Date(user.created_at)
    return userDate >= startOfWeek
  }).length
})

const monthRegistrations = computed(() => {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  
  return userList.value.filter(user => {
    const userDate = new Date(user.created_at)
    return userDate >= startOfMonth
  }).length
})

// 加载用户列表
const loadUsers = async () => {
  try {
    isLoading.value = true
    
    const params = {
      page: currentPage.value,
      pageSize: pageSize.value,
      email: searchForm.email || undefined,
      phone: searchForm.phone || undefined,
      referral_code: searchForm.referral_code || undefined
    }
    
    const response = await userAPI.getAllUsers(params)
    
    if (response.data.success) {
      userList.value = response.data.data.users
      totalUsers.value = response.data.data.pagination.total
      // 用户数据加载完成
    } else {
      ElMessage.error(t('users.messages.loadFailed') + ': ' + response.data.message)
    }
  } catch (error) {
    console.error('加载用户数据失败:', error)
    ElMessage.error(t('users.messages.loadFailed') + ': ' + (error.response?.data?.message || error.message))
  } finally {
    isLoading.value = false
  }
}

// 搜索用户
const handleSearch = () => {
  currentPage.value = 1
  loadUsers()
}

// 重置搜索
const resetSearch = () => {
  Object.assign(searchForm, {
    email: '',
    phone: '',
    referral_code: ''
  })
  currentPage.value = 1
  loadUsers()
}

// 导出用户
const exportUsers = async () => {
  try {
    isExporting.value = true
    ElMessage.info(t('users.messages.exporting'))
    
    // 调用导出API
    const response = await adminStore.apiRequest('/api/admin/export/users', {
      method: 'GET'
    })
    
    if (response.ok) {
      // 获取文件数据
      const blob = await response.blob()
      
      // 创建下载链接
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      
      // 从响应头获取文件名，如果没有则使用默认名称
      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `用户数据_${new Date().toISOString().split('T')[0]}.xlsx`
      
      if (contentDisposition) {
        const matches = contentDisposition.match(/filename\*=UTF-8''(.+)/)
        if (matches) {
          filename = decodeURIComponent(matches[1])
        }
      }
      
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      
      ElMessage.success(t('users.messages.exportSuccess'))
    } else {
      const errorData = await response.json()
      ElMessage.error(errorData.message || t('users.messages.exportFailed'))
    }
  } catch (error) {
    console.error('导出用户失败:', error)
    ElMessage.error(t('users.messages.exportFailed'))
  } finally {
    isExporting.value = false
  }
}

// 查看用户详情
const viewUserDetail = (user) => {
  selectedUser.value = user
  showUserDialog.value = true
}

// 关闭用户详情对话框
const closeUserDialog = () => {
  showUserDialog.value = false
  selectedUser.value = null
}

// 切换用户状态（启用/禁用）
const toggleUserStatus = async (user) => {
  const confirmMessage = user.is_active ? t('users.messages.confirmBan') : t('users.messages.confirmUnban')
  
  try {
    await ElMessageBox.confirm(
      confirmMessage,
      t('common.confirm'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    
    // 设置加载状态
    user.updating = true
    
    // 调用API更新用户状态
    const { useAdminStore } = await import('../stores/admin.js')
    const adminStore = useAdminStore()
    
    const response = await adminStore.apiRequest(`/api/admin/users/${user.id}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        is_active: !user.is_active
      })
    })
    
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        // 更新本地数据
        user.is_active = !user.is_active
        const successMessage = user.is_active ? t('users.messages.unbanSuccess') : t('users.messages.banSuccess')
        ElMessage.success(successMessage)
      } else {
        const failMessage = user.is_active ? t('users.messages.banFailed') : t('users.messages.unbanFailed')
        ElMessage.error(data.message || failMessage)
      }
    } else {
      const errorData = await response.json()
      const failMessage = user.is_active ? t('users.messages.banFailed') : t('users.messages.unbanFailed')
      ElMessage.error(errorData.message || failMessage)
    }
    
  } catch (error) {
    if (error !== 'cancel') {
      console.error('用户状态切换失败:', error)
      const failMessage = user.is_active ? t('users.messages.banFailed') : t('users.messages.unbanFailed')
      ElMessage.error(failMessage)
    }
  } finally {
    user.updating = false
  }
}

// 分页处理
const handleSizeChange = (size) => {
  pageSize.value = size
  currentPage.value = 1
  loadUsers()
}

const handleCurrentChange = (page) => {
  currentPage.value = page
  loadUsers()
}

// 格式化日期
const formatDate = (dateString) => {
  if (!dateString) return ''
  const date = new Date(dateString)
  return date.toLocaleDateString('zh-CN')
}

const formatTime = (dateString) => {
  if (!dateString) return ''
  const date = new Date(dateString)
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

const formatDateTime = (dateString) => {
  if (!dateString) return ''
  const date = new Date(dateString)
  
  // 获取今天日期，用于判断是否为今天
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()
  
  // 如果是今天，只显示时间
  if (isToday) {
    return `${t('common.today')} ${date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}`
  }
  
  // 检查是否为今年
  const isThisYear = date.getFullYear() === today.getFullYear()
  
  if (isThisYear) {
    // 如果是今年，显示月-日 时:分
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${month}-${day} ${hours}:${minutes}`
  } else {
    // 如果不是今年，显示年-月-日 时:分
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}`
  }
}

// 组件挂载时加载数据
onMounted(() => {
  loadUsers()
})
</script>

<style scoped>
.users-management {
  padding: 20px;
}

.page-header {
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: #303133;
}

.page-description {
  color: #606266;
  margin: 0;
  font-size: 14px;
}

.filter-section {
  margin-bottom: 20px;
}

.search-form {
  margin: 0;
}

.stats-section {
  margin-bottom: 20px;
}

.stats-card {
  position: relative;
  cursor: pointer;
  transition: all 0.3s;
}

.stats-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.stats-content {
  padding: 10px 0;
}

.stats-value {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
  line-height: 1;
}

.stats-label {
  font-size: 14px;
  color: #909399;
  margin-top: 8px;
}

.stats-icon {
  position: absolute;
  right: 20px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 32px;
  color: #409EFF;
  opacity: 0.3;
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
}

.table-info {
  color: #909399;
  font-size: 14px;
}

.user-table {
  font-size: 14px;
}

.user-table .el-table__cell {
  padding: 8px 12px;
}

.user-table .el-table__body td {
  vertical-align: top;
}

.user-info {
  line-height: 1.5;
}

.user-email {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 280px;
}

.user-nickname {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 2px;
  white-space: nowrap;
}

.user-phone {
  font-size: 12px;
  color: #909399;
  margin-bottom: 2px;
  white-space: nowrap;
}

.user-email {
  font-size: 14px;
  color: #303133;
  white-space: nowrap;
}

.referrer-info {
  font-size: 14px;
  color: #303133;
}

.referrer-code {
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 12px;
  font-weight: 600;
  background: #f0f9ff;
  color: #0369a1;
  padding: 2px 6px;
  border-radius: 4px;
}

.no-referrer {
  color: #909399;
  font-size: 12px;
}

.referral-code {
  font-size: 14px;
}

.code {
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 12px;
  font-weight: 600;
  background: #f0f9ff;
  color: #0369a1;
  padding: 2px 6px;
  border-radius: 4px;
}

.no-code {
  color: #909399;
  font-size: 12px;
}

.referral-info {
  line-height: 1.4;
}

.referral-code-row,
.referred-by-row {
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.code {
  font-family: 'Monaco', 'Consolas', monospace;
  font-size: 11px;
  font-weight: 600;
  background: #f5f7fa;
  padding: 2px 4px;
  border-radius: 3px;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.no-referral {
  font-size: 13px;
  white-space: nowrap;
}

.text-gray {
  color: #909399;
}

.registration-time {
  text-align: center;
  white-space: nowrap;
}

.datetime {
  font-weight: 500;
  color: #303133;
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 170px;
}

.pagination-wrapper {
  margin-top: 20px;
  text-align: right;
}

.user-detail {
  margin: 20px 0;
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

/* 手机号显示样式 */
.phone-display, .phone-detail {
  display: flex;
  align-items: center;
  gap: 4px;
}

.country-code {
  color: #909399;
  font-size: 12px;
  background: #f5f7fa;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
}

.phone-number {
  color: #303133;
  font-family: monospace;
}

.no-phone {
  color: #c0c4cc;
  font-style: italic;
}

/* 用户详情页手机号样式 */
.phone-detail {
  gap: 6px;
}

.phone-detail .country-code {
  font-size: 13px;
  padding: 2px 6px;
}

.phone-detail .phone-number {
  font-size: 14px;
  font-weight: 500;
}
</style>