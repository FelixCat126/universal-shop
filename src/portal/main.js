import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import './style.css'

// 门户端应用启动

const app = createApp(App)
const pinia = createPinia()

// 使用Pinia状态管理
app.use(pinia)

// 使用国际化
app.use(i18n)

// 使用路由
app.use(router)

app.mount('#app')

// 应用已挂载到DOM