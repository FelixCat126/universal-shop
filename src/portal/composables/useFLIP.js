import { reactive } from 'vue'

/**
 * 跨页 FLIP（First-Last-Invert-Play）
 *
 * 苹果官网"商品图从列表飞到详情页"的关键技术：
 *   - First:  记录元素在源页面的位置
 *   - Last:   在新页面记录元素的目标位置
 *   - Invert: 计算位置差，把元素瞬移回源位置（视觉不变）
 *   - Play:   用 spring 动画从源位置到目标位置
 *
 * 用法：
 *   // 源页面（Home）
 *   const { recordPosition } = useFLIP()
 *   <img @click="recordPosition('product-image', $event)" />
 *
 *   // 目标页面（ProductDetail）
 *   const { playFLIP } = useFLIP()
 *   <img v-motion :initial="getInitial('product-image')" :enter="playFLIP('product-image')" />
 */

const store = reactive(new Map())

export function useFLIP () {
  /**
   * 记录元素位置（源页面）
   * @param {string} key 唯一标识
   * @param {Event|DOMRect} eventOrRect 点击事件或位置
   */
  function recordPosition (key, eventOrRect) {
    let rect
    if (eventOrRect instanceof DOMRect) {
      rect = eventOrRect
    } else if (eventOrRect?.currentTarget) {
      rect = eventOrRect.currentTarget.getBoundingClientRect()
    } else if (eventOrRect?.target) {
      rect = eventOrRect.target.getBoundingClientRect()
    } else {
      return
    }
    store.set(key, {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      time: Date.now()
    })
  }

  /**
   * 取初始位置（目标页面）
   * @param {string} key
   * @returns {{ x: number, y: number, scaleX: number, scaleY: number } | null}
   */
  function getInitial (key, currentRect) {
    const prev = store.get(key)
    if (!prev) return null
    if (!currentRect) return null
    // 5 秒过期（防止脏数据）
    if (Date.now() - prev.time > 5000) {
      store.delete(key)
      return null
    }
    return {
      x: prev.left - currentRect.left,
      y: prev.top - currentRect.top,
      scaleX: prev.width / currentRect.width,
      scaleY: prev.height / currentRect.height,
      opacity: 1
    }
  }

  /**
   * 取 enter 动画（目标位置 = 0, 0, scale 1）
   */
  function getEnter (spring) {
    return {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      transition: spring
    }
  }

  /**
   * 清除记录
   */
  function clear (key) {
    store.delete(key)
  }

  return { recordPosition, getInitial, getEnter, clear }
}
