<template>
  <el-container class="layout">
    <!-- 顶部导航栏 -->
    <el-header class="header">
      <div class="header-left">
        <!-- 小屏抽屉开关：侧边栏在小屏上会占掉一半屏幕，必须能收起来 -->
        <button
          type="button"
          class="sidebar-toggle md:hidden"
          :aria-label="t('menu.toggleSidebar')"
          @click="toggleSidebar"
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
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
            <!-- 暂不提供泰文界面选项（语言包仍保留，localStorage 为 th-TH 时仍可使用） -->
            <!-- <el-option value="th-TH" :label="t('language.thai')">
              <span>ไทย</span>
            </el-option> -->
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

    <el-container class="layout-inner">
      <!-- 侧边栏 -->
      <el-aside width="200px" class="sidebar" :class="{ 'sidebar-open': sidebarOpen }">
        <el-menu
          :default-active="activeMenuPath"
          class="sidebar-menu"
          background-color="#304156"
          text-color="#bfcbd9"
          active-text-color="#409EFF"
          @select="onMenuSelect"
        >
          <el-menu-item index="/dashboard">
            <el-icon><DataAnalysis /></el-icon>
            <span>{{ t('menu.dashboard') }}</span>
          </el-menu-item>
          <el-sub-menu index="/products-menu">
            <template #title>
              <el-icon><Goods /></el-icon>
              <span>{{ t('menu.productsMenu') }}</span>
            </template>
            <el-menu-item index="/products">{{ t('menu.productsList') }}</el-menu-item>
            <el-menu-item index="/product-categories">{{ t('menu.categoryManage') }}</el-menu-item>
          </el-sub-menu>
          <el-menu-item index="/orders">
            <el-icon><Document /></el-icon>
            <span>{{ t('menu.orders') }}</span>
          </el-menu-item>
          <el-sub-menu index="/marketing" v-if="adminStore.hasPermission('products')">
            <template #title>
              <el-icon><PriceTag /></el-icon>
              <span>{{ t('menu.marketing') }}</span>
            </template>
            <el-menu-item index="/promotions">{{ t('menu.promotions') }}</el-menu-item>
            <el-menu-item index="/bundles">{{ t('menu.bundles') }}</el-menu-item>
            <el-menu-item index="/coupon-templates">{{ t('menu.coupons') }}</el-menu-item>
          </el-sub-menu>
          <el-menu-item index="/users">
            <el-icon><User /></el-icon>
            <span>{{ t('menu.users') }}</span>
          </el-menu-item>
          <el-sub-menu index="/partner-wholesale" v-if="adminStore.hasPermission('partners')">
            <template #title>
              <el-icon><OfficeBuilding /></el-icon>
              <span>{{ t('menu.partnerWholesale') }}</span>
            </template>
            <el-menu-item index="/partners">{{ t('menu.partnersAccounts') }}</el-menu-item>
            <el-menu-item index="/partner-orders">{{ t('menu.partnerOrdersMenu') }}</el-menu-item>
          </el-sub-menu>
          <el-sub-menu index="/system">
            <template #title>
              <el-icon><UserFilled /></el-icon>
              <span>{{ t('menu.system') }}</span>
            </template>
            <!-- 与路由守卫一致：操作员角色无 administrators 权限，
                 此前菜单不隐藏、点击却被守卫拦下（next(false) + 弹权限不足） -->
            <el-menu-item index="/operators" v-if="adminStore.hasPermission('administrators')">{{ t('menu.operators') }}</el-menu-item>
            <el-menu-item index="/operation-logs" v-if="adminStore.isSuperAdmin">{{ t('menu.operationLogs') }}</el-menu-item>
            <el-menu-item index="/system-config" v-if="adminStore.isSuperAdmin">{{ t('menu.systemConfig') }}</el-menu-item>
          </el-sub-menu>
        </el-menu>
      </el-aside>

      <!-- 主内容区 -->
      <!-- 小屏抽屉的遮罩 -->
      <div
        v-if="sidebarOpen"
        class="sidebar-overlay md:hidden"
        @click="sidebarOpen = false"
      />

      <el-main class="main-content">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ensureLocale } from '../i18n/index.js'
import { User, ArrowDown, DataAnalysis, Goods, Document, UserFilled, OfficeBuilding, PriceTag } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import { useAdminStore } from '../stores/admin.js'

// 国际化
const { t, locale } = useI18n()

const router = useRouter()
const route = useRoute()
const adminStore = useAdminStore()

/** 与高亮索引一致（嵌套路由通常为 /dashboard 等无前缀路径） */
const activeMenuPath = computed(() => route.path)

/** el-sub-menu 仅用于展开的占位 index，不能做 router.push（否则跳转到不存在的路由） */
const submenuGroupIndices = new Set(['/products-menu', '/marketing', '/partner-wholesale', '/system'])

function onMenuSelect (index) {
  const path = typeof index === 'string' ? index.trim() : ''
  if (!path || submenuGroupIndices.has(path)) return
  router.push(path)
}

/**
 * 小屏侧边栏抽屉。
 *
 * 侧边栏固定 200px 且**没有响应式**：手机上 393px 的屏被吃掉一半，
 * 内容区只剩 193px —— 管理端在手机上基本没法用。
 * 现在小屏收进抽屉，点汉堡按钮或遮罩收起，路由切换也自动收起。
 */
const sidebarOpen = ref(false)
const toggleSidebar = () => { sidebarOpen.value = !sidebarOpen.value }
watch(() => route.path, () => { sidebarOpen.value = false })

// 语言切换
const currentLanguage = ref(locale.value)

// 切换语言
const changeLanguage = async (lang) => {
  // 语言包按需加载：先拉下来再切，避免那一瞬间显示成 fallback
  await ensureLocale(lang)
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
  flex-direction: column;
}

.layout-inner {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  align-items: stretch;
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
  flex-shrink: 0;
  background-color: #304156;
  overflow-x: visible;
  overflow-y: auto;
  position: relative;
  z-index: 101;
}

/**
 * 小屏（<768px）：侧边栏变成抽屉。
 *
 * 之前侧边栏是固定 200px 的常驻栏，手机上直接占掉一半屏幕。
 */
@media (max-width: 767px) {
  .sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: 200px;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    z-index: 2001;
  }
  .sidebar.sidebar-open {
    transform: translateX(0);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }
  .sidebar-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 2000;
  }
}

.sidebar-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-right: 8px;
  border-radius: 6px;
  color: #606266;
  touch-action: manipulation;
}
.sidebar-toggle:hover {
  background: #f2f4f7;
}

.sidebar-menu {
  border-right: none;
  height: 100%;
}

.main-content {
  background-color: #f0f2f5;
  padding: 20px;
  flex: 1;
  min-width: 0;
  overflow: auto;
  position: relative;
  z-index: 0;
}
</style>