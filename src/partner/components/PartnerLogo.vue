<template>
  <!--
    合作方（批发端）专属标识
    =========================
    为什么不用通用图标：
      原来用的是 BuildingStorefrontIcon（一个带"A"的店面方块）——
      那是**零售**的通用符号，放在批发端既不贴切，
      而且它是白色图标画在 15% 不透明白底上（实测对比度 **1.0**）→ 根本看不清。

    现在：
      - 图形是**等轴测货箱 + 价签**：一眼表达"批发/订货"，与零售端的购物袋区分
      - 底色与图形的对比度由外层容器保证（见 Login.vue / App.vue 的用法）：
        白色实底方块 + 墨绿图形 ≈ 对比度 12:1（WCAG AAA）
      - 图形用 currentColor，跟随容器文字色，浅色/深色背景都能用
  -->
  <span
    class="partner-logo inline-flex items-center justify-center shrink-0"
    :class="boxClass"
    aria-hidden="true"
  >
    <svg
      viewBox="0 0 36 36"
      fill="none"
      :class="iconClass"
      xmlns="http://www.w3.org/2000/svg"
    >
      <!-- 货箱：等轴测立方体（顶面 + 左右两个侧面） -->
      <path
        d="M17 6.5 30 13 17 19.5 4 13z"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linejoin="round"
      />
      <path
        d="M4 13 17 19.5V31L4 24.5z"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linejoin="round"
      />
      <path
        d="M30 13 17 19.5V31L30 24.5z"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linejoin="round"
      />
      <!-- 价签：批发定价的暗示（右上角吊牌 + 穿孔） -->
      <rect
        x="22.5"
        y="3"
        width="10.5"
        height="7"
        rx="2.2"
        stroke="currentColor"
        stroke-width="1.7"
      />
      <circle cx="26" cy="6.5" r="1.15" fill="currentColor" />
    </svg>
  </span>
</template>

<script setup>
/**
 * 合作方标识。
 * 底色与文字色由使用方通过 boxClass / iconClass 决定，
 * 组件本身只负责图形 —— 同一份图形能用在深色登录页与白色顶栏上。
 */
const props = defineProps({
  /** 方块尺寸类（Tailwind） */
  boxClass: { type: String, default: 'h-10 w-10 rounded-xl bg-white text-primary-700' },
  /** 图标尺寸类（Tailwind） */
  iconClass: { type: String, default: 'h-6 w-6' }
})
</script>
