import { ref } from 'vue'

// 当前语言状态（与localStorage同步）
const currentLanguage = ref(localStorage.getItem('language') || 'th-TH')

/**
 * 获取当前语言的值
 * 用于处理后端返回的多语言字段数据
 * @param {Object} item - 包含多语言字段的对象
 * @param {string} field - 基础字段名（如 'name', 'description'）
 * @returns {string} 当前语言对应的值
 */
const getCurrentLanguageValue = (item, field) => {
  if (!item) return ''
  
  const currentLang = getCurrentLanguage()
  
  // 如果是泰语且存在泰语字段，返回泰语版本
  if (currentLang === 'th-TH' && item[`${field}_th`]) {
    return item[`${field}_th`]
  }
  
  // 如果是英语且存在英语字段，返回英语版本
  if (currentLang === 'en-US' && item[`${field}_en`]) {
    return item[`${field}_en`]
  }
  
  // 否则返回中文版本或基础字段
  return item[`${field}_zh`] || item[field] || ''
}

// 设置当前语言（同时更新localStorage）
const setCurrentLanguage = (lang) => {
  currentLanguage.value = lang
  localStorage.setItem('language', lang)
  
  // 触发自定义事件，通知其他组件语言变化
  window.dispatchEvent(new CustomEvent('language-changed', { 
    detail: { language: lang } 
  }))
}

// 获取当前语言
const getCurrentLanguage = () => {
  // 确保与localStorage保持同步
  const stored = localStorage.getItem('language')
  if (stored && stored !== currentLanguage.value) {
    currentLanguage.value = stored
  }
  return currentLanguage.value
}

// 监听localStorage变化，保持同步
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'language' && e.newValue) {
      currentLanguage.value = e.newValue
    }
  })
}

export default getCurrentLanguageValue
export { setCurrentLanguage, getCurrentLanguage, currentLanguage }