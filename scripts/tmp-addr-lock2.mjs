import fs from 'node:fs'

const p = 'src/server/controllers/addressController.js'
const lines = fs.readFileSync(p, 'utf8').split('\n')

/* 助手函数：插在类定义之前 */
const classIdx = lines.findIndex(l => l.includes('class AddressController'))
if (classIdx < 0) { console.log('❌ 找不到类定义'); process.exit(1) }

const helper = [
  '/**',
  ' * 锁住用户行：把"这个用户的地址默认项"相关操作**串行化**。',
  ' *',
  ' * 为什么需要：设默认是「先把该用户所有地址清成非默认，再把目标设为默认」两步。',
  ' * 两个设备同时操作（双击 / 两台手机）会交错：',
  ' *   T1 清理全部 → T1 设 A → T2 清理全部（把 A 又清掉）→ T2 设 B',
  ' * 结果可能是**两个默认地址**，或者**一个默认都没有**',
  ' * （实测 60 轮并发里 4 轮出现"没有默认地址"—— 用户的默认地址凭空消失，',
  ' *   结算页的地址也跟着变空）。',
  ' *',
  ' * 锁**用户行**而不是地址行：地址行之间没有父子关系，',
  ' * 锁地址行挡不住"清理全部"那一步（它更新的是该用户的**所有**地址行）。',
  ' * 合作方地址那边就是这么做的（锁 Partner 行）。',
  ' *',
  ' * 加锁顺序：先用户行、后地址行 —— 全流程一致，不会自锁。',
  ' */',
  'async function lockUserAddressScope (transaction, userId) {',
  '  if (!userId) return',
  '  await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE })',
  '}',
  ''
]
lines.splice(classIdx, 0, ...helper)

/* 插入调用点（行号按插入后的文件重新定位，用文本锚点更安全） */
const text = lines.join('\n')

// A) createAddress：事务在 "校验全部通过后再开启事务" 之后开启 → 锁放在 try 之后
const aOld = `      // 校验全部通过后再开启事务
      const transaction = await sequelize.transaction()

      try {
      // 构建完整地址`
const aNew = `      // 校验全部通过后再开启事务
      const transaction = await sequelize.transaction()

      try {
      // 锁用户行：把本用户的地址写操作串行化（见 lockUserAddressScope）
      await lockUserAddressScope(transaction, userId)

      // 构建完整地址`
if (!text.includes(aOld)) { console.log('❌ createAddress 锚点没匹配'); process.exit(1) }
let out = text.replace(aOld, aNew)

// B) updateAddress / setDefaultAddress / deleteAddress：三个 401 块后加锁
//    只替换**前三个**（第 4 个是 getAddressDetail，没有事务）
const blk = `      if (!userId) {
        return res.status(401).json({
          success: false,
          message: '用户未登录'
        })
      }
`
const blkNew = blk + `
      // 锁用户行：把本用户的地址写操作串行化（见 lockUserAddressScope）
      await lockUserAddressScope(transaction, userId)
`
let count = 0
out = out.replace(blk, () => { count++; return count <= 3 ? blkNew : blk })
if (count !== 4) { console.log('❌ 401 块数量不对: ' + count); process.exit(1) }

fs.writeFileSync(p, out)
console.log('✓ 已加助手 + 4 处调用（create/update/setDefault/delete）')
