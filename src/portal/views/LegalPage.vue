<template>
  <div class="min-h-screen bg-gray-50">
    <main class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="ui-slide-up bg-white rounded-xl shadow-sm p-6 sm:p-8">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">{{ title }}</h1>
        <div class="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap leading-7">{{ body }}</div>
        <router-link to="/" class="inline-flex mt-8 px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700">
          {{ t('common.backToHome') }}
        </router-link>
      </div>
    </main>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  kind: { type: String, required: true, validator: (v) => ['privacy', 'terms'].includes(v) }
})

const { t } = useI18n()
const title = computed(() => t(`legal.${props.kind}Title`))
const body = computed(() => t(`legal.${props.kind}Body`))
</script>
