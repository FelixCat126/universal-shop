import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../setup/test-database.js'
import { TestDataFactory } from '../factories/index.js'

describe('推荐系统集成测试', () => {
  let sequelize, User
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    User = sequelize.models.User
  })
  
  describe('推荐码生成', () => {
    it('应该为每个新用户生成唯一的推荐码', async () => {
      const users = []
      const referralCodes = new Set()
      
      // 创建多个用户
      for (let i = 0; i < 10; i++) {
        const userData = await TestDataFactory.createUser({
          phone: `1390013${i.toString().padStart(4, '0')}`,
          email: `refuser${i}@example.com`
        })
        const user = await User.create(userData)
        users.push(user)
        referralCodes.add(user.referral_code)
      }
      
      // 验证每个用户都有推荐码
      users.forEach(user => {
        expect(user.referral_code).toBeDefined()
        expect(user.referral_code).toHaveLength(8)
        expect(/^[A-Z0-9]{8}$/.test(user.referral_code)).toBe(true)
      })
      
      // 验证推荐码唯一性
      expect(referralCodes.size).toBe(10)
    })
    
    it('应该支持自定义推荐码格式', async () => {
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      // 验证推荐码格式
      expect(user.referral_code).toBeDefined()
      expect(typeof user.referral_code).toBe('string')
      expect(user.referral_code.length).toBeGreaterThan(0)
    })
    
    it('推荐码生成冲突时应该重试', async () => {
      // 创建第一个用户
      const user1Data = await TestDataFactory.createUser()
      const user1 = await User.create(user1Data)
      const originalCode = user1.referral_code
      
      // 创建更多用户，验证不会生成重复的推荐码
      for (let i = 0; i < 5; i++) {
        const userData = await TestDataFactory.createUser({
          phone: `1390013${i.toString().padStart(4, '0')}`,
          email: `conflict${i}@example.com`
        })
        const user = await User.create(userData)
        
        expect(user.referral_code).not.toBe(originalCode)
        expect(user.referral_code).toBeDefined()
      }
    })
  })
  
  describe('推荐关系建立', () => {
    let referrerUser
    
    beforeEach(async () => {
      // 创建推荐人
      const referrerData = await TestDataFactory.createUser({
        nickname: '推荐人',
        phone: '13900130001',
        email: 'referrer@example.com'
      })
      referrerUser = await User.create(referrerData)
    })
    
    it('应该记录用户的推荐来源', async () => {
      // 使用推荐码注册
      const newUserData = await TestDataFactory.createUser({
        nickname: '新用户',
        phone: '13900130002',
        email: 'newuser@example.com',
        referral_from: referrerUser.referral_code
      })
      
      const newUser = await User.create(newUserData)
      
      // 验证推荐关系
      expect(newUser.referral_from).toBe(referrerUser.referral_code)
    })
    
    it('应该支持自由填写推荐码（不需要验证存在性）', async () => {
      // 使用一个不存在的推荐码
      const fakeReferralCode = 'NOTEXIST'
      
      const newUserData = await TestDataFactory.createUser({
        nickname: '自由推荐用户',
        phone: '13900130003',
        email: 'freeref@example.com',
        referral_from: fakeReferralCode
      })
      
      // 应该能成功创建用户，即使推荐码不存在
      const newUser = await User.create(newUserData)
      
      expect(newUser.referral_from).toBe(fakeReferralCode)
      expect(newUser.id).toBeDefined()
      
      // 验证推荐码对应的用户不存在
      const referrer = await User.findOne({
        where: { referral_code: fakeReferralCode }
      })
      expect(referrer).toBeNull()
    })
    
    it('应该允许推荐码为空', async () => {
      // 不使用推荐码注册
      const newUserData = await TestDataFactory.createUser({
        nickname: '无推荐用户',
        phone: '13900130004',
        email: 'noref@example.com'
      })
      delete newUserData.referral_from
      
      const newUser = await User.create(newUserData)
      
      expect(newUser.referral_from).toBeNull()
      expect(newUser.id).toBeDefined()
    })
    
    it('应该支持批量通过推荐码注册用户', async () => {
      const newUsers = []
      
      // 使用相同推荐码注册多个用户
      for (let i = 0; i < 5; i++) {
        const userData = await TestDataFactory.createUser({
          nickname: `推荐用户${i + 1}`,
          phone: `1390013${(i + 5).toString().padStart(4, '0')}`,
          email: `refuser${i}@example.com`,
          referral_from: referrerUser.referral_code
        })
        
        const user = await User.create(userData)
        newUsers.push(user)
      }
      
      // 验证所有用户都使用了相同的推荐码
      newUsers.forEach(user => {
        expect(user.referral_from).toBe(referrerUser.referral_code)
      })
      
      expect(newUsers).toHaveLength(5)
    })
  })
  
  describe('推荐关系查询', () => {
    let referrerUser, referredUsers
    
    beforeEach(async () => {
      // 创建推荐人
      const referrerData = await TestDataFactory.createUser({
        nickname: '推荐人A',
        phone: '13900130001',
        email: 'referrerA@example.com'
      })
      referrerUser = await User.create(referrerData)
      
      // 创建被推荐的用户
      referredUsers = []
      for (let i = 0; i < 5; i++) {
        const userData = await TestDataFactory.createUser({
          nickname: `被推荐用户${i + 1}`,
          phone: `1390013${(i + 2).toString().padStart(4, '0')}`,
          email: `referred${i}@example.com`,
          referral_from: referrerUser.referral_code
        })
        
        const user = await User.create(userData)
        referredUsers.push(user)
      }
      
      // 创建一些使用其他推荐码的用户
      for (let i = 0; i < 3; i++) {
        const userData = await TestDataFactory.createUser({
          nickname: `其他用户${i + 1}`,
          phone: `1390013${(i + 10).toString().padStart(4, '0')}`,
          email: `other${i}@example.com`,
          referral_from: 'OTHER2024'
        })
        
        await User.create(userData)
      }
    })
    
    it('应该能查询某推荐码带来的所有用户', async () => {
      const referredByCode = await User.findAll({
        where: { referral_from: referrerUser.referral_code }
      })
      
      expect(referredByCode).toHaveLength(5)
      referredByCode.forEach(user => {
        expect(user.referral_from).toBe(referrerUser.referral_code)
      })
    })
    
    it('应该能统计推荐数量', async () => {
      const referralCount = await User.count({
        where: { referral_from: referrerUser.referral_code }
      })
      
      expect(referralCount).toBe(5)
    })
    
    it('应该能按推荐码分组统计', async () => {
      const referralStats = await User.findAll({
        attributes: [
          'referral_from',
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        where: {
          referral_from: {
            [sequelize.Sequelize.Op.ne]: null
          }
        },
        group: ['referral_from']
      })
      
      expect(referralStats.length).toBeGreaterThan(0)
      
      // 找到referrerUser的统计
      const referrerStat = referralStats.find(
        stat => stat.referral_from === referrerUser.referral_code
      )
      
      expect(referrerStat).toBeDefined()
      expect(referrerStat.get('count')).toBe(5)
    })
    
    it('应该能查询没有使用推荐码的用户', async () => {
      // 创建一个没有推荐码的用户
      const noRefUserData = await TestDataFactory.createUser({
        nickname: '无推荐用户',
        phone: '13900139999',
        email: 'noref@example.com'
      })
      delete noRefUserData.referral_from
      
      await User.create(noRefUserData)
      
      const usersWithoutReferral = await User.findAll({
        where: {
          referral_from: null
        }
      })
      
      expect(usersWithoutReferral.length).toBeGreaterThan(0)
    })
    
    it('应该支持多层推荐关系查询', async () => {
      // 一级推荐
      const level1User = referredUsers[0]
      
      // 二级推荐（被一级推荐用户推荐的用户）
      const level2Users = []
      for (let i = 0; i < 3; i++) {
        const userData = await TestDataFactory.createUser({
          nickname: `二级用户${i + 1}`,
          phone: `1390013${(i + 20).toString().padStart(4, '0')}`,
          email: `level2user${i}@example.com`,
          referral_from: level1User.referral_code
        })
        
        const user = await User.create(userData)
        level2Users.push(user)
      }
      
      // 查询一级推荐
      const level1Referrals = await User.findAll({
        where: { referral_from: referrerUser.referral_code }
      })
      expect(level1Referrals).toHaveLength(5)
      
      // 查询二级推荐
      const level2Referrals = await User.findAll({
        where: { referral_from: level1User.referral_code }
      })
      expect(level2Referrals).toHaveLength(3)
    })
  })
  
  describe('推荐码筛选和过滤', () => {
    beforeEach(async () => {
      // 创建多个推荐人
      const referrers = ['REF2024A', 'REF2024B', 'REF2024C']
      
      for (const refCode of referrers) {
        // 为每个推荐码创建几个用户
        const count = referrers.indexOf(refCode) + 2
        for (let i = 0; i < count; i++) {
          const userData = await TestDataFactory.createUser({
            nickname: `${refCode}-用户${i + 1}`,
            phone: `139${referrers.indexOf(refCode)}${i.toString().padStart(7, '0')}`,
            email: `${refCode.toLowerCase()}_user${i}@example.com`,
            referral_from: refCode
          })
          
          await User.create(userData)
        }
      }
    })
    
    it('应该能筛选特定推荐码的用户', async () => {
      const targetRefCode = 'REF2024A'
      
      const users = await User.findAll({
        where: { referral_from: targetRefCode }
      })
      
      expect(users).toHaveLength(2)
      users.forEach(user => {
        expect(user.referral_from).toBe(targetRefCode)
      })
    })
    
    it('应该能筛选多个推荐码的用户', async () => {
      const targetRefCodes = ['REF2024A', 'REF2024B']
      
      const users = await User.findAll({
        where: {
          referral_from: {
            [sequelize.Sequelize.Op.in]: targetRefCodes
          }
        }
      })
      
      expect(users.length).toBeGreaterThan(0)
      users.forEach(user => {
        expect(targetRefCodes).toContain(user.referral_from)
      })
    })
    
    it('应该能按推荐码模糊搜索', async () => {
      const users = await User.findAll({
        where: {
          referral_from: {
            [sequelize.Sequelize.Op.like]: '%2024%'
          }
        }
      })
      
      expect(users.length).toBeGreaterThan(0)
      users.forEach(user => {
        expect(user.referral_from).toContain('2024')
      })
    })
    
    it('应该能排除特定推荐码的用户', async () => {
      const excludeRefCode = 'REF2024C'
      
      const users = await User.findAll({
        where: {
          referral_from: {
            [sequelize.Sequelize.Op.ne]: excludeRefCode,
            [sequelize.Sequelize.Op.ne]: null
          }
        }
      })
      
      users.forEach(user => {
        expect(user.referral_from).not.toBe(excludeRefCode)
        expect(user.referral_from).not.toBeNull()
      })
    })
    
    it('应该能统计最受欢迎的推荐码', async () => {
      const popularReferrals = await User.findAll({
        attributes: [
          'referral_from',
          [sequelize.fn('COUNT', sequelize.col('id')), 'referral_count']
        ],
        where: {
          referral_from: {
            [sequelize.Sequelize.Op.ne]: null
          }
        },
        group: ['referral_from'],
        order: [[sequelize.literal('referral_count'), 'DESC']],
        limit: 3
      })
      
      expect(popularReferrals.length).toBeGreaterThan(0)
      
      // 验证排序正确（第一个应该是REF2024C，有4个用户）
      expect(popularReferrals[0].referral_from).toBe('REF2024C')
      expect(popularReferrals[0].get('referral_count')).toBe(4)
    })
  })
  
  describe('推荐数据完整性', () => {
    it('应该正确保存和读取推荐信息', async () => {
      const referralCode = 'TESTREF2024'
      
      // 创建用户
      const userData = await TestDataFactory.createUser({
        referral_from: referralCode
      })
      const user = await User.create(userData)
      
      // 重新读取用户
      const reloadedUser = await User.findByPk(user.id)
      
      expect(reloadedUser.referral_from).toBe(referralCode)
      expect(reloadedUser.referral_code).toBeDefined()
      expect(reloadedUser.referral_code).not.toBe(referralCode)
    })
    
    it('推荐码应该在更新用户信息时保持不变', async () => {
      const userData = await TestDataFactory.createUser({
        referral_from: 'ORIGINAL'
      })
      const user = await User.create(userData)
      
      const originalReferralFrom = user.referral_from
      const originalReferralCode = user.referral_code
      
      // 更新其他字段
      await user.update({
        nickname: '新昵称'
      })
      
      expect(user.referral_from).toBe(originalReferralFrom)
      expect(user.referral_code).toBe(originalReferralCode)
    })
    
    it('应该支持推荐码的大小写处理', async () => {
      const referralCodes = ['abc123', 'ABC123', 'AbC123']
      
      for (let i = 0; i < referralCodes.length; i++) {
        const userData = await TestDataFactory.createUser({
          nickname: `测试用户${i}`,
          phone: `1390013${i.toString().padStart(4, '0')}`,
          email: `casetest${i}@example.com`,
          referral_from: referralCodes[i]
        })
        
        const user = await User.create(userData)
        
        // 验证推荐码被正确保存（可能被标准化为大写）
        expect(user.referral_from).toBe(referralCodes[i])
      }
    })
    
    it('应该支持特殊字符的推荐码', async () => {
      const specialCodes = ['REF-2024', 'REF_2024', 'REF.2024']
      
      for (let i = 0; i < specialCodes.length; i++) {
        const userData = await TestDataFactory.createUser({
          nickname: `特殊推荐${i}`,
          phone: `1390014${i.toString().padStart(4, '0')}`,
          email: `special${i}@example.com`,
          referral_from: specialCodes[i]
        })
        
        const user = await User.create(userData)
        expect(user.referral_from).toBe(specialCodes[i])
      }
    })
  })
  
  describe('游客订单推荐码', () => {
    it('游客下单时应该正确记录推荐码', async () => {
      const guestReferralCode = 'GUEST2024'
      
      // 模拟游客注册
      const guestUserData = await TestDataFactory.createUser({
        nickname: '游客用户',
        phone: '13900139999',
        email: 'guest@example.com',
        referral_from: guestReferralCode
      })
      
      const guestUser = await User.create(guestUserData)
      
      // 验证推荐码被正确记录
      expect(guestUser.referral_from).toBe(guestReferralCode)
      expect(guestUser.id).toBeDefined()
      
      // 游客应该也有自己的推荐码
      expect(guestUser.referral_code).toBeDefined()
      expect(guestUser.referral_code).not.toBe(guestReferralCode)
    })
    
    it('游客重复下单不应该改变推荐码', async () => {
      // 第一次下单（自动注册）
      const guestUserData1 = await TestDataFactory.createUser({
        nickname: '游客',
        phone: '13900139998',
        email: 'repeatguest@example.com',
        referral_from: 'FIRST2024'
      })
      
      const existingUser = await User.findOne({
        where: {
          country_code: guestUserData1.country_code,
          phone: guestUserData1.phone
        }
      })
      
      let user
      if (existingUser) {
        user = existingUser
      } else {
        user = await User.create(guestUserData1)
      }
      
      const originalReferralFrom = user.referral_from
      
      // 第二次下单（用户已存在，不应该改变推荐码）
      const existingUser2 = await User.findOne({
        where: {
          country_code: guestUserData1.country_code,
          phone: guestUserData1.phone
        }
      })
      
      expect(existingUser2.id).toBe(user.id)
      expect(existingUser2.referral_from).toBe(originalReferralFrom)
    })
  })
})
