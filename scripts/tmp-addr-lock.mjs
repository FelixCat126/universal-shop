import fs from 'node:fs'

const p = 'src/server/controllers/addressController.js'
let s = fs.readFileSync(p, 'utf8')

/* 1) 加一个"锁用户行"的助手 */
const anchor = 'class AddressController {'
if (!s.includes(anchor)) { console.log('❌ 找不到类定义'); process.exit(1) }
const helper = `/**
 * 锁住用户行：把"这个用户的地址默认项"相关操作**串行化**。
 *
 * 为什么需要：设默认是「先把该用户所有地址清成非默认，再把目标设为默认」两步。
 * 两个设备同时操作（双击 / 两台手机）会交错：
 *   T1 清理全部 → T1 设 A → T2 清理全部（把 A 又清掉）→ T2 设 B
 * 结果可能是**两个默认地址**，或者**一个默认都没有**
 * （实测 60 轮并发里 4 轮出现"没有默认地址"—— 用户的默认地址凭空消失，
 *   结算页的地址也跟着变空）。
 *
 * 锁**用户行**而不是地址行：地址行之间没有父子关系，
 * 锁地址行挡不住"清理全部"那一步（它更新的是该用户的**所有**地址行）。
 * 合作方地址那边就是这么做的（锁 Partner 行）。
 *
 * 加锁顺序：先用户行、后地址行 —— 全流程一致，不会自锁。
 */
async function lockUserAddressScope (transaction, userId) {
  if (!userId) return
  await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE })
}

`
s = s.replace(anchor, helper + anchor, 1)

/* 2) 四个方法：事务开始后立刻锁用户行 */
const spots = [
  // updateAddress
  [`      const transaction = await sequelize.transaction()
      
      try {
        const userId = req.user?.userId
        const { id } = req.params

        if (!userId) {
          return res.status(401).json({
            success: false,
            message: '用户未登录'
          })
        }

        // 查找地址
        const address = await Address.findOne({
          where: { id, user_id: userId }
        })`,
   `      const transaction = await sequelize.transaction()
      
      try {
        const userId = req.user?.userId
        const { id } = req.params

        if (!userId) {
          return res.status(401).json({
            success: false,
            message: '用户未登录'
          })
        }

        // 锁用户行：把本用户的地址写操作串行化（见 lockUserAddressScope 的说明）
        await lockUserAddressScope(transaction, userId)

        // 查找地址
        const address = await Address.findOne({
          where: { id, user_id: userId },
          transaction
        })`]
]

for (const [old, neu] of spots) {
  if (!s.includes(old)) { console.log('❌ 没匹配上 updateAddress'); process.exit(1) }
  s = s.replace(old, neu, 1)
}

fs.writeFileSync(p, s)
console.log('✓ 已加助手并处理 updateAddress')
