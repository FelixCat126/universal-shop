<template>
  <el-container class="layout">
    <!-- 顶部导航栏 -->
    <el-header class="header">
      <div class="header-left">
        <h2>{{ t('login.title') }}</h2>
      </div>
      <div class="header-right">
        <!-- 语言切换 -->
        <div class="language-selector">
          <el-select 
            v-model="currentLanguage"
            @change="changeLanguage"
            size="small"
            style="width: 80px; margin-right: 16px"
          >
            <el-option value="th-TH" :label="t('language.thai')">
              <span>ไทย</span>
            </el-option>
            <el-option value="zh-CN" :label="t('language.chinese')">
              <span>中文</span>
            </el-option>
            <el-option value="en-US" :label="t('language.english')">
              <span>English</span>
            </el-option>
          </el-select>
        </div>

        <!-- 用户下拉菜单 -->
        <el-dropdown @command="handleCommand">
          <span class="el-dropdown-link">
            <el-icon><User /></el-icon>
            {{ adminStore.adminInfo?.username || t('login.defaultUsername') }}
            <el-icon class="el-icon--right"><arrow-down /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item disabled>
                {{ adminStore.adminInfo?.real_name || adminStore.adminInfo?.username }}
                ({{ getRoleText(adminStore.adminInfo?.role) }})
              </el-dropdown-item>
              <el-dropdown-item divided command="logout">{{ t('menu.logout') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-header>

    <el-container>
      <!-- 侧边栏 -->
      <el-aside width="200px" class="sidebar">
        <el-menu
          :default-active="$route.path"
          router
          class="sidebar-menu"
          background-color="#304156"
          text-color="#bfcbd9"
          active-text-color="#409EFF"
        >
          <el-menu-item index="/dashboard">
            <el-icon><DataAnalysis /></el-icon>
            <span>{{ t('menu.dashboard') }}</span>
          </el-menu-item>
          <el-menu-item index="/products">
            <el-icon><Goods /></el-icon>
            <span>{{ t('menu.products') }}</span>
          </el-menu-item>
          <el-menu-item index="/orders">
            <el-icon><Document /></el-icon>
            <span>{{ t('menu.orders') }}</span>
          </el-menu-item>
          <el-menu-item index="/users">
            <el-icon><User /></el-icon>
            <span>{{ t('menu.users') }}</span>
          </el-menu-item>
          <el-sub-menu index="/system">
            <template #title>
              <el-icon><UserFilled /></el-icon>
              <span>{{ t('menu.system') }}</span>
            </template>
            <el-menu-item index="/operators">{{ t('menu.operators') }}</el-menu-item>
            <el-menu-item index="/operation-logs" v-if="adminStore.isSuperAdmin">{{ t('menu.operationLogs') }}</el-menu-item>
            <el-menu-item index="/system-config" v-if="adminStore.isSuperAdmin">{{ t('menu.systemConfig') }}</el-menu-item>
          </el-sub-menu>
        </el-menu>
      </el-aside>

      <!-- 主内容区 -->
      <el-main class="main-content">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { User, ArrowDown, DataAnalysis, Goods, Document, UserFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useAdminStore } from '../stores/admin.js'

// 国际化
const { t, locale } = useI18n()

// 路由和store
const router = useRouter()
const adminStore = useAdminStore()

// 语言切换
const currentLanguage = ref(locale.value)

// 切换语言
const changeLanguage = (lang) => {
  locale.value = lang
  currentLanguage.value = lang
  localStorage.setItem('admin-language', lang)
  ElMessage.success(t('language.switchSuccess'))
}

// 处理下拉菜单命令
const handleCommand = (command) => {
  if (command === 'logout') {
    // 调用store的logout方法清除登录状态
    adminStore.logout()
    ElMessage.success(t('message.logoutSuccess'))
    // 跳转到登录页
    router.push('/login')
  }
}

// 获取角色文本
const getRoleText = (role) => {
  const roleMap = {
    'super_admin': t('role.superAdmin'),
    'admin': t('role.admin'),
    'operator': t('role.operator')
  }
  return roleMap[role] || t('role.unknown')
}
</script>

<style scoped>
.layout {
  height: 100vh;
}

.header {
  background-color: #fff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
}

.header-left h2 {
  margin: 0;
  color: #303133;
}

.header-right {
  display: flex;
  align-items: center;
  cursor: pointer;
}

.language-selector {
  display: flex;
  align-items: center;
}

.el-dropdown-link {
  color: #606266;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.sidebar {
  background-color: #304156;
}

.sidebar-menu {
  border-right: none;
  height: 100%;
}

.main-content {
  background-color: #f0f2f5;
  padding: 20px;
}
</style>