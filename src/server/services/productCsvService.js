/**
 * 商品 CSV 导入 / 导出服务
 *
 * 为什么要有：运营录商品是一个一个填的。20 个商品就是 20 次表单、
 * 20 次保存、20 次图片上传 —— 而且**改价**更痛：改 20 个商品的价格
 * 要点 20 次，改漏一个就是亏本。
 *
 * CSV 是运营已经在用的语言（从 Excel 另存为 CSV），
 * 所以这里做的是把 Excel → 商城的闭环：
 *   导出 CSV（带 id）→ 在 Excel 里改 → 导回来（有 id 就更新，没 id 就新建）
 *
 * 设计上的两个关键决定：
 *
 * 1) **先预览再落库**（dry_run）。一次导入几百行，里面有一行金额写错，
 *    整批导入就会写进去一半错数据。预览把"哪些行有问题、什么问题"摊开给运营看，
 *    确认后才落库 —— 而不是导完再去数据库里一条条找。
 *
 * 2) **逐行报告，不是一句"成功/失败"**。导入 300 行、其中 7 行有问题，
 *    运营需要知道**是哪 7 行、为什么** —— 否则只能回去对着 Excel 一个个找。
 *
 * 解析用 ExcelJS（已在依赖里，且是项目里导出 xlsx 用的同一个库）：
 * 引号里的逗号/换行、BOM、CRLF 都由它处理 —— 这些手写解析器最容易出错。
 */
import Product from '../models/Product.js'
import ProductCategory from '../models/ProductCategory.js'
import { sanitizeCell } from '../utils/sanitizeCell.js'
import { Op } from 'sequelize'
import { parseCsvTable, normalizeCsvHeaders } from '../utils/csvTable.js'
import { resolveSafeUrl } from '../utils/remoteImageFetcher.js'
import { downloadAndStoreImage } from './remoteImageService.js'

/** 一次导入最多多少行 —— 防止一个误传的几 MB 文件把服务拖垮 */
export const MAX_IMPORT_ROWS = 500

/** 文件大小上限（字节）：CSV 文本，5MB 足够十万行 */
export const MAX_CSV_BYTES = 5 * 1024 * 1024

/**
 * CSV 的列定义（表头顺序即导出顺序）。
 * id 放第一位：导出的 CSV 第一列就是 id，运营在 Excel 里改完导回来能直接对上。
 */
export const CSV_COLUMNS = [
  'id',
  'name',
  'name_th',
  'category',
  'price',
  'stock',
  'points',
  'description',
  'image'
]

/** 必填列 */
const REQUIRED_COLUMNS = ['name', 'price']

/** 表头别名：运营手搓的 CSV 表头五花八门，认几个常见的 */
const HEADER_ALIASES = {
  id: ['id', '商品id', '商品ID', '编号'],
  name: ['name', '名称', '商品名', '商品名称', '品名'],
  name_th: ['name_th', 'nameth', '泰文名', '泰语名称', 'thai name'],
  category: ['category', '分类', '类别', '商品分类'],
  // '售价THB' —— 异步导出任务用的就是这个表头，之前别名表里没有 →
  // 运营把导出的文件改一改再导回，会报「CSV 缺少必填列：price」
  price: ['price', '价格', '售价', '单价', '售价THB', '售价(THB)', '售价（THB）'],
  stock: ['stock', '库存', '数量'],
  points: ['points', '积分', '抵扣积分'],
  description: ['description', '描述', '说明', '简介'],
  image: ['image', '图片', '图片url', 'image url', '图片地址']
}

/** 上限（与 createProduct 的校验保持一致） */
const MAX_PRICE = 99999999
const MAX_STOCK = 100000000
const MAX_POINTS = 1000000

/**
 * 表头归一（复用通用实现）。
 * @see utils/csvTable.js normalizeCsvHeaders
 */
export function normalizeHeaders (entries) {
  return normalizeCsvHeaders(entries, HEADER_ALIASES)
}

