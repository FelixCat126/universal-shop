import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import config from '../../config/index.js'

export const useAdminStore = defineStore('admin', () => {
  // 状态
  const token = ref(localStorage.getItem('admin_token') || '')
  const adminInfo = ref(null)

  // 初始化管理员信息
  const initAdminInfo = () => {
    const storedInfo = localStorage.getItem('admin_info')
    if (storedInfo) {
      try {
        adminInfo.value = JSON.parse(storedInfo)
      } catch (error) {
        console.error('解析管理员信息失败:', error)
        localStorage.removeItem('admin_info')
      }
    }
  }

  // 初始化
  initAdminInfo()

  // 计算属性
  const isLoggedIn = computed(() => !!token.value && !!adminInfo.value)
  const isSuperAdmin = computed(() => adminInfo.value?.role === 'super_admin')
  const isAdmin = computed(() => adminInfo.value?.role === 'admin')
  const isOperator = computed(() => adminInfo.value?.role === 'operator')

  // 权限检查
  const hasPermission = (resource) => {
    if (!adminInfo.value) return false
    const rolePermissions = {
      super_admin: ['*'],
      admin: ['orders', 'users', 'products', 'administrators'],
      operator: ['orders', 'users', 'products']
    }
    const permissions = rolePermissions[adminInfo.value.role] || []
    return permissions.includes('*') || permissions.includes(resource)
  }

  // 登录
  const login = async (credentials) => {
    try {
      const response = await fetch(config.buildApiUrl('/api/admin/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(credentials)
      })

      const data = await response.json()

      if (data.success) {
        token.value = data.data.token
        adminInfo.value = data.data.admin
        
        // 保存到localStorage
        localStorage.setItem('admin_token', data.data.token)
        localStorage.setItem('admin_info', JSON.stringify(data.data.admin))
        
        return { success: true, message: data.message }
      } else {
        return { success: false, message: data.message }
      }
    } catch (error) {
      console.error('登录失败:', error)
      return { success: false, message: '网络错误，请稍后重试' }
    }
  }

  // 登出
  const logout = () => {
    token.value = ''
    adminInfo.value = null
    
    // 清除localStorage
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_info')
  }

  // 更新管理员信息
  const updateAdminInfo = (newInfo) => {
    adminInfo.value = { ...adminInfo.value, ...newInfo }
    localStorage.setItem('admin_info', JSON.stringify(adminInfo.value))
  }

  // API请求封装（自动添加认证头）
  const apiRequest = async (url, options = {}) => {
    // 构建完整的API URL - 使用配置管理器，保持向后兼容
    const fullUrl = config.buildApiUrl(url)
    
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    }

    if (token.value) {
      headers['Authorization'] = `Bearer ${token.value}`
    }

    try {
      const response = await fetch(fullUrl, {
        ...options,
        headers
      })

      // 如果token过期，自动登出并跳转到登录页
      if (response.status === 401) {
        logout()
        // 在store中不能使用useRouter()，直接使用window.location跳转
        if (typeof window !== 'undefined') {
          window.location.href = '/admin/login'
        }
        throw new Error('登录已过期，请重新登录')
      }

      return response
    } catch (error) {
      throw error
    }
  }

  // 验证token有效性
  const validateToken = async () => {
    if (!token.value || !adminInfo.value) {
      return false
    }

    try {
      const response = await fetch(config.buildApiUrl('/api/admin/validate-token'), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token.value}`,
          'Content-Type': 'application/json'
        }
      })

      if (response.status === 401) {
        logout()
        return false
      }

      const data = await response.json()
      return data.success
    } catch (error) {
      console.error('Token验证失败:', error)
      logout()
      return false
    }
  }

  return {
    // 状态
    token,
    adminInfo,
    
    // 计算属性
    isLoggedIn,
    isSuperAdmin,
    isAdmin,
    isOperator,
    hasPermission,
    
    // 方法
    login,
    logout,
    updateAdminInfo,
    apiRequest,
    validateToken
  }
})
