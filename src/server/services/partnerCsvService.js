/**
 * 合作方（批发客户）CSV 导入 / 导出
 *
 * 为什么需要：合作方开户是**成批**的 —— 一家经销商一次给十几条门店/联系人信息，
 * 运营一个一个在后台填，既慢又容易填错（折扣、账号类型、登录名）。
 *
 * 与商品 CSV 导入同一套设计：
 *   - **先预览再落库**（dry_run 默认开），逐行报告问题
 *   - 有问题的行整批不落库（半截导入比不导入更糟）
 *   - 带 id 的行 = 更新，不带 id 的行 = 新建
 *
 * 一个安全上的取舍：**密码不参与导入**。
 * 合作方的初始密码让运营在 CSV 里写明文 → 密码会躺在邮件/Excel/聊天记录里。
 * 改成：导入时生成**随机初始密码**并在预览里明确告知（且只显示一次），
 * 运营拿到后线下告知对方；对方首次登录后可自行修改。
 */
import Partner from '../models/Partner.js'
import { parseCsvTable } from '../utils/csvTable.js'
import { csvCell } from '../utils/csvExporter.js'
import crypto from 'node:crypto'

/** 一次最多导入多少行 */
export const MAX_IMPORT_ROWS = 500
/** 文件大小上限 */
export const MAX_CSV_BYTES = 5 * 1024 * 1024

/** 账号类别 */
const ACCOUNT_KINDS = ['dealer', 'agent']

/** CSV 列定义（表头顺序即导出顺序） */
export const CSV_COLUMNS = [
  'id',
  'login',
  'display_name',
  'account_kind',
  'discount_percent',
  'is_active'
]

/** 必填列 */
const REQUIRED_COLUMNS = ['login']

/** 表头别名 */
const HEADER_ALIASES = {
  id: ['id', '合作方id', '编号'],
  login: ['login', '登录名', '登录账号', '账号', '用户名'],
  display_name: ['display_name', 'displayname', '名称', '商家名称', '客户名称'],
  account_kind: ['account_kind', 'accountkind', '账号类别', '类型', '客户类型'],
  discount_percent: ['discount_percent', 'discountpercent', '折扣', '折扣百分比'],
  is_active: ['is_active', 'isactive', '启用', '状态', '是否启用']
}

/**
 * 解析合作方 CSV
 * @param {Buffer} buffer
 */
export async function parsePartnerCsv (buffer) {
  return parseCsvTable(buffer, {
    aliases: HEADER_ALIASES,
    required: REQUIRED_COLUMNS,
    maxRows: MAX_IMPORT_ROWS,
    maxBytes: MAX_CSV_BYTES
  })
}

/** 生成随机初始密码（运营线下告知对方；不写在 CSV 里） */
function generateInitialPassword () {
  // 12 位，大小写 + 数字 + 特殊字符；去掉容易看错的字符（0/O/1/l/I）
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const special = '!@#$%&*'
  const all = upper + lower + digits + special
  const pick = (set) => set[crypto.randomInt(set.length)]
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)]
  while (chars.length < 12) chars.push(pick(all))
  // Fisher-Yates 洗牌（避免"首位必是大写"这种可猜模式）
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

/**
 * 校验一行
 * @returns {{values: object, errors: string[]}}
 */