/**
 * 解析商品 CSV 文本 → 行数组（不含表头）。
 *
 * 解析本身走通用实现（utils/csvTable.js）—— 商品与合作方共用同一套，
 * 各写一遍必然漂移（表头别名、ExcelJS 的坑、引号处理）。
 *
 * @param {Buffer} buffer
 * @returns {Promise<{headers: string[], rows: Array<{rowNumber: number, cells: Record<string, any>}>}>}
 */
export async function parseProductCsv (buffer) {
  return parseCsvTable(buffer, {
    aliases: HEADER_ALIASES,
    required: REQUIRED_COLUMNS,
    maxRows: MAX_IMPORT_ROWS,
    maxBytes: MAX_CSV_BYTES
  })
}

/**
 * 校验一行 → { values, errors }
 * @param {object} cells
 * @param {Map<string, object>} categoryMap 分类名（小写）→ 分类
 */
export function validateRow (cells, categoryMap) {
  const errors = []
  const values = {}

  // id：有则更新，无则新建
  const rawId = cells.id
  let id = null
  if (rawId !== null && rawId !== undefined && String(rawId).trim() !== '') {
    const n = Number(String(rawId).trim())
    if (!Number.isInteger(n) || n < 1) {
      errors.push('id 必须是正整数')
    } else {
      id = n
    }
  }
  values.id = id

  // name
  const name = cells.name === null || cells.name === undefined ? '' : String(cells.name).trim()
  if (!name) errors.push('商品名称不能为空')
  if (name.length > 200) errors.push('商品名称过长（上限 200 字）')
  values.name = name

  values.name_th = cells.name_th == null ? '' : String(cells.name_th).trim().slice(0, 200)
  values.description = cells.description == null ? '' : String(cells.description).trim().slice(0, 2000)
  const rawImage = cells.image == null ? '' : String(cells.image).trim().slice(0, 500)
  values.image = rawImage
  values.image_is_remote = /^https?:\/\//i.test(rawImage)

  // category
  const catName = cells.category == null ? '' : String(cells.category).trim()
  values.category_name = catName
  let category = null
  if (catName) {
    category = categoryMap.get(catName.toLowerCase()) || null
    if (!category) errors.push(`分类「${catName}」不存在`)
  }
  values.category_id = category ? category.id : null

  // price
  const rawPrice = cells.price
  const price = (rawPrice === null || rawPrice === undefined || rawPrice === '') ? NaN : Number(rawPrice)
  if (!Number.isFinite(price)) {
    errors.push('价格必须是数字')
  } else if (price < 0 || price > MAX_PRICE) {
    errors.push(`价格必须为 0-${MAX_PRICE} 之间的数字`)
  } else {
    values.price = Math.round(price * 100) / 100
  }

  // stock（缺省 0）
  const rawStock = cells.stock
  const stock = (rawStock === null || rawStock === undefined || rawStock === '') ? 0 : Number(rawStock)
  if (!Number.isInteger(stock) || stock < 0 || stock > MAX_STOCK) {
    errors.push(`库存必须为 0-${MAX_STOCK} 的整数`)
  } else {
    values.stock = stock
  }

  // points（缺省 0）
  const rawPoints = cells.points
  const points = (rawPoints === null || rawPoints === undefined || rawPoints === '') ? 0 : Number(rawPoints)
  if (!Number.isInteger(points) || points < 0 || points > MAX_POINTS) {
    errors.push(`积分必须为 0-${MAX_POINTS} 的整数`)
  } else {
    values.points = points
  }

  return { values, errors }
}

/**
 * 载入分类映射（分类名 → 分类）
 */
export async function loadCategoryMap () {
  const categories = await ProductCategory.findAll({ attributes: ['id', 'name'] })
  const map = new Map()
  for (const c of categories) map.set(String(c.name).trim().toLowerCase(), c)
  return map
}

/**
 * 预览：只校验不落库。
 * @param {Buffer} buffer
 * @returns {Promise<object>} 预览报告
 */
