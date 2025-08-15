<template>
  <div class="page-container">
    <div class="content-container py-8">
      <div class="max-w-md mx-auto">
        <div class="card p-6">
          <h1 class="text-2xl font-bold mb-6 text-center">用户登录</h1>
          
          <form @submit.prevent="handleLogin">
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                用户名/邮箱
              </label>
              <input
                type="text"
                v-model="loginForm.username"
                class="input"
                placeholder="请输入用户名或邮箱"
                required
              >
            </div>
            
            <div class="mb-6">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                密码
              </label>
              <input
                type="password"
                v-model="loginForm.password"
                class="input"
                placeholder="请输入密码"
                required
              >
            </div>
            
            <button type="submit" class="w-full btn btn-primary mb-4">
              登录
            </button>
          </form>
          
          <div class="text-center">
            <router-link to="/register" class="text-primary-600 hover:text-primary-700">
              还没有账号？去注册
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const loginForm = ref({
  username: '',
  password: ''
})

const handleLogin = () => {
  // TODO: 实现登录功能
  // 当前使用的是 /views/Login.vue 中的登录功能
}
</script>