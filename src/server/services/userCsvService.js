/**
 * 用户 CSV 导入 / 导出
 *
 * 为什么需要：运营手上有一份客户名单（Excel），要变成商城账号。
 * 之前只能一个一个在后台填 —— 几十个客户就是几十次表单。
 *
 * ⚠️ **密码绝不进 CSV**。
 * CSV 会躺在邮件/Excel/聊天记录里，一份泄露就是一批账号泄露。
 * 所以走"邀请流程"：
 *   1. 系统生成随机初始密码（只在导入结果里显示一次，运营线下告知）
 *   2. 账号标记 must_reset_password = true
 *   3. 用户登录后被**强制改密**（前端读这个标志位并弹改密框）
 *   4. 改完密码，标志位清掉
 *
 * 这样运营永远不接触最终密码，客户自己设。
 *
 * 其它设计沿用商品/合作方 CSV 导入：
 *   - 先预览再落库（dry_run 默认开）
 *   - 逐行报告问题
 *   - 有问题的行整批不落库
 *   - 带 id = 更新，不带 id = 新建
 */
import crypto from 'node:crypto'
import User from '../models/User.js'
import { parseCsvTable } from '../utils/csvTable.js'
import { csvCell } from '../utils/csvExporter.js'

/** 一次最多导入多少行 */
export const MAX_IMPORT_ROWS = 500
/** 文件大小上限 */
export const MAX_CSV_BYTES = 5 * 1024 * 1024

/** 允许的国家区号 */
const COUNTRY_CODES = ['+86', '+66', '+60']

/** CSV 列定义（表头顺序即导出顺序） */
export const CSV_COLUMNS = [
  'id',
  'nickname',
  'username',
  'email',
  'phone',
  'country_code',
  'referral_code',
  'is_active'
]

/** 必填列 */
const REQUIRED_COLUMNS = ['nickname', 'phone']

/** 表头别名 */
const HEADER_ALIASES = {
  id: ['id', '用户id', '编号'],
  nickname: ['nickname', '昵称', '名称', '客户名称'],
  username: ['username', '用户名', '登录名'],
  email: ['email', '邮箱', '电子邮箱'],
  phone: ['phone', '手机号', '手机', '电话'],
  country_code: ['country_code', 'countrycode', '国家区号', '区号'],
  referral_code: ['referral_code', 'referralcode', '推荐码'],
  is_active: ['is_active', 'isactive', '启用', '状态']
}

/**
 * 解析用户 CSV
 * @param {Buffer} buffer
 */
export async function parseUserCsv (buffer) {
  return parseCsvTable(buffer, {
    aliases: HEADER_ALIASES,
    required: REQUIRED_COLUMNS,
    maxRows: MAX_IMPORT_ROWS,
    maxBytes: MAX_CSV_BYTES
  })
}

/**
 * 生成随机初始密码（12 位，大小写 + 数字 + 特殊字符；去掉易混字符）。
 * 去掉 0/O/1/l/I 是因为这密码要**口头/线下**告知，运营照着敲很容易敲错。
 */
export function generateInitialPassword () {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const special = '!@#$%&*'
  const all = upper + lower + digits + special
  const pick = (set) => set[crypto.randomInt(set.length)]
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)]
  while (chars.length < 12) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

/**
 * 国家区号归一：接受 "+86" 与 "86" 两种写法。
 *
 * 为什么需要：Excel 里输入 `+66` 会被存成**数字 66**（显示成 +66 是靠数字格式），
 * 另存为 CSV 时写出来的是 `66` —— 没有加号。
 * 所以解析时必须两种都认，否则运营在 Excel 里好好填的区号，到导入时全被判非法。
 */
export function normalizeCountryCode (raw) {
  if (raw === null || raw === undefined) return ''
  let s = String(raw).trim()
  if (!s) return ''
  if (!s.startsWith('+')) s = `+${s}`
  return s
}

/**
 * 校验一行
 * @returns {{values: object, errors: string[]}}
 */