export async function previewProductCsv (buffer) {
  const { headers, unknownHeaders, rows } = await parseProductCsv(buffer)
  const categoryMap = await loadCategoryMap()

  const valid = []
  const invalid = []
  const seenIds = new Map()

  for (const row of rows) {
    const { values, errors } = validateRow(row.cells, categoryMap)

    // SSRF pre-check for remote images: resolve + IP judgement only, no download.
    // Doing it in preview keeps the DB untouched before we reject an unsafe URL.
    if (values.image_is_remote) {
      try {
        await resolveSafeUrl(values.image)
      } catch (e) {
        errors.push(`image URL unusable: ${e.message}`)
      }
    }
    // 同一个 id 在文件里出现多次 → 后面的判为错误（否则后者会覆盖前者，静默丢数据）
    if (values.id != null) {
      if (seenIds.has(values.id)) {
        errors.push(`id ${values.id} 在文件里重复出现（第 ${seenIds.get(values.id)} 行已用过）`)
      } else {
        seenIds.set(values.id, row.rowNumber)
      }
    }
    const item = {
      rowNumber: row.rowNumber,
      name: values.name,
      id: values.id,
      category_name: values.category_name,
      price: values.price,
      stock: values.stock,
      errors
    }
    if (errors.length === 0) valid.push({ ...item, values })
    else invalid.push(item)
  }

  // 有 id 的行还要确认该商品确实存在（否则是"更新一个不存在的商品"）
  const ids = valid.map(v => v.values.id).filter(v => v != null)
  let existingIds = new Set()
  if (ids.length > 0) {
    const existing = await Product.findAll({ where: { id: ids }, attributes: ['id'] })
    existingIds = new Set(existing.map(p => p.id))
  }
  const finalValid = []
  for (const v of valid) {
    const id = v.values.id
    if (id != null && !existingIds.has(id)) {
      invalid.push({
        rowNumber: v.rowNumber,
        name: v.name,
        id,
        category_name: v.category_name,
        price: v.price,
        stock: v.stock,
        errors: [`id ${id} 对应的商品不存在（要新建请清空 id 列）`]
      })
    } else {
      finalValid.push({ ...v, action: id != null ? 'update' : 'create' })
    }
  }

  return {
    totalRows: rows.length,
    validCount: finalValid.length,
    invalidCount: invalid.length,
    createCount: finalValid.filter(v => v.action === 'create').length,
    updateCount: finalValid.filter(v => v.action === 'update').length,
    headers: headers.filter(Boolean),
    unknownHeaders,
    invalid,
    valid: finalValid.map(v => ({
      rowNumber: v.rowNumber,
      action: v.action,
      name: v.values.name,
      id: v.values.id,
      category_name: v.values.category_name,
      price: v.values.price,
      stock: v.values.stock,
      points: v.values.points
    }))
  }
}

/**
 * 真正导入。
 *
 * 逐行独立处理：某一行失败（并发改动、DB 报错）不影响其它行，
 * 失败原因逐行回报 —— 与预览的报告口径一致。
 */
