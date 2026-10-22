import { ref, onMounted, onUnmounted } from 'vue'

/**
 * 响应系统 prefers-reduced-motion，JS 动画与 CSS 动画一样可关闭
 */
export function useReducedMotion () {
  const reduced = ref(false)
  let media = null
  const update = () => {
    reduced.value = Boolean(media?.matches)
  }

  onMounted(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    media = window.matchMedia('(prefers-reduced-motion: reduce)')
    update()
    if (media.addEventListener) media.addEventListener('change', update)
    else if (media.addListener) media.addListener(update)
  })

  onUnmounted(() => {
    if (!media) return
    if (media.removeEventListener) media.removeEventListener('change', update)
    else if (media.removeListener) media.removeListener(update)
  })

  return reduced
}