export function validateUserRow (cells, existing) {
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

  // nickname（必填）
  const nickname = cells.nickname == null ? '' : String(cells.nickname).trim()
  if (!nickname) errors.push('昵称不能为空')
  else if (nickname.length > 50) errors.push('昵称过长（上限 50 字）')
  values.nickname = nickname

  // phone（必填）+ 国家区号
  const rawCc = normalizeCountryCode(cells.country_code)
  let countryCode = '+66'
  if (rawCc) {
    if (!COUNTRY_CODES.includes(rawCc)) {
      errors.push(`国家区号只能是 ${COUNTRY_CODES.join(' / ')}（也接受不带 + 的写法）`)
    } else {
      countryCode = rawCc
    }
  }
  values.country_code = countryCode

  const phone = cells.phone == null ? '' : String(cells.phone).trim()
  if (!phone) {
    errors.push('手机号不能为空')
  } else if (!/^[1-9]\d{7,14}$/.test(phone)) {
    errors.push('手机号格式不对（数字，8-15 位）')
  } else {
    // 自己不算占用（更新时手机号不变是正常的）
    const takenBy = existing?.phoneMap?.get(`${countryCode}${phone}`)
    if (takenBy && takenBy !== values.id) {
      errors.push(`手机号 ${countryCode}${phone} 已被占用`)
    }
  }
  values.phone = phone

  /**
   * username（选填；不给就按系统约定生成 country_code+phone）。
   *
   * 允许的字符集要**覆盖系统实际会产生/接受的值**：
   *   - 常规注册：country_code + phone（如 "+66812345678"）
   *   - 管理员建号：可以直接用邮箱当 username
   * 所以这里放行 @ 与 +。收得太紧会让"导出 → 改 → 再导入"这条闭环断掉
   * （导出的用户名导不回来 —— 这是很隐蔽的坑）。
   */
  const rawUsername = cells.username == null ? '' : String(cells.username).trim()
  if (rawUsername && !/^[A-Za-z0-9._@+-]{2,100}$/.test(rawUsername)) {
    errors.push('用户名只能含字母、数字、点、下划线、连字符、@ 与 +（2-100 位）')
  }
  // 用户名唯一：但**自己**不算占用（更新时用户名不变是正常的，
  // 否则"导出 → 改 → 再导入"这条闭环会断掉）
  if (rawUsername) {
    const takenBy = existing?.usernameMap?.get(rawUsername.toLowerCase())
    if (takenBy && takenBy !== values.id) {
      errors.push(`用户名「${rawUsername}」已被占用`)
    }
  }
  values.username = rawUsername || null

  // email（选填）
  const email = cells.email == null ? '' : String(cells.email).trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('邮箱格式不对')
  } else if (email) {
    // 同理：自己不算占用（更新时邮箱不变是正常的）
    const takenBy = existing?.emailMap?.get(email.toLowerCase())
    if (takenBy && takenBy !== values.id) {
      errors.push(`邮箱 ${email} 已被占用`)
    }
  }
  values.email = email || null

  // referral_code（选填）
  const referralCode = cells.referral_code == null ? '' : String(cells.referral_code).trim()
  if (referralCode && !/^[A-Za-z0-9]{4,32}$/.test(referralCode)) {
    errors.push('推荐码只能含字母数字（4-32 位）')
  }
  values.referral_code = referralCode || null

  // is_active（默认启用）
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
 * 载入已存在的用户（用于查重）
 */
async function loadExisting () {
  const users = await User.findAll({ attributes: ['id', 'username', 'email', 'phone', 'country_code'] })
  const phoneMap = new Map()
  const emailMap = new Map()
  const usernameMap = new Map()
  const idPhoneMap = new Map()
  for (const u of users) {
    if (u.phone) {
      const key = `${u.country_code || '+66'}${u.phone}`
      phoneMap.set(key, u.id)
      idPhoneMap.set(u.id, key)
    }
    if (u.email) emailMap.set(String(u.email).toLowerCase(), u.id)
    if (u.username) usernameMap.set(String(u.username).toLowerCase(), u.id)
  }
  return { phoneMap, emailMap, usernameMap, idPhoneMap, ids: new Set(users.map(u => u.id)) }
}

/**
 * 预览：只校验不落库
 */
export async function previewUserCsv (buffer) {
  const { headers, unknownHeaders, rows } = await parseUserCsv(buffer)
  const existing = await loadExisting()

  const valid = []
  const invalid = []
  const seenPhones = new Map()
  const seenIds = new Map()

  for (const row of rows) {
    const { values, errors } = validateUserRow(row.cells, existing)

    // 同一个 id 重复 → 后面的判错（否则后者覆盖前者，静默丢数据）
    if (values.id != null) {
      if (seenIds.has(values.id)) {
        errors.push(`id ${values.id} 在文件里重复出现（第 ${seenIds.get(values.id)} 行已用过）`)
      } else {
        seenIds.set(values.id, row.rowNumber)
      }
    }
    // 文件内手机号重复
    const phoneKey = `${values.country_code}${values.phone}`
    if (values.phone) {
      if (seenPhones.has(phoneKey)) {
        errors.push(`手机号 ${phoneKey} 在文件里重复出现（第 ${seenPhones.get(phoneKey)} 行已用过）`)
      } else {
        seenPhones.set(phoneKey, row.rowNumber)
      }
    }

    const item = {
      rowNumber: row.rowNumber,
      nickname: values.nickname,
      phone: values.phone,
      id: values.id,
      errors
    }
    if (errors.length === 0) {
      valid.push({ ...item, action: values.id != null ? 'update' : 'create', values })
    } else {
      invalid.push(item)
    }
  }

  // 有 id 的行还要确认该用户确实存在
  const finalValid = []
  for (const v of valid) {
    const id = v.values.id
    if (id != null && !existing.ids.has(id)) {
      invalid.push({
        rowNumber: v.rowNumber,
        nickname: v.nickname,
        phone: v.phone,
        id,
        errors: [`id ${id} 对应的用户不存在（要新建请清空 id 列）`]
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
      nickname: v.values.nickname,
      phone: v.values.phone,
      email: v.values.email
    }))
  }
}