export async function importProductCsv (buffer, options = {}) {
  const mode = normalizeImportMode(options.mode)
  const preview = await previewProductCsv(buffer)
  if (preview.invalidCount > 0 && mode === 'strict') {
    // 有问题的行 → 整批不落库。
    // 半截导入比不导入更糟：运营会以为全导进去了。
    throw Object.assign(
      new Error(`有 ${preview.invalidCount} 行存在问题，未导入任何数据。请修正后重试`),
      { status: 400, preview }
    )
  }
  if (preview.validCount === 0) {
    throw Object.assign(new Error('没有可导入的数据行'), { status: 400, preview })
  }

  // 重新解析一次拿到完整 values（预览里为了精简只留了摘要）
  const { rows, columns } = await parseProductCsv(buffer)
  const categoryMap = await loadCategoryMap()

  /**
   * 文件里**实际出现过**的列 —— 更新时只写这些列。
   *
   * 之前更新分支无条件写全部业务列，而"列缺失"和"列存在但为空"在校验阶段
   * 都退化成同一个缺省值 → 运营把 CSV 里的 stock 列删掉再导回，
   * **所有商品库存被写成 0**；合作方的停用状态、折扣也会被缺省值抹掉。
   * 运营没打算改的列，就不该被覆盖。
   */
  const present = new Set(columns)

  /**
   * 预览判定为"有问题"的行号 —— skip 模式下**必须真的跳过**。
   *
   * 之前预览把"同一个 id 在文件里出现多次"的行标成 invalid 并报告为"跳过"，
   * 但落库循环只跑行级校验、照旧执行 update → **后者把前者静默覆盖了**，
   * 报告却说"已跳过"。同一批行既被说成跳过、又被写进库。
   */
  const invalidRows = new Set(preview.invalid.map(r => r.rowNumber))

  const created = []
  const updated = []
  const failed = []

  for (const row of rows) {
    if (invalidRows.has(row.rowNumber)) {
      // 已经在 preview.invalid 里报告过（skipped），不再重复计入 failed
      continue
    }
    const { values, errors } = validateRow(row.cells, categoryMap)
    if (errors.length > 0) {
      failed.push({ rowNumber: row.rowNumber, name: values.name, reason: errors.join('；') })
      continue
    }
    try {
      // Remote image: download + store locally, then use the local path.
      // A failed download fails THIS row only (with the reason reported) --
      // other rows still import.
      let imageValue = values.image || null
      // 只在文件里真的有 image 列时才去下载远程图 ——
      // 否则每次更新都会白跑一次网络请求（还可能失败把整行拖成 failed）
      if (present.has('image') && values.image_is_remote) {
        try {
          const stored = await downloadAndStoreImage(values.image)
          imageValue = stored.url
        } catch (e) {
          failed.push({ rowNumber: row.rowNumber, name: values.name, reason: `image download failed: ${e.message}` })
          continue
        }
      }

      if (values.id != null) {
        /**
         * 只写 CSV 里**出现过**的列 —— 缺省值不能当成"运营要清空这一列"。
         * （name/price 是必填列，一定在文件里；其余列按文件实际内容决定。）
         */
        const patch = {}
        if (present.has('name')) patch.name = values.name
        if (present.has('name_th')) patch.name_th = values.name_th || null
        if (present.has('description')) patch.description = values.description || null
        if (present.has('category')) patch.category_id = values.category_id
        if (present.has('price')) patch.price = values.price
        if (present.has('stock')) patch.stock = values.stock
        if (present.has('points')) patch.points = values.points
        if (present.has('image')) patch.image = imageValue

        const [affected] = await Product.update(
          patch,
          { where: { id: values.id } }
        )
        if (!affected) {
          failed.push({ rowNumber: row.rowNumber, name: values.name, reason: `id ${values.id} 的商品不存在` })
        } else {
          updated.push({ rowNumber: row.rowNumber, id: values.id, name: values.name })
        }
      } else {
        const product = await Product.create({
          name: values.name,
          name_th: values.name_th || null,
          description: values.description || null,
          category_id: values.category_id,
          price: values.price,
          stock: values.stock,
          points: values.points,
          image: imageValue,
          status: 'active'
        })
        created.push({ rowNumber: row.rowNumber, id: product.id, name: values.name })
      }
    } catch (e) {
      failed.push({ rowNumber: row.rowNumber, name: values.name, reason: e.message })
    }
  }

  const skipped = mode === 'skip' ? preview.invalid : []
  return {
    mode,
    createdCount: created.length,
    updatedCount: updated.length,
    failedCount: failed.length + skipped.length,
    created,
    updated,
    failed,
    // skip 模式下"有问题被跳过"的行（strict 模式下这里恒为空）
    skipped
  }
}

/**
 * 每批取多少行。
 *
 * 用 keyset（id > 游标）而不是 OFFSET：OFFSET 到第 N 页要**扫描并丢弃**前 N 行，
 * 导出到最后一页时总扫描量是 O(n²/2)；keyset 每批都是"接着上次继续"。
 */
const CSV_BATCH_SIZE = 500

/**
 * 把一行商品转成 CSV 行。
 */
