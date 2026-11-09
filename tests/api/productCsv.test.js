/**
 * 商品 CSV 导入 / 导出 测试
 *
 * 这条链路是"运营录商品"的主路径，也是最容易出静默错误的地方：
 * 少导了几行、金额写错了一位、分类名对不上 —— 这些都不会报错，
 * 只会在货架上表现为"商品不见了"或"价格不对"。
 *
 *   PC-1 表头归一：中文表头也能认（运营手搓的 CSV）
 *   PC-2 缺必填列 → 报错并说清缺哪列
 *   PC-3 引号里的逗号/换行不拆列
 *   PC-4 空行跳过
 *   PC-5 行数上限
 *   PC-6 逐行校验：价格/库存/积分/分类
 *   PC-7 预览**不落库**（dry_run）
 *   PC-8 有 id → 更新；无 id → 新建
 *   PC-9 id 不存在 → 判为错误（不是静默新建）
 *   PC-10 同一 id 在文件里重复 → 后面的判错
 *   PC-11 有问题的行 → 整批不落库
 *   PC-12 导出 CSV 含 id，可原样导回（往返一致）
 *   PC-13 导出做公式注入防护
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'
import {
  parseProductCsv,
  previewProductCsv,
  importProductCsv,
  exportProductsCsv,
  normalizeHeaders,
  csvEscape,
  MAX_IMPORT_ROWS
} from '@server/services/productCsvService.js'

const csv = (s) => Buffer.from('﻿' + s, 'utf8')

let category

beforeEach(async () => {
  await TestDatabase.clearAllData()
  const { ProductCategory } = TestDatabase.getSequelize().models
  category = await ProductCategory.create({ name: '测试分类' })
})

describe('CSV 表头与解析', () => {
  it('PC-1 表头归一：中文表头也能认', () => {
    // map 的值是 { col, header }：col 是**列号**（ExcelJS 的 getCell 不能用表头字符串取值）
    const { map } = normalizeHeaders([
      { col: 1, header: '商品ID' },
      { col: 2, header: '商品名称' },
      { col: 3, header: '价格' },
      { col: 4, header: '库存' },
      { col: 5, header: '分类' }
    ])
    expect(map.name.header).toBe('商品名称')
    expect(map.name.col).toBe(2)
    expect(map.price.header).toBe('价格')
    expect(map.stock.header).toBe('库存')
    expect(map.category.header).toBe('分类')
  })

  it('PC-2 缺必填列 → 报错并说清缺哪列', async () => {
    await expect(parseProductCsv(csv('name,stock\nA,1'))).rejects.toThrow(/price/)
  })

  it('PC-3 引号里的逗号/换行不拆列', async () => {
    const { rows } = await parseProductCsv(csv('name,price,description\n"奶茶, 冰",12.5,"第一行\n第二行"'))
    expect(rows).toHaveLength(1)
    expect(rows[0].cells.name).toBe('奶茶, 冰')
    expect(rows[0].cells.description).toBe('第一行\n第二行')
  })

  it('PC-4 空行跳过', async () => {
    const { rows } = await parseProductCsv(csv('name,price\nA,1\n\n,,\nB,2'))
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.cells.name)).toEqual(['A', 'B'])
  })

  it('PC-5 超过行数上限 → 报错', async () => {
    const many = ['name,price']
    for (let i = 0; i <= MAX_IMPORT_ROWS; i++) many.push(`P${i},1`)
    await expect(parseProductCsv(csv(many.join('\n')))).rejects.toThrow(new RegExp(String(MAX_IMPORT_ROWS)))
  })
})

describe('CSV 逐行校验', () => {
  it('PC-6 价格/库存/积分/分类逐项校验', async () => {
    const preview = await previewProductCsv(csv([
      'name,price,stock,points,category',
      '好商品,10,5,0,测试分类', // 全对
      '缺价格,,5,0,测试分类', // 价格缺失
      '负库存,10,-1,0,测试分类', // 库存为负
      '小数积分,10,5,1.5,测试分类', // 积分不是整数
      '分类不存在,10,5,0,没有这个分类' // 分类找不到
    ].join('\n')))

    expect(preview.totalRows).toBe(5)
    expect(preview.validCount).toBe(1)
    expect(preview.invalidCount).toBe(4)

    const errors = preview.invalid.map(r => r.errors.join('|'))
    expect(errors.some(e => e.includes('价格'))).toBe(true)
    expect(errors.some(e => e.includes('库存'))).toBe(true)
    expect(errors.some(e => e.includes('积分'))).toBe(true)
    expect(errors.some(e => e.includes('分类'))).toBe(true)
  })
})

describe('CSV 预览与导入', () => {
  it('PC-7 预览不落库', async () => {
    const { Product } = TestDatabase.getSequelize().models
    const before = await Product.count()
    const preview = await previewProductCsv(csv('name,price,category\n新商品,10,测试分类'))
    expect(preview.validCount).toBe(1)
    expect(preview.createCount).toBe(1)
    expect(await Product.count()).toBe(before)
  })

  it('PC-8 有 id → 更新；无 id → 新建', async () => {
    const { Product } = TestDatabase.getSequelize().models
    const existing = await Product.create(TestDataFactory.createProduct({
      name: '旧名字', price: 5, category_id: category.id, stock: 1
    }))

    // ⚠️ 新建那行**必须以逗号开头**（空的 id 列）：
    // CSV 是按位置对应列的，少写一列会让后面的值整体左移
    // （'全新商品' 会落进 id 列 → "id 必须是正整数"）
    const result = await importProductCsv(csv([
      'id,name,price,stock,category',
      `${existing.id},新名字,99,7,测试分类`,
      ',全新商品,20,3,测试分类'
    ].join('\n')))

    expect(result.createdCount).toBe(1)
    expect(result.updatedCount).toBe(1)
    expect(result.failedCount).toBe(0)

    const fresh = await Product.findByPk(existing.id)
    expect(fresh.name).toBe('新名字')
    expect(Number(fresh.price)).toBe(99)
    expect(fresh.stock).toBe(7)
    expect(await Product.count()).toBe(2)
  })

  it('PC-9 id 不存在 → 判为错误（不是静默新建）', async () => {
    const preview = await previewProductCsv(csv('id,name,price,category\n999999,幽灵商品,10,测试分类'))
    expect(preview.validCount).toBe(0)
    expect(preview.invalidCount).toBe(1)
    expect(preview.invalid[0].errors.join('')).toMatch(/不存在/)
  })

  it('PC-10 同一 id 在文件里重复 → 后面的判错', async () => {
    const { Product } = TestDatabase.getSequelize().models
    const existing = await Product.create(TestDataFactory.createProduct({
      name: 'X', price: 5, category_id: category.id
    }))
    const preview = await previewProductCsv(csv([
      'id,name,price,category',
      `${existing.id},A,10,测试分类`,
      `${existing.id},B,10,测试分类`
    ].join('\n')))
    expect(preview.invalidCount).toBe(1)
    expect(preview.invalid[0].errors.join('')).toMatch(/重复/)
  })

  it('PC-11 有问题的行 → 整批不落库', async () => {
    const { Product } = TestDatabase.getSequelize().models
    const before = await Product.count()
    await expect(importProductCsv(csv([
      'name,price,category',
      '好商品,10,测试分类',
      '坏商品,abc,测试分类'
    ].join('\n')))).rejects.toThrow(/存在问题/)
    expect(await Product.count()).toBe(before)
  })
})

describe('CSV 导出', () => {
  it('PC-12 导出含 id，可原样导回（往返一致）', async () => {
    const { Product } = TestDatabase.getSequelize().models
    const p = await Product.create(TestDataFactory.createProduct({
      name: '往返商品', name_th: 'รอบตัว', price: 42.5, stock: 9,
      category_id: category.id, points: 3
    }))

    const text = await exportProductsCsv()
    expect(text).toContain('id,name,name_th,category,price,stock,points,description,image')
    expect(text).toContain('往返商品')
    expect(text).toContain('รอบตัว')

    // 原样导回去 → 变成"更新"，且不改任何字段
    const result = await importProductCsv(Buffer.from(text, 'utf8'))
    expect(result.updatedCount).toBe(1)
    expect(result.createdCount).toBe(0)

    const fresh = await Product.findByPk(p.id)
    expect(fresh.name).toBe('往返商品')
    expect(Number(fresh.price)).toBe(42.5)
    expect(fresh.stock).toBe(9)
    expect(fresh.points).toBe(3)
  })

  it('PC-13 导出做公式注入防护', () => {
    // =cmd|... 会被 Excel 当公式执行 → 导出时要加前缀挡掉
    expect(csvEscape('=1+1')).toBe("'=1+1")
    expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)")
    // 普通文本不受影响
    expect(csvEscape('正常商品')).toBe('正常商品')
    // 含逗号要加引号
    expect(csvEscape('奶茶, 冰')).toBe('"奶茶, 冰"')
    // 含引号要翻倍
    expect(csvEscape('说"你好"')).toBe('"说""你好"""')
  })
})
