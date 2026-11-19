<template>
  <!--
    ⚠️ 这里**只用 Element Plus 原语 + 内联样式**，不写 Tailwind 类：
    管理后台没有引入 Tailwind CSS（main.js 只引 element-plus 与 admin-ui-overrides.css），
    类名写了也不生效 —— 布局会散架成"看起来该居中却铺满整屏"。
    （第 36 轮会统一清理后台里这类失效类。）
  -->
  <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; background: #f5f7fa;">
    <el-card shadow="never" style="width: 100%; max-width: 420px; border-radius: 12px;">
      <template #header>
        <div style="display: flex; align-items: center; gap: 8px;">
          <el-icon style="color: #f59e0b;"><Warning /></el-icon>
          <span style="font-weight: 600; color: #1f2937;">{{ t('password.changeTitle') }}</span>
        </div>
      </template>

      <el-alert
        v-if="forced"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 16px;"
        :title="t('password.forcedNotice')"
      />

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
        <el-form-item :label="t('password.oldPassword')" prop="old_password">
          <el-input
            v-model="form.old_password"
            type="password"
            show-password
            autocomplete="current-password"
            data-testid="old-password"
          />
        </el-form-item>

        <el-form-item :label="t('password.newPassword')" prop="new_password">
          <el-input
            v-model="form.new_password"
            type="password"
            show-password
            autocomplete="new-password"
            data-testid="new-password"
          />
        </el-form-item>

        <el-form-item :label="t('password.confirmPassword')" prop="confirm_password">
          <el-input
            v-model="form.confirm_password"
            type="password"
            show-password
            autocomplete="new-password"
            data-testid="confirm-password"
          />
        </el-form-item>

        <el-button
          type="primary"
          native-type="submit"
          :loading="loading"
          style="width: 100%; height: 40px; border-radius: 8px;"
          data-testid="submit-password"
        >
          {{ t('password.submit') }}
        </el-button>

        <el-button
          v-if="!forced"
          style="width: 100%; height: 40px; margin-top: 8px; border-radius: 8px;"
          data-testid="cancel-password"
          @click="goBack"
        >
          {{ t('common.cancel') }}
        </el-button>
      </el-form>

      <p style="margin-top: 16px; font-size: 12px; line-height: 1.6; color: #9ca3af;">
        {{ t('password.policyHint') }}
      </p>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Warning } from '@element-plus/icons-vue'
import { useAdminStore } from '../stores/admin.js'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const router = useRouter()
const store = useAdminStore()

const formRef = ref(null)
const loading = ref(false)
const form = reactive({ old_password: '', new_password: '', confirm_password: '' })

/** 强制改密：此时没有任何"返回后台"的入口，只能改完或登出 */
const forced = computed(() => store.mustResetPassword === true)

const rules = {
  old_password: [{ required: true, message: () => t('password.oldPasswordRequired'), trigger: 'blur' }],
  new_password: [
    { required: true, message: () => t('password.newPasswordRequired'), trigger: 'blur' },
    { min: 8, message: () => t('password.policyHint'), trigger: 'blur' }
  ],
  confirm_password: [
    { required: true, message: () => t('password.confirmPasswordRequired'), trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value !== form.new_password) return callback(new Error(t('password.mismatch')))
        callback()
      },
      trigger: 'blur'
    }
  ]
}

async function submit () {
  const ok = await formRef.value?.validate().catch(() => false)
  if (!ok) return
  loading.value = true
  try {
    const res = await store.apiRequest('/api/admin/me/password', {
      method: 'PUT',
      body: JSON.stringify({
        old_password: form.old_password,
        new_password: form.new_password
      })
    })
    if (res.success) {
      ElMessage.success(res.message || t('password.success'))
      // 改密后旧令牌已失效（服务端递增了 token_version）→ 重新登录
      store.logout()
      router.push('/login')
    } else {
      ElMessage.error(res.message || t('password.failed'))
    }
  } catch (e) {
    ElMessage.error(e?.message || t('password.failed'))
  } finally {
    loading.value = false
  }
}

function goBack () {
  router.back()
}
</script>
