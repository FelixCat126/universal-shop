/**
 * 统一弹簧配置（苹果官网风格）
 *
 * 设计：
 *   - stiffness 高（响应快），damping 中等偏高（无抖动）
 *   - mass 小（轻盈感）
 *   - 全部为 GPU 合成 transform，避免触发 layout
 *
 * 用法：
 *   import { appleSpring, softSpring, bouncySpring } from '@/composables/useSpring.js'
 *   <div v-motion :initial="{ opacity: 0, y: 12 }" :enter="{ opacity: 1, y: 0, transition: appleSpring }" />
 */

/** 通用弹簧（入场、缩放） */
export const appleSpring = {
  type: 'spring',
  stiffness: 400,
  damping: 30,
  mass: 0.8
}

/** 软弹簧（页面切换、模态） */
export const softSpring = {
  type: 'spring',
  stiffness: 220,
  damping: 26,
  mass: 1
}

/** 弹性弹簧（按钮按下、回弹） */
export const bouncySpring = {
  type: 'spring',
  stiffness: 500,
  damping: 20,
  mass: 0.6
}

/** 微弹簧（hover 提升、tag 切换） */
export const subtleSpring = {
  type: 'spring',
  stiffness: 350,
  damping: 32,
  mass: 0.9
}

/** 弹簧回弹配置（拖拽释放） */
export const snapSpring = {
  type: 'spring',
  stiffness: 600,
  damping: 25,
  mass: 0.7
}
