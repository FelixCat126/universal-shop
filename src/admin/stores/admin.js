import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import config from '../../config/index.js'

export const useAdminStore = defineStore('admin', () => {
  // 状态
  const token = ref(localStorage.getItem('admin_token') || '')
  const adminInfo = ref(null)
  /** 是否必须先改密（后台账号仍在用默认口令时为 true） */
  const mustResetPassword = ref(false)

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
  /**
   * 管理员级（admin **或** super_admin）—— 第 47 轮新增。
   *
   * 对应后端的两个守卫（adminRoutes.js）：
   *   requireAdminOnly  —— 资损级写操作（售后审核）
   *   requireUserAdmin  —— 账号级高危操作（重置客户密码、注销用户）
   * 两者都是 `role === 'super_admin' || role === 'admin'`。
   *
   * 为什么需要它：界面原来**不拦**这些操作 → 操作员点了只得到一句
   * "权限不足"，看起来像系统坏了。界面的门槛必须和后端一致。
   */
  const isAdminOrAbove = computed(() =>
    ['admin', 'super_admin'].includes(adminInfo.value?.role))
  const isOperator = computed(() => adminInfo.value?.role === 'operator')

  // 权限检查
  const hasPermission = (resource) => {
    if (!adminInfo.value) return false
    const rolePermissions = {
      super_admin: ['*'],
      admin: ['orders', 'users', 'products', 'administrators', 'partners', 'reconciliation'],
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

        // 强制改密标志（后台账号默认口令下线时置位）
        mustResetPassword.value = data.data.must_reset_password === true

        // 保存到localStorage
        localStorage.setItem('admin_token', data.data.token)
        localStorage.setItem('admin_info', JSON.stringify(data.data.admin))

        return { success: true, message: data.message, mustResetPassword: mustResetPassword.value }
      } else {
        // 透传 HTTP 状态码与业务 code（如 428 CAPTCHA_REQUIRED / CAPTCHA_INVALID），供登录页做验证码分流
        return { success: false, message: data.message, status: response.status, code: data.code }
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
    mustResetPassword.value = false
    
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

    const response = await fetch(fullUrl, {
      ...options,
      headers
    })

    // 如果token过期，自动登出并跳转到登录页
    if (response.status === 401) {
      logout()
      // 在store中不能使用useRouter()，直接使用window.location跳转
      if (typeof window !== 'undefined') {
        window.location.href = `${import.meta.env.BASE_URL || '/'}login`
      }
      throw new Error('登录已过期，请重新登录')
    }

    return response
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
    mustResetPassword,
    
    // 计算属性
    isLoggedIn,
    isSuperAdmin,
    isAdmin,
    isAdminOrAbove,
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
