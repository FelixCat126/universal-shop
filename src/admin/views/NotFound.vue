<template>
  <div class="not-found">
    <el-result
      class="not-found-result"
      icon="warning"
      title="404"
      :sub-title="t('notFound.title')"
    >
      <template #extra>
        <el-button type="primary" size="large" @click="goHome">
          {{ t('notFound.backHome') }}
        </el-button>
      </template>
    </el-result>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const router = useRouter()

// 回到应用根路径：已登录由路由重定向到 /dashboard，未登录由守卫送到 /login
const goHome = () => {
  router.push('/')
}
</script>

<style scoped>
.not-found {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.not-found-result {
  padding: 48px 64px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
}

.not-found-result :deep(.el-result__title p) {
  font-size: 64px;
  font-weight: 700;
  background: linear-gradient(135deg, #409EFF, #67C23A);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

@media (max-width: 480px) {
  .not-found-result {
    padding: 32px 24px;
    margin: 0 16px;
  }

  .not-found-result :deep(.el-result__title p) {
    font-size: 48px;
  }
}
</style>
