import axios from 'axios'
import config from '../../config/index.js'
import { useUserStore } from '../stores/user.js'
// 移除循环依赖 - 在拦截器中动态导入

// 创建axios实例
const api = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 请求拦截器 - 简化版本，避免循环依赖
api.interceptors.request.use(
  (config) => {
    // 添加认证token - 从localStorage直接获取
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }

    // 添加语言头
    const language = localStorage.getItem('language') || 'th-TH'
    config.headers['Accept-Language'] = language

    // 开发环境下打印请求信息
    if (import.meta.env.DEV) {
      console.log('API Request:', {
        method: config.method?.toUpperCase(),
        url: config.url,
        data: config.data
      })
    }

    return config
  },
  (error) => {
    console.error('Request error:', error)
    return Promise.reject(error)
  }
)

// 响应拦截器 - 简化版本，避免循环依赖
api.interceptors.response.use(
  (response) => {
    // 开发环境下打印响应信息
    if (import.meta.env.DEV) {
      console.log('API Response:', {
        status: response.status,
        url: response.config.url,
        data: response.data
      })
    }

    return response
  },
  (error) => {
    // 处理网络错误 - 简化版本
    if (!error.response) {
      console.error('网络错误，请检查网络连接')
      return Promise.reject(error)
    }

    const { status, data } = error.response

    // 根据HTTP状态码处理错误 - 简化版本
    switch (status) {
      case 401: {
        /**
         * 区分两种 401：
         *   - 登录/注册接口返回的 401 = 「用户名或密码错误」，
         *     这是**当前操作**的失败，不能当成"登录过期"去清会话，
         *     否则用户在登录页输错一次密码，会把已登录的门户（乃至合作方）会话一起登出。
         *   - 其它接口返回的 401 = token 失效/未授权 → 确实要清会话并跳登录。
         */
        const url = String(error.config?.url || '')
        const isAuthEndpoint = /\/(login|register|forgot-password|reset-password)$/.test(url)
        if (isAuthEndpoint) {
          console.error('认证失败（账号或密码错误）')
          break
        }

        // 未授权：清除本地存储 + Pinia 内存态（只清 localStorage 会让
        // userStore.isLoggedIn 仍为 true，顶栏继续显示旧用户，后续请求变成匿名 → 401 循环）
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        // 同步清理 Pinia 内存态（store 已在应用启动时注册）
        try {
          useUserStore().clearAuth()
        } catch (e) {
          // Pinia 未就绪时忽略（内存态本就未建立）
        }

        // 如果不是登录或注册页面，则跳转到登录页（带应用 base，生产为 /portal/）
        if (!window.location.pathname.includes('/login') &&
            !window.location.pathname.includes('/register')) {
          window.location.href = `${import.meta.env.BASE_URL || '/'}login`
        }

        console.error('登录已过期，请重新登录')
        break
      }
        
      case 403:
        /**
         * 「必须先改密码」：服务端在**账号级操作**上拦住了（改资料/注销/售后/确认支付）。
         * 这里把用户直接送到改密弹窗 —— 而不是只弹一句"没有权限访问"，
         * 让用户自己猜该去哪改。
         */
        if (data?.code === 'PASSWORD_CHANGE_REQUIRED') {
          try {
            window.dispatchEvent(new CustomEvent('app:password-change-required'))
          } catch (e) { /* 事件派发失败不影响主流程 */ }
          console.warn('需要先修改密码')
          break
        }
        console.error('没有权限访问')
        break
        
      case 404:
        console.error('请求的资源不存在')
        break
        
      case 422:
        console.error('请求参数错误:', data.message)
        break
        
      case 429:
        console.error('请求过于频繁，请稍后再试')
        break
        
      case 500:
        console.error('服务器内部错误')
        break
        
      case 502:
      case 503:
      case 504:
        console.error('服务器暂时不可用，请稍后再试')
        break
        
      default:
        console.error('请求失败:', data.message || '未知错误')
    }

    console.error('API Error:', {
      status,
      url: error.config?.url,
      message: data?.message,
      data
    })

    return Promise.reject(error)
  }
)

/**
 * 第 46 轮：删掉本文件里**无人使用**的导出（authAPI / request / uploadFile / downloadFile）。
 *
 * 它们看起来是"通用能力"，但全项目没有任何调用方：
 *   - authAPI：登录/注册/登出都走 stores/user.js 里的 api.post
 *   - request / uploadFile / downloadFile：门户里没有用到
 *
 * 留着会让人以为"这些能力已经接好了"，实际是**从未接过的备用件**。
 */
export default api