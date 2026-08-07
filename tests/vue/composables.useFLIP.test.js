/**
 * VC-useFLIP — 跨页过渡
 *
 * 覆盖：
 *   FL-1 recordPosition 存入 Map
 *   FL-2 getInitial 计算 x/y/scale
 *   FL-3 5 秒过期
 *   FL-4 clear 删除记录
 */
import { describe, it, expect } from 'vitest'

const { useFLIP } = await import('@portal/composables/useFLIP.js')

function makeRect (left, top, width, height) {
  // DOMRect(x, y, width, height) ；x=left, y=top
  return new DOMRect(left, top, width, height)
}

describe('VC.composables.useFLIP', () => {
  it('FL-1 recordPosition 存入 Map', () => {
    const { recordPosition, getInitial } = useFLIP()
    recordPosition('test', makeRect(200, 100, 50, 50))
    const r = getInitial('test', { top: 150, left: 250, width: 100, height: 100 })
    expect(r).not.toBeNull()
  })

  it('FL-2 getInitial 计算 x/y/scale', () => {
    const { recordPosition, getInitial } = useFLIP()
    // 源：left=200, top=100, w=50, h=50
    recordPosition('k', makeRect(200, 100, 50, 50))
    // 目标：left=250, top=150, w=100, h=100
    const target = { top: 150, left: 250, width: 100, height: 100 }
    const r = getInitial('k', target)
    expect(r.x).toBe(-50)   // 200 - 250
    expect(r.y).toBe(-50)   // 100 - 150
    expect(r.scaleX).toBe(0.5)
    expect(r.scaleY).toBe(0.5)
  })

  it('FL-3 5 秒过期', () => {
    const { recordPosition, getInitial, clear } = useFLIP()
    recordPosition('expire', makeRect(0, 0, 10, 10))
    const originalNow = Date.now
    Date.now = () => originalNow() + 6000
    const r = getInitial('expire', { top: 0, left: 0, width: 10, height: 10 })
    expect(r).toBeNull()
    Date.now = originalNow
    clear('expire')
  })

  it('FL-4 clear 删除记录', () => {
    const { recordPosition, getInitial, clear } = useFLIP()
    recordPosition('k2', makeRect(0, 0, 10, 10))
    clear('k2')
    const r = getInitial('k2', { top: 0, left: 0, width: 10, height: 10 })
    expect(r).toBeNull()
  })
})

