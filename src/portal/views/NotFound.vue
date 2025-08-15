<template>
  <div class="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
    <div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
      <div class="bg-white py-8 px-4 shadow-soft sm:rounded-lg sm:px-10 text-center">
        <!-- 404图标 -->
        <div class="mx-auto flex items-center justify-center h-32 w-32 rounded-full bg-red-100 mb-6">
          <ExclamationTriangleIcon class="h-16 w-16 text-red-600" />
        </div>
        
        <!-- 错误信息 -->
        <h2 class="text-3xl font-bold text-gray-900 mb-2">
          {{ $t('error.notFound') }}
        </h2>
        
        <p class="text-gray-600 mb-8">
          抱歉，您访问的页面不存在或已被移除。
        </p>
        
        <!-- 操作按钮 -->
        <div class="space-y-3">
          <button
            @click="$router.push({ name: 'Home' })"
            class="w-full btn btn-primary"
          >
            {{ $t('common.home') }}
          </button>
          
          <button
            @click="$router.back()"
            class="w-full btn btn-secondary"
          >
            {{ $t('common.back') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ExclamationTriangleIcon } from '@heroicons/vue/24/outline'
</script>