export function validatePartnerRow (cells, existingLogins) {
  const errors = []
  const values = {}

  // id
  const rawId = cells.id
  let id = null
  if (rawId !== null && rawId !== undefined && String(rawId).trim() !== '') {
    const n = Number(String(rawId).trim())
    if (!Number.isInteger(n) || n < 1) errors.push('id 必须是正整数')
    else id = n
  }
  values.id = id

  // login
  const login = cells.login == null ? '' : String(cells.login).trim()
  if (!login) {
    errors.push('登录名不能为空')
  } else if (login.length > 100) {
    errors.push('登录名过长（上限 100 字符）')
  } else if (!/^[A-Za-z0-9._-]+$/.test(login)) {
    errors.push('登录名只能含字母、数字、点、下划线和连字符')
  }
  values.login = login

  const displayName = cells.display_name == null ? '' : String(cells.display_name).trim()
  if (displayName.length > 100) errors.push('商家名称过长（上限 100 字符）')
  values.display_name = displayName || null

  // account_kind
  const rawKind = cells.account_kind == null ? '' : String(cells.account_kind).trim().toLowerCase()
  let accountKind = 'dealer'
  if (rawKind) {
    if (!ACCOUNT_KINDS.includes(rawKind)) {
      errors.push(`账号类别只能是 ${ACCOUNT_KINDS.join(' / ')}`)
    } else {
      accountKind = rawKind
    }
  }
  values.account_kind = accountKind

  // discount_percent：0-100 的数字
  const rawDiscount = cells.discount_percent
  const discount = (rawDiscount === null || rawDiscount === undefined || rawDiscount === '') ? 0 : Number(rawDiscount)
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
    errors.push('折扣必须是 0-100 之间的数字')
  } else {
    values.discount_percent = Math.round(discount * 100) / 100
  }

  // is_active：默认启用
  const rawActive = cells.is_active
  let isActive = true
  if (rawActive !== null && rawActive !== undefined && String(rawActive).trim() !== '') {
    const v = String(rawActive).trim().toLowerCase()
    if (['1', 'true', 'yes', 'y', '是', '启用'].includes(v)) isActive = true
    else if (['0', 'false', 'no', 'n', '否', '停用'].includes(v)) isActive = false
    else errors.push(`启用状态无法识别：${rawActive}`)
  }
  values.is_active = isActive

  return { values, errors }
}

/**
 * 预览：只校验不落库
 */
export async function previewPartnerCsv (buffer) {
  const { headers, unknownHeaders, rows } = await parsePartnerCsv(buffer)

  // 已存在的登录名（新建时重名要报错；更新时按 id 判定）
  const existing = await Partner.findAll({ attributes: ['id', 'login'] })
  const loginMap = new Map(existing.map(p => [String(p.login).toLowerCase(), p.id]))
  const existingIds = new Set(existing.map(p => p.id))

  const valid = []
  const invalid = []
  const seenLogins = new Map()
  const seenIds = new Map()

  for (const row of rows) {
    const { values, errors } = validatePartnerRow(row.cells, loginMap)

    // 同一个登录名在文件里出现多次 → 后面的判错（否则后者会覆盖前者，静默丢数据）
    if (values.login) {
      const key = values.login.toLowerCase()
      if (seenLogins.has(key)) {
        errors.push(`登录名「${values.login}」在文件里重复出现（第 ${seenLogins.get(key)} 行已用过）`)
      } else {
        seenLogins.set(key, row.rowNumber)
      }
    }
    // 同一个 id 重复 → 后面的判错
    if (values.id != null) {
      if (seenIds.has(values.id)) {
        errors.push(`id ${values.id} 在文件里重复出现（第 ${seenIds.get(values.id)} 行已用过）`)
      } else {
        seenIds.set(values.id, row.rowNumber)
      }
    }

    // 新建时登录名不能撞已有账号
    if (values.id == null && values.login && loginMap.has(values.login.toLowerCase())) {
      errors.push(`登录名「${values.login}」已被占用`)
    }

    const item = {
      rowNumber: row.rowNumber,
      login: values.login,
      display_name: values.display_name,
      id: values.id,
      errors
    }
    if (errors.length === 0) {
      valid.push({
        ...item,
        action: values.id != null ? 'update' : 'create',
        values
      })
    } else {
      invalid.push(item)
    }
  }

  // 有 id 的行还要确认该合作方确实存在
  const ids = valid.map(v => v.values.id).filter(v => v != null)
  const finalValid = []
  for (const v of valid) {
    const id = v.values.id
    if (id != null && !existingIds.has(id)) {
      invalid.push({
        rowNumber: v.rowNumber,
        login: v.login,
        display_name: v.display_name,
        id,
        errors: [`id ${id} 对应的合作方不存在（要新建请清空 id 列）`]
      })
    } else {
      finalValid.push(v)
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
      login: v.values.login,
      display_name: v.values.display_name,
      account_kind: v.values.account_kind,
      discount_percent: v.values.discount_percent
    }))
  }
}

