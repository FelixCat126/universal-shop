<template>
  <div class="relative min-w-0">
    <select
      :value="modelValue"
      class="phone-cc-select touch-manipulation"
      @change="onChange"
    >
      <option v-for="c in options" :key="c.code" :value="c.code">{{ c.flag }} {{ c.code }}</option>
    </select>
    <span class="pointer-events-none absolute inset-y-0 right-2 flex items-center text-gray-400">
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
        <path
          fill-rule="evenodd"
          d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
          clip-rule="evenodd"
        />
      </svg>
    </span>
  </div>
</template>

<script setup>
const options = [
  { code: '+66', flag: '🇹🇭' },
  { code: '+86', flag: '🇨🇳' },
  { code: '+60', flag: '🇲🇾' }
]

defineProps({
  modelValue: {
    type: String,
    default: '+66'
  }
})

const emit = defineEmits(['update:modelValue'])

function onChange (e) {
  emit('update:modelValue', e.target.value)
}
</script>

<style scoped>
.phone-cc-select {
  box-sizing: border-box;
  display: block;
  width: 100%;
  min-height: 44px;
  border-radius: 0.75rem;
  border: 1px solid rgb(209 213 219);
  padding: 0.5rem 1.75rem 0.5rem 0.75rem;
  font-size: 1rem;
  line-height: 1.35;
  background: #fff;
  color: rgb(17 24 39);
  appearance: none;
  -webkit-appearance: none;
}

.phone-cc-select:focus {
  outline: none;
  border-color: rgb(13 148 136);
  box-shadow: 0 0 0 3px rgb(204 251 241);
}

.phone-cc-select:disabled {
  background: rgb(249 250 251);
  color: rgb(107 114 128);
}
</style>
