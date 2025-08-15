<template>
  <div class="operators-management">
    <!-- 页面标题 -->
    <el-card class="header-card" shadow="never">
      <div class="page-header">
        <h1 class="page-title">
          <el-icon><User /></el-icon>
          {{ t('operators.title') }}
        </h1>
        <p class="page-description">{{ t('operators.description') }}</p>
        <div class="actions">
          <el-button @click="loadAdmins" :loading="loading" icon="Refresh">{{ t('operators.refresh') }}</el-button>
          <el-button type="primary" @click="showCreateDialog" icon="Plus">{{ t('operators.addOperator') }}</el-button>
        </div>
      </div>
    </el-card>

    <!-- 管理员列表 -->
    <el-card shadow="never">
      <el-table 
        :data="administrators" 
        v-loading="loading"
        stripe
        style="width: 100%"
      >
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="username" :label="t('operators.username')" min-width="120" />
        <el-table-column :label="t('operators.role')" width="120">
          <template #default="{ row }">
            <el-tag :type="getRoleTagType(row.role)">
              {{ roleText(row.role) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="real_name" :label="t('operators.realName')" min-width="100">
          <template #default="{ row }">
            {{ row.real_name || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="email" :label="t('operators.email')" min-width="180">
          <template #default="{ row }">
            {{ row.email || '-' }}
          </template>
        </el-table-column>
        <el-table-column :label="t('operators.status')" width="100">
          <template #default="{ row }">
            <el-tag :type="row.is_active ? 'success' : 'danger'">
              {{ row.is_active ? t('operators.enabled') : t('operators.disabled') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('operators.lastLogin')" width="160">
          <template #default="{ row }">
            {{ formatDate(row.last_login_at) }}
          </template>
        </el-table-column>
        <el-table-column :label="t('operators.actions')" width="280" fixed="right">
          <template #default="{ row }">
            <el-button 
              size="small" 
              :type="row.is_active ? 'warning' : 'success'"
              :disabled="isProtectedAdmin(row)"
              @click="toggleActive(row)"
            >
              {{ row.is_active ? t('operators.disabled') : t('operators.enabled') }}
            </el-button>
            <el-button size="small" type="primary" @click="showResetPassword(row)">
              {{ t('operators.resetPassword') }}
            </el-button>
            <el-button 
              size="small" 
              type="danger" 
              :disabled="isProtectedAdmin(row)"
              @click="confirmDelete(row)"
            >
              {{ t('operators.delete') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新增操作员对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="500px"
      @close="resetForm"
    >
      <el-form :model="form" :rules="rules" ref="formRef" label-width="80px">
        <el-form-item :label="t('operators.username')" prop="username">
          <el-input v-model="form.username" :placeholder="t('operators.enterUsername')" />
        </el-form-item>
        <el-form-item :label="t('operators.password')" prop="password">
          <el-input v-model="form.password" type="password" :placeholder="t('operators.passwordLength')" show-password />
        </el-form-item>
        <el-form-item :label="t('operators.realName')" prop="real_name">
          <el-input v-model="form.real_name" :placeholder="t('operators.enterRealName')" />
        </el-form-item>
        <el-form-item :label="t('operators.email')" prop="email">
          <el-input v-model="form.email" :placeholder="t('operators.enterEmail')" />
        </el-form-item>
        <el-form-item :label="t('operators.role')" prop="role">
          <el-select v-model="form.role" :placeholder="t('operators.selectRole')" style="width: 100%">
            <el-option :label="t('role.operator')" value="operator" />
            <el-option :label="t('role.admin')" value="admin" />
          </el-select>
        </el-form-item>
      </el-form>
      
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" @click="handleSubmit" :loading="submitting">
            {{ t('common.save') }}
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 重置密码对话框 -->
    <el-dialog
      v-model="passwordDialogVisible"
      :title="t('operators.resetPassword')"
      width="400px"
    >
      <el-form :model="passwordForm" :rules="passwordRules" ref="passwordFormRef" label-width="80px">
        <el-form-item :label="t('operators.password')" prop="password">
          <el-input v-model="passwordForm.password" type="password" :placeholder="t('operators.passwordLength')" show-password />
        </el-form-item>
        <el-form-item :label="t('operators.confirmPassword')" prop="confirmPassword">
          <el-input v-model="passwordForm.confirmPassword" type="password" :placeholder="t('operators.enterConfirmPassword')" show-password />
        </el-form-item>
      </el-form>
      
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="passwordDialogVisible = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" @click="handleResetPassword" :loading="submitting">
            {{ t('common.confirm') }}
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
import { User, Plus, Refresh } from '@element-plus/icons-vue'
import { useAdminStore } from '../stores/admin.js'

const adminStore = useAdminStore()

// 数据
const administrators = ref([])
const loading = ref(false)
const submitting = ref(false)

// 对话框状态
const dialogVisible = ref(false)
const passwordDialogVisible = ref(false)
const dialogTitle = ref(t('operators.createOperator'))

// 表单数据
const form = ref({
  username: '',
  password: '',
  real_name: '',
  email: '',
  role: 'operator'
})

const passwordForm = ref({
  password: '',
  confirmPassword: ''
})

const currentEditAdmin = ref(null)

// 表单引用
const formRef = ref()
const passwordFormRef = ref()

// 表单验证规则
const rules = {
  username: [
    { required: true, message: () => t('operators.enterUsername'), trigger: 'blur' },
    { min: 3, max: 20, message: () => t('operators.usernameLength'), trigger: 'blur' }
  ],
  password: [
    { required: true, message: () => t('operators.enterPassword'), trigger: 'blur' },
    { min: 6, message: () => t('operators.passwordLength'), trigger: 'blur' }
  ],
  role: [
    { required: true, message: () => t('operators.selectRole'), trigger: 'change' }
  ]
}

const passwordRules = {
  password: [
    { required: true, message: () => t('operators.enterPassword'), trigger: 'blur' },
    { min: 6, message: () => t('operators.passwordLength'), trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: () => t('operators.enterConfirmPassword'), trigger: 'blur' },
    {
      validator: (rule, value, callback) => {
        if (value !== passwordForm.value.password) {
          callback(new Error(t('operators.passwordMismatch')))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}

// 方法
const roleText = (role) => {
  const roleMap = {
    super_admin: t('role.superAdmin'),
    admin: t('role.admin'),
    operator: t('role.operator')
  }
  return roleMap[role] || role
}

const getRoleTagType = (role) => {
  const typeMap = {
    super_admin: 'danger',
    admin: 'warning',
    operator: 'info'
  }
  return typeMap[role] || 'info'
}

const formatDate = (dateString) => {
  if (!dateString) return t('operators.never')
  return new Date(dateString).toLocaleString()
}

const isProtectedAdmin = (admin) => {
  // 超级管理员不能被禁用或删除
  if (admin.role === 'super_admin') return true
  // 不能操作自己
  if (admin.id === adminStore.adminInfo?.id) return true
  return false
}

const loadAdmins = async () => {
  try {
    loading.value = true
    const res = await adminStore.apiRequest('/api/admin/administrators?limit=200')
    const data = await res.json()
    if (data.success) {
      administrators.value = data.data.administrators
    } else {
      ElMessage.error(data.message || t('operators.messages.loadFailed'))
    }
  } catch (error) {
    console.error('加载管理员列表失败:', error)
    ElMessage.error(t('operators.messages.loadFailed'))
  } finally {
    loading.value = false
  }
}

const showCreateDialog = () => {
  dialogTitle.value = t('operators.createOperator')
  dialogVisible.value = true
}

const resetForm = () => {
  form.value = {
    username: '',
    password: '',
    real_name: '',
    email: '',
    role: 'operator'
  }
  formRef.value?.resetFields()
}

const handleSubmit = async () => {
  try {
    await formRef.value.validate()
    submitting.value = true
    
    const res = await adminStore.apiRequest('/api/admin/administrators', {
      method: 'POST',
      body: JSON.stringify(form.value)
    })
    const data = await res.json()
    
    if (data.success) {
      ElMessage.success(t('operators.messages.createSuccess'))
      dialogVisible.value = false
      resetForm()
      await loadAdmins()
    } else {
      ElMessage.error(data.message || t('operators.messages.createFailed'))
    }
  } catch (error) {
    console.error('创建管理员失败:', error)
    ElMessage.error(t('operators.messages.createFailed'))
  } finally {
    submitting.value = false
  }
}

const toggleActive = async (admin) => {
  try {
    await ElMessageBox.confirm(
      t('operators.messages.confirmToggleStatus'),
      t('common.confirm'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    
    const res = await adminStore.apiRequest(`/api/admin/administrators/${admin.id}`, {
      method: 'PUT',
      body: JSON.stringify({ is_active: !admin.is_active })
    })
    const data = await res.json()
    
    if (data.success) {
      ElMessage.success(t('operators.messages.toggleSuccess'))
      await loadAdmins()
    } else {
      ElMessage.error(data.message || t('operators.messages.toggleFailed'))
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('切换状态失败:', error)
      ElMessage.error(t('operators.messages.operationFailed'))
    }
  }
}

const showResetPassword = (admin) => {
  currentEditAdmin.value = admin
  passwordForm.value = {
    password: '',
    confirmPassword: ''
  }
  passwordDialogVisible.value = true
}

const handleResetPassword = async () => {
  try {
    await passwordFormRef.value.validate()
    submitting.value = true
    
    const res = await adminStore.apiRequest(`/api/admin/administrators/${currentEditAdmin.value.id}/reset-password`, {
      method: 'PUT',
      body: JSON.stringify({ password: passwordForm.value.password })
    })
    const data = await res.json()
    
    if (data.success) {
      ElMessage.success(t('operators.messages.resetPasswordSuccess'))
      passwordDialogVisible.value = false
    } else {
      ElMessage.error(data.message || t('operators.messages.resetPasswordFailed'))
    }
  } catch (error) {
    console.error('重置密码失败:', error)
    ElMessage.error(t('operators.messages.resetPasswordFailed'))
  } finally {
    submitting.value = false
  }
}

const confirmDelete = async (admin) => {
  try {
    await ElMessageBox.confirm(
      t('operators.messages.confirmDelete'),
      t('common.confirm'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'error'
      }
    )
    
    const res = await adminStore.apiRequest(`/api/admin/administrators/${admin.id}`, {
      method: 'DELETE'
    })
    const data = await res.json()
    
    if (data.success) {
      ElMessage.success(t('operators.messages.deleteSuccess'))
      await loadAdmins()
    } else {
      ElMessage.error(data.message || t('operators.messages.deleteFailed'))
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除管理员失败:', error)
      ElMessage.error(t('operators.messages.deleteFailed'))
    }
  }
}

onMounted(() => {
  loadAdmins()
})
</script>

<style scoped>
.operators-management {
  padding: 20px;
}

.header-card {
  margin-bottom: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 16px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.page-description {
  color: #606266;
  margin: 8px 0 0 0;
  font-size: 14px;
}

.actions {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

.dialog-footer {
  text-align: right;
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }
  
  .actions {
    justify-content: flex-start;
  }
}
</style>