<template>
  <div v-if="modelValue" class="fixed inset-0 z-[110] flex items-center justify-center p-4">
    <div class="fixed inset-0 bg-black bg-opacity-50" @click="onBackdrop" />
    <div class="bg-white p-6 rounded-lg shadow-xl z-10 w-full max-w-md">
      <div class="text-center">
        <h3 class="text-lg font-medium mb-4">{{ t('payment.scanToPay') }}</h3>

        <div class="mb-4 p-4 bg-gray-50 rounded-lg">
          <div class="mb-3">
            <div class="text-sm text-gray-600">{{ t('payment.orderAmount') }}</div>
            <div class="text-2xl font-bold text-blue-600">{{ thbMoney(totalThb) }}</div>
          </div>
          <div class="pt-3 border-t border-gray-200">
            <div class="text-sm text-gray-600">{{ t('payment.usdtAmount') }}</div>
            <div class="text-xl font-semibold text-green-600">{{ usdtAmount }} USDT</div>
          </div>
        </div>

        <div class="mb-6 p-4 bg-gray-50 rounded-lg">
          <div class="w-48 h-48 mx-auto bg-white rounded-lg flex items-center justify-center border-2 border-dashed border-gray-300">
            <div v-if="qrPath" class="w-full h-full flex items-center justify-center">
              <img
                :src="imgUrl(qrPath)"
                :alt="t('payment.qrCode')"
                class="max-w-full max-h-full object-contain rounded-lg"
                @error="$emit('qr-error')"
              />
            </div>
            <div v-else class="text-center">
              <div class="text-6xl mb-2">📱</div>
              <div class="text-sm text-gray-500">{{ t('payment.scanToPay') }}</div>
              <div class="text-xs text-gray-400 mt-1">{{ t('payment.supportedMethods') }}</div>
            </div>
          </div>
          <div v-if="qrPath" class="mt-2 text-center">
            <div class="text-xs text-gray-500 bg-blue-50 px-3 py-2 rounded-md border border-blue-100">
              💡 {{ t('payment.qrCodeSaveTip') }}
            </div>
          </div>
        </div>

        <div class="mb-6 text-sm text-gray-600">
          <p>{{ t('payment.scanInstruction') }}</p>
          <p class="mt-1">{{ t('payment.rightClickToSave') }}</p>
          <p class="mt-1">{{ t('payment.confirmAfterPayment') }}</p>
        </div>

        <div class="flex space-x-3">
          <button
            type="button"
            class="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 touch-manipulation"
            :disabled="confirming"
            @click="$emit('cancel')"
          >
            {{ t('payment.cancel') }}
          </button>
          <button
            type="button"
            class="flex-1 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 touch-manipulation disabled:opacity-50"
            :disabled="confirming"
            @click="$emit('confirm')"
          >
            {{ confirming ? t('shop.submitting') : t('payment.complete') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import config from '../../config/index.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  totalThb: { type: [Number, String], default: 0 },
  qrPath: { type: String, default: '' },
  exchangeRateUsd: { type: Number, default: 0 },
  confirming: { type: Boolean, default: false }
})

const emit = defineEmits(['cancel', 'confirm', 'qr-error', 'update:modelValue'])

const { t } = useI18n()

function money (v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

function thbMoney (v) {
  return `฿${money(v)}`
}

function imgUrl (p) {
  if (!p) return ''
  return config.buildStaticUrl(p)
}

const usdtAmount = computed(() => {
  const base = parseFloat(String(props.totalThb))
  const thb = Number.isFinite(base) ? base : 0
  return (thb * (Number(props.exchangeRateUsd) || 0)).toFixed(2)
})

function onBackdrop () {
  if (props.confirming) return
  emit('cancel')
}
</script>
