<template>
  <div class="page-container">
    <div class="content-container py-8">
      <div class="max-w-md mx-auto">
        <div class="card p-6">
          <h1 class="text-2xl font-bold mb-6 text-center">用户注册</h1>
          
          <form @submit.prevent="handleRegister">
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                用户名
              </label>
              <input
                type="text"
                v-model="registerForm.username"
                class="input"
                placeholder="请输入用户名"
                required
              >
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                邮箱
              </label>
              <input
                type="email"
                v-model="registerForm.email"
                class="input"
                placeholder="请输入邮箱"
                required
              >
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                推荐码 (可选)
              </label>
              <input
                type="text"
                v-model="registerForm.referralCode"
                class="input"
                placeholder="请输入推荐码"
              >
            </div>
            
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                密码
              </label>
              <input
                type="password"
                v-model="registerForm.password"
                class="input"
                placeholder="请输入密码"
                required
              >
            </div>
            
            <div class="mb-6">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                确认密码
              </label>
              <input
                type="password"
                v-model="registerForm.confirmPassword"
                class="input"
                placeholder="请再次输入密码"
                required
              >
            </div>
            
            <button type="submit" class="w-full btn btn-primary mb-4">
              注册
            </button>
          </form>
          
          <div class="text-center">
            <router-link to="/login" class="text-primary-600 hover:text-primary-700">
              已有账号？去登录
            </router-link>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const registerForm = ref({
  username: '',
  email: '',
  referralCode: '',
  password: '',
  confirmPassword: ''
})

const handleRegister = () => {
  // TODO: 实现注册功能
  // 当前使用的是 /views/Register.vue 中的注册功能
}
</script>