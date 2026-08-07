import { ref, onMounted, onUnmounted } from 'vue'

/**
 * 滚动视差引擎（基于 IntersectionObserver + rAF）
 *
 * 苹果官网风格：
 *   - 元素进入视口时按滚动进度连续变形
 *   - 不是"入场一次"而是"跟随滚动"
 *
 * 用法：
 *   <img v-motion-parallax="{ from: 0.1, to: 0.9, scale: [0.96, 1], opacity: [0.5, 1] }" />
 */

/**
 * 把 [a, b] 映射到 [x, y]
 */
function mapRange (t, a, b, x, y) {
  if (a === b) return x
  const k = (t - a) / (b - a)
  const clamped = Math.max(0, Math.min(1, k))
  return x + (y - x) * clamped
}

/**
 * 注册全局指令
 */
export function registerMotionParallax (app) {
  app.directive('motion-parallax', {
    mounted (el, binding) {
      const opts = binding.value || {}
      const from = opts.from ?? 0
      const to = opts.to ?? 1
      const scale = opts.scale ?? null
      const opacity = opts.opacity ?? null
      const translateY = opts.translateY ?? null

      let rafId = null
      let observer = null

      const update = () => {
        const rect = el.getBoundingClientRect()
        const viewportH = window.innerHeight
        // 元素中心在视口中的相对位置 [0, 1]
        const centerOffset = rect.top + rect.height / 2
        const progress = 1 - Math.max(0, Math.min(1, centerOffset / viewportH))

        const t = mapRange(progress, from, to, 0, 1)

        const transforms = []
        if (scale) {
          const s = mapRange(t, 0, 1, scale[0], scale[1])
          transforms.push(`scale(${s})`)
        }
        if (translateY) {
          const y = mapRange(t, 0, 1, translateY[0], translateY[1])
          transforms.push(`translateY(${y}px)`)
        }
        if (opacity) {
          const o = mapRange(t, 0, 1, opacity[0], opacity[1])
          el.style.opacity = String(o)
        }
        if (transforms.length > 0) {
          el.style.transform = transforms.join(' ')
        }
      }

      const onScroll = () => {
        if (rafId) return
        rafId = requestAnimationFrame(() => {
          update()
          rafId = null
        })
      }

      // 初始化一次
      update()

      // 进入视口才监听滚动，离开视口停止（性能）
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0]
          if (entry.isIntersecting) {
            window.addEventListener('scroll', onScroll, { passive: true })
            window.addEventListener('resize', onScroll, { passive: true })
          } else {
            window.removeEventListener('scroll', onScroll)
            window.removeEventListener('resize', onScroll)
            if (rafId) {
              cancelAnimationFrame(rafId)
              rafId = null
            }
          }
        },
        { threshold: 0 }
      )
      observer.observe(el)

      el.__parallaxCleanup__ = () => {
        if (observer) observer.disconnect()
        window.removeEventListener('scroll', onScroll)
        window.removeEventListener('resize', onScroll)
        if (rafId) cancelAnimationFrame(rafId)
      }
    },
    unmounted (el) {
      if (el.__parallaxCleanup__) {
        el.__parallaxCleanup__()
        delete el.__parallaxCleanup__
      }
    }
  })
}
