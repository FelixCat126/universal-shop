import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api/index.js'

export const useUserStore = defineStore('user', () => {
  // 状态
  const user = ref(null)
  const token = ref(localStorage.getItem('token') || null)
  const isLoading = ref(false)

  // 计算属性
  const isAuthenticated = computed(() => !!token.value && !!user.value)
  const isLoggedIn = computed(() => !!token.value && !!user.value)
  const userInfo = computed(() => user.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  // 设置认证信息
  const setAuth = (userData, authToken) => {
    user.value = userData
    token.value = authToken
    localStorage.setItem('token', authToken)
    localStorage.setItem('user', JSON.stringify(userData))
  }

  // 清除认证信息
  const clearAuth = () => {
    user.value = null
    token.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  // 检查认证状态
  const checkAuth = async () => {
    const savedToken = localStorage.getItem('token')
    const savedUser = localStorage.getItem('user')
    
    if (savedToken && savedUser) {
      try {
        token.value = savedToken
        const parsedUser = JSON.parse(savedUser)
        user.value = parsedUser
        
        // 验证token是否仍然有效
        const response = await api.get('/auth/verify')
        
        // 如果验证成功，更新用户信息（确保数据一致性）
        if (response.data.success && response.data.data.user) {
          const verifiedUser = response.data.data.user
          user.value = verifiedUser
          localStorage.setItem('user', JSON.stringify(verifiedUser))
        }
      } catch (error) {
        console.error('Token verification failed:', error)
        clearAuth()
      }
    }
  }

  // 用户登录
  const login = async (credentials) => {
    try {
      isLoading.value = true
      const response = await api.post('/auth/login', credentials)
      
      if (response.data.success) {
        setAuth(response.data.data.user, response.data.data.token)
        return { success: true, message: '登录成功' }
      } else {
        return { success: false, message: response.data.message || '登录失败' }
      }
    } catch (error) {
      console.error('Login error:', error)
      return { 
        success: false, 
        message: error.response?.data?.message || '登录失败，请检查网络连接' 
      }
    } finally {
      isLoading.value = false
    }
  }

  // 用户注册
  const register = async (userData) => {
    try {
      isLoading.value = true
      const response = await api.post('/auth/register', userData)
      
      if (response.data.success) {
        setAuth(response.data.data.user, response.data.data.token)
        return { success: true, message: '注册成功' }
      } else {
        return { success: false, message: response.data.message || '注册失败' }
      }
    } catch (error) {
      console.error('Register error:', error)
      return { 
        success: false, 
        message: error.response?.data?.message || '注册失败，请检查网络连接' 
      }
    } finally {
      isLoading.value = false
    }
  }

  // 用户登出
  const logout = async () => {
    try {
      if (token.value) {
        await api.post('/auth/logout')
      }
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      clearAuth()
    }
  }

  // 更新用户信息
  const updateProfile = async (profileData) => {
    try {
      isLoading.value = true
      const response = await api.put('/users/profile', profileData)
      
      if (response.data.success) {
        user.value = { ...user.value, ...response.data.data }
        localStorage.setItem('user', JSON.stringify(user.value))
        return { success: true, message: '资料更新成功' }
      } else {
        return { success: false, message: response.data.message || '更新失败' }
      }
    } catch (error) {
      console.error('Update profile error:', error)
      return { 
        success: false, 
        message: error.response?.data?.message || '更新失败，请检查网络连接' 
      }
    } finally {
      isLoading.value = false
    }
  }

  // 验证推荐码
  const verifyReferralCode = async (code) => {
    try {
      const response = await api.get(`/auth/verify-referral/${code}`)
      return response.data
    } catch (error) {
      console.error('Verify referral code error:', error)
      return { success: false, message: '推荐码验证失败' }
    }
  }

  // 获取推荐统计
  const getReferralStats = async () => {
    try {
      const response = await api.get('/user/referral-stats')
      return response.data
    } catch (error) {
      console.error('Get referral stats error:', error)
      return { success: false, message: '获取推荐统计失败' }
    }
  }

  return {
    // 状态
    user,
    token,
    isLoading,
    
    // 计算属性
    isAuthenticated,
    isLoggedIn,
    userInfo,
    isAdmin,
    
    // 方法
    setAuth,
    clearAuth,
    checkAuth,
    login,
    register,
    logout,
    updateProfile,
    verifyReferralCode,
    getReferralStats
  }
})