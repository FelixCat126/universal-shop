/**
 * 图片变体工具测试（portal/utils/imageVariants.js）
 *
 * 后端上传时会派生 _thumb.webp / _mid.webp，前端据此拼 srcset ——
 * 命名规则两处必须一致，错一个就是"浏览器下不到缩略图 → 图裂"。
 *
 *   IV-1 上传目录的图片 → 推出 thumb/mid 变体 URL
 *   IV-2 非上传目录 / 外链 → 不给变体（undefined）
 *   IV-3 srcset 三档宽度正确
 *   IV-4 首屏前几张 eager + fetchpriority=high，其余 lazy
 *   IV-5 非图片扩展名不给变体
 */
import { describe, it, expect } from 'vitest'
import {
  imageVariants,
  imageSrcSet,
  imageLoadingFor
} from '@portal/utils/imageVariants.js'

describe('VC.utils.imageVariants', () => {
  it('IV-1 上传目录的图片 → 推出 thumb/mid 变体 URL', () => {
    const v = imageVariants('/uploads/products/product_123.jpg')
    expect(v.main).toBe('/uploads/products/product_123.jpg')
    expect(v.thumb).toBe('/uploads/products/product_123_thumb.webp')
    expect(v.mid).toBe('/uploads/products/product_123_mid.webp')
  })

  it('IV-2 非上传目录 / 外链 → 不给变体', () => {
    expect(imageVariants('https://cdn.example.com/a.jpg').thumb).toBeNull()
    expect(imageVariants('/static/logo.png').thumb).toBeNull()
    expect(imageVariants('').thumb).toBeNull()
    expect(imageVariants(null).thumb).toBeNull()
    expect(imageSrcSet('https://cdn.example.com/a.jpg')).toBeUndefined()
  })

  it('IV-3 srcset 三档宽度正确', () => {
    const ss = imageSrcSet('/uploads/products/product_123.jpg')
    expect(ss).toContain('/uploads/products/product_123_thumb.webp 400w')
    expect(ss).toContain('/uploads/products/product_123_mid.webp 800w')
    expect(ss).toContain('/uploads/products/product_123.jpg 1600w')
  })

  it('IV-4 首屏前几张 eager + fetchpriority=high，其余 lazy', () => {
    expect(imageLoadingFor(0)).toEqual({ loading: 'eager', fetchpriority: 'high' })
    expect(imageLoadingFor(3)).toEqual({ loading: 'eager', fetchpriority: 'high' })
    expect(imageLoadingFor(4)).toEqual({ loading: 'lazy', fetchpriority: 'auto' })
  })

  it('IV-5 非图片扩展名不给变体', () => {
    expect(imageVariants('/uploads/system/banner.pdf').thumb).toBeNull()
    expect(imageVariants('/uploads/products/x.svg').thumb).toBeNull()
  })

  it('IV-6 大写扩展名也能推出变体', () => {
    const v = imageVariants('/uploads/products/ABC.JPG')
    expect(v.thumb).toBe('/uploads/products/ABC_thumb.webp')
  })
})