/**
 * 真正导入。
 *
 * 新建时生成**随机初始密码**（不写在 CSV 里），结果在返回值里给出 ——
 * 运营看到后线下告知合作方，首次登录后自行修改。
 */
export async function importPartnerCsv (buffer, options = {}) {
  const mode = normalizeImportMode(options.mode)
  const preview = await previewPartnerCsv(buffer)
  if (preview.invalidCount > 0 && mode === 'strict') {
    throw Object.assign(
      new Error(`有 ${preview.invalidCount} 行存在问题，未导入任何数据。请修正后重试`),
      { status: 400, preview }
    )
  }
  if (preview.validCount === 0) {
    throw Object.assign(new Error('没有可导入的数据行'), { status: 400, preview })
  }

  const { rows } = await parsePartnerCsv(buffer)
  const existing = await Partner.findAll({ attributes: ['id'] })
  const existingIds = new Set(existing.map(p => p.id))

  const created = []
  const updated = []
  const failed = []

  for (const row of rows) {
    const { values, errors } = validatePartnerRow(row.cells, null)
    if (errors.length > 0) {
      failed.push({ rowNumber: row.rowNumber, login: values.login, reason: errors.join('；') })
      continue
    }
    try {
      if (values.id != null) {
        if (!existingIds.has(values.id)) {
          failed.push({ rowNumber: row.rowNumber, login: values.login, reason: `id ${values.id} 的合作方不存在` })
          continue
        }
        const [affected] = await Partner.update(
          {
            display_name: values.display_name,
            account_kind: values.account_kind,
            discount_percent: values.discount_percent,
            is_active: values.is_active
          },
          { where: { id: values.id } }
        )
        if (!affected) {
          failed.push({ rowNumber: row.rowNumber, login: values.login, reason: `id ${values.id} 的合作方不存在` })
        } else {
          updated.push({ rowNumber: row.rowNumber, id: values.id, login: values.login })
        }
      } else {
        const initialPassword = generateInitialPassword()
        const partner = await Partner.create({
          login: values.login,
          password: initialPassword,
          display_name: values.display_name,
          account_kind: values.account_kind,
          discount_percent: values.discount_percent,
          is_active: values.is_active
        })
        created.push({
          rowNumber: row.rowNumber,
          id: partner.id,
          login: values.login,
          // ⚠️ 初始密码只在这里出现一次，运营要线下告知合作方
          initialPassword
        })
      }
    } catch (e) {
      failed.push({ rowNumber: row.rowNumber, login: values.login, reason: e.message })
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
 * 导出合作方为 CSV 文本（含 BOM）
 */
export async function exportPartnersCsv () {
  const partners = await Partner.findAll({ order: [['id', 'ASC']] })
  const lines = [CSV_COLUMNS.join(',')]
  for (const p of partners) {
    const raw = p.toJSON()
    lines.push(CSV_COLUMNS.map(col => {
      switch (col) {
        case 'id': return String(raw.id ?? '')
        case 'login': return csvCell(raw.login)
        case 'display_name': return csvCell(raw.display_name)
        case 'account_kind': return csvCell(raw.account_kind)
        case 'discount_percent': return raw.discount_percent == null ? '' : String(raw.discount_percent)
        case 'is_active': return raw.is_active ? 'true' : 'false'
        default: return ''
      }
    }).join(','))
  }
  return '﻿' + lines.join('\r\n')
}

/**
 * 导入模式：
 *   strict（默认）—— 有一行有问题就整批不落库
 *   skip —— 跳过有问题的行，导入其余的，问题行逐条回报
 */
export const IMPORT_MODES = ['strict', 'skip']

export function normalizeImportMode (mode) {
  const m = String(mode || 'strict').toLowerCase()
  return IMPORT_MODES.includes(m) ? m : 'strict'
}