/**
 * 真正导入。
 *
 * 新建时：生成随机初始密码 + must_reset_password = true（用户首次登录必须改密）
 * 更新时：**不动密码**（改密码是用户自己的事，运营不该碰）
 */
export async function importUserCsv (buffer) {
  const preview = await previewUserCsv(buffer)
  if (preview.invalidCount > 0) {
    throw Object.assign(
      new Error(`有 ${preview.invalidCount} 行存在问题，未导入任何数据。请修正后重试`),
      { status: 400, preview }
    )
  }
  if (preview.validCount === 0) {
    throw Object.assign(new Error('没有可导入的数据行'), { status: 400, preview })
  }

  const { rows } = await parseUserCsv(buffer)
  const existing = await loadExisting()

  const created = []
  const updated = []
  const failed = []

  for (const row of rows) {
    const { values, errors } = validateUserRow(row.cells, existing)
    if (errors.length > 0) {
      failed.push({ rowNumber: row.rowNumber, nickname: values.nickname, reason: errors.join('；') })
      continue
    }
    try {
      if (values.id != null) {
        if (!existing.ids.has(values.id)) {
          failed.push({ rowNumber: row.rowNumber, nickname: values.nickname, reason: `id ${values.id} 的用户不存在` })
          continue
        }
        const [affected] = await User.update(
          {
            nickname: values.nickname,
            email: values.email,
            phone: values.phone,
            country_code: values.country_code,
            referral_code: values.referral_code,
            is_active: values.is_active
          },
          { where: { id: values.id } }
        )
        if (!affected) {
          failed.push({ rowNumber: row.rowNumber, nickname: values.nickname, reason: `id ${values.id} 的用户不存在` })
        } else {
          updated.push({ rowNumber: row.rowNumber, id: values.id, nickname: values.nickname })
        }
      } else {
        const initialPassword = generateInitialPassword()
        // 用户名不给就按**系统既有约定**生成（与注册路径一致：country_code+phone）
        const username = values.username || `${values.country_code}${values.phone}`
        const user = await User.create({
          nickname: values.nickname,
          username,
          email: values.email,
          phone: values.phone,
          country_code: values.country_code,
          referral_code: values.referral_code,
          is_active: values.is_active,
          password: initialPassword,
          // 邀请流程：首次登录必须改密（用户自己设最终密码）
          must_reset_password: true
        })
        created.push({
          rowNumber: row.rowNumber,
          id: user.id,
          nickname: values.nickname,
          username,
          // ⚠️ 初始密码只在这里出现一次，运营要线下告知用户
          initialPassword
        })
      }
    } catch (e) {
      failed.push({ rowNumber: row.rowNumber, nickname: values.nickname, reason: e.message })
    }
  }

  return {
    createdCount: created.length,
    updatedCount: updated.length,
    failedCount: failed.length,
    created,
    updated,
    failed
  }
}

/**
 * 导出用户为 CSV 文本（含 BOM）
 */
export async function exportUsersCsv () {
  const users = await User.findAll({ order: [['id', 'ASC']] })
  const lines = [CSV_COLUMNS.join(',')]
  for (const u of users) {
    const raw = u.toJSON()
    lines.push(CSV_COLUMNS.map(col => {
      switch (col) {
        case 'id': return String(raw.id ?? '')
        case 'nickname': return csvCell(raw.nickname)
        case 'username': return csvCell(raw.username)
        case 'email': return csvCell(raw.email)
        case 'phone': return csvCell(raw.phone)
        case 'country_code': return csvCell(raw.country_code)
        case 'referral_code': return csvCell(raw.referral_code)
        case 'is_active': return raw.is_active ? 'true' : 'false'
        default: return ''
      }
    }).join(','))
  }
  return '﻿' + lines.join('\r\n')
}
