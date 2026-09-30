<template>
  <div class="mx-auto max-w-md px-4 py-16 sm:py-24 text-center animate-fade-in">
    <div class="rounded-2xl bg-white p-8 sm:p-10 shadow-strong ring-1 ring-black/5">
      <div class="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary-50">
        <ExclamationTriangleIcon class="h-10 w-10 text-primary-500" />
      </div>
      <p class="mt-5 text-5xl font-extrabold tracking-tight text-gray-900">404</p>
      <h1 class="mt-2 text-lg font-semibold text-gray-900">
        {{ t('notFound.title') }}
      </h1>
      <button
        type="button"
        class="mt-8 inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-primary-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 touch-manipulation"
        @click="goHome"
      >
        {{ t('notFound.backHome') }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ExclamationTriangleIcon } from '@heroicons/vue/24/outline'

const router = useRouter()
const { t } = useI18n()

function goHome () {
  router.push('/shop')
}
</script>