function productCsvLine (p) {
  const raw = p.toJSON()
  return CSV_COLUMNS.map(col => {
    switch (col) {
      case 'id': return String(raw.id ?? '')
      case 'name': return csvEscape(raw.name)
      case 'name_th': return csvEscape(raw.name_th)
      case 'category': return csvEscape(raw.productCategory?.name)
      case 'price': return raw.price == null ? '' : String(raw.price)
      case 'stock': return raw.stock == null ? '' : String(raw.stock)
      case 'points': return raw.points == null ? '' : String(raw.points)
      case 'description': return csvEscape(raw.description)
      case 'image': return csvEscape(raw.image)
      default: return ''
    }
  }).join(',')
}

/**
 * 导出当前商品为 CSV 文本（一次性拼成整串）。
 *
 * @returns {Promise<string>} CSV 文本（含 BOM —— Excel 打开中文不乱码）
 *
 * ⚠️ 大数据量请用 `streamProductsCsv()`：这个函数会把全部行**一次性装进内存**，
 *    导出几万件商品时会顶出内存尖峰。它保留是因为测试与少数内部调用要用整串。
 */
export async function exportProductsCsv () {
  const chunks = []
  for await (const chunk of streamProductsCsv()) {
    chunks.push(chunk)
  }
  return chunks.join('')
}

/**
 * 流式导出商品 CSV（第 57 轮）。
 *
 * 为什么要流式：之前是"全表 findAll → 拼成一个巨型字符串 → 一次性返回"，
 * 内存占用与商品数×描述长度成正比，几万件商品就能把 Node 进程顶到几百 MB。
 * 现在按批取、按批吐，内存占用与**单批**成正比，与总量无关。
 *
 * 顺带把 OFFSET 翻页改成 keyset（id > 游标）：
 * OFFSET 到最后一页要扫描并丢弃前面所有行，总扫描量 O(n²/2)。
 *
 * @param {object} [opts]
 * @param {number} [opts.batchSize]
 * @param {Function} [opts.shouldStop] 返回 true = 客户端已断开，停止导出
 */
export async function * streamProductsCsv ({ batchSize = CSV_BATCH_SIZE, shouldStop } = {}) {
  // BOM：Excel 打开 UTF-8 CSV 不加 BOM 会把中文认成乱码
  yield '﻿' + CSV_COLUMNS.join(',') + '\r\n'

  let cursor = null
  for (;;) {
    if (shouldStop && shouldStop()) return

    const products = await Product.findAll({
      where: cursor ? { id: { [Op.gt]: cursor } } : {},
      include: [{ model: ProductCategory, as: 'productCategory', attributes: ['id', 'name'], required: false }],
      order: [['id', 'ASC']],
      limit: batchSize
    })
    if (!products.length) return

    const lines = products.map(productCsvLine)
    yield lines.join('\r\n') + '\r\n'

    cursor = products[products.length - 1].id
    if (products.length < batchSize) return
  }
}

/**
 * CSV 字段转义：含逗号/引号/换行时用引号包起来，内部引号翻倍。
 * 同时做公式注入防护（= + @ | 开头会被 Excel 当公式执行）。
 */
export function csvEscape (value) {
  if (value === null || value === undefined) return ''
  let s = String(value)
  // 公式注入：导出给 Excel 打开时，=cmd 之类会被当公式执行
  s = sanitizeCell(s)
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/**
 * 导入模式：
 *   strict（默认）—— 有任何一行有问题就**整批不落库**。
 *     半截导入比不导入更糟：运营会以为全导进去了。
 *   skip —— 跳过有问题的行，导入其余的，问题行逐条回报。
 *     适合"500 行的表里只有 3 行写错了"：不用为了 3 行去改 500 行。
 */
export const IMPORT_MODES = ['strict', 'skip']

/** 归一导入模式（非法值回落 strict —— 严格是更安全的默认） */
export function normalizeImportMode (mode) {
  const m = String(mode || 'strict').toLowerCase()
  return IMPORT_MODES.includes(m) ? m : 'strict'
}
