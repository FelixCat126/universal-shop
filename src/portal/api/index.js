import axios from 'axios'
import config from '../../config/index.js'
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
      case 401:
        // 未授权，清除本地存储并跳转到登录页
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        
        // 如果不是登录或注册页面，则跳转到登录页
        if (!window.location.pathname.includes('/login') && 
            !window.location.pathname.includes('/register')) {
          window.location.href = '/login'
        }
        
        console.error('登录已过期，请重新登录')
        break
        
      case 403:
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

// 认证相关API
const authAPI = {
  // 用户登录
  login: (credentials) => api.post('/auth/login', credentials),
  
  // 用户注册
  register: (userData) => api.post('/auth/register', userData),
  
  // 用户登出
  logout: () => api.post('/auth/logout'),
  
  // 验证token
  verify: () => api.get('/auth/verify'),
  
  // 刷新token
  refresh: () => api.post('/auth/refresh')
}

// 请求方法封装
const request = {
  get: (url, config = {}) => api.get(url, config),
  post: (url, data = {}, config = {}) => api.post(url, data, config),
  put: (url, data = {}, config = {}) => api.put(url, data, config),
  patch: (url, data = {}, config = {}) => api.patch(url, data, config),
  delete: (url, config = {}) => api.delete(url, config)
}

// 文件上传方法
const uploadFile = (url, file, onProgress = null) => {
  const formData = new FormData()
  formData.append('file', file)
  
  return api.post(url, formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    },
    onUploadProgress: onProgress
  })
}

// 下载文件方法
const downloadFile = async (url, filename) => {
  try {
    const response = await api.get(url, {
      responseType: 'blob'
    })
    
    const blob = new Blob([response.data])
    const downloadUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    
    link.href = downloadUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    
    document.body.removeChild(link)
    window.URL.revokeObjectURL(downloadUrl)
    
    return { success: true }
  } catch (error) {
    console.error('Download error:', error)
    return { success: false, message: '下载失败' }
  }
}

// 导出API实例和方法
export default api
export { authAPI, request, uploadFile, downloadFile }