import Address from '../models/Address.js'
import Cart from '../models/Cart.js'
import User from '../models/User.js'
import sequelize from '../config/database.js'

/**
 * 注销账号（把账号匿名化 + 停用）（第 46 轮抽出为共用服务）
 * =========================================================
 *
 * ## 语义：**注销 ≠ 删数据**
 *
 * 用户的订单、积分流水、售后单都还挂着 user_id（外键指向 users）。
 * 物理删除会让那些历史记录悬空 → 运营看不到"这个客户下过什么单"。
 * 所以注销做的是**匿名化**：
 *
 *   - 删掉地址与购物车（个人信息）
 *   - 手机号改成占位号、用户名改成 `deleted_<id>`、邮箱清空、昵称改成"已注销用户"、头像清空
 *   - `is_active = false`（不能再登录）
 *   - `token_version + 1`（所有设备的旧会话立即失效）
 *
 * 历史业务数据（订单/积分/售后）**原样保留**，只是再也对应不上真人。
 *
 * ## 为什么抽成共用服务
 *
 * 客户自助注销（PUT/DELETE /api/users/profile）与运营在后台注销用户，
 * 要做的事**完全一样** —— 之前只有前者有实现（写在控制器里），
 * 后者整块缺失 → 运营遇到"这个客户要求删号"时只能：
 *   手工改库，或者……让客户自己去注销（还得知道客户的密码 ✗）。
 *
 * 两边共用一份实现 → 不会出现"后台注销少做了某一步"（比如忘了让会话失效）。
 *
 * @param {number} userId 要注销的用户 id
 * @param {import('sequelize').Transaction} transaction
 * @returns {Promise<object>} 匿名化后的用户实例
 */
export async function anonymizeUserAccount (userId, transaction) {
  const user = await User.findByPk(userId, {
    transaction,
    lock: transaction.LOCK.UPDATE
  })
  if (!user) {
    const err = new Error('用户不存在')
    err.status = 404
    throw err
  }

  // 个人信息：地址与购物车直接删
  await Address.destroy({ where: { user_id: userId }, transaction })
  await Cart.destroy({ where: { user_id: userId }, transaction })

  // 账号本身：匿名化 + 停用
  user.is_active = false
  user.country_code = '+86'
  user.phone = `139${String(user.id).padStart(8, '0')}`
  user.username = `deleted_${user.id}`
  user.email = null
  user.nickname = '已注销用户'
  user.avatar_url = null
  user.referral_code = null
  user.referred_by_code = null
  user.must_reset_password = false
  await user.save({ transaction })

  // 原子自增，避免并发下丢更新
  await User.update(
    { token_version: sequelize.literal('token_version + 1') },
    { where: { id: userId }, transaction }
  )

  return user
}
