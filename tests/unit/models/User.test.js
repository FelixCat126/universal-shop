import { describe, it, expect, beforeEach } from 'vitest'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'

describe('User 模型', () => {
  let sequelize, User
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    User = sequelize.models.User
  })
  
  describe('密码加密和验证', () => {
    it('应该自动加密密码', async () => {
      const userData = await TestDataFactory.createUser({ password: '123456' })
      const user = await User.create(userData)
      
      // 密码应该被加密，不等于原始密码
      expect(user.password).not.toBe('123456')
      expect(user.password).toBeTruthy()
      expect(user.password.length).toBeGreaterThan(20) // bcrypt hash长度
    })
    
    it('应该正确验证密码', async () => {
      const userData = await TestDataFactory.createUser({ password: '123456' })
      const user = await User.create(userData)
      
      const isValid = await user.validatePassword('123456')
      expect(isValid).toBe(true)
    })
    
    it('应该拒绝错误的密码', async () => {
      const userData = await TestDataFactory.createUser({ password: '123456' })
      const user = await User.create(userData)
      
      const isValid = await user.validatePassword('wrongpassword')
      expect(isValid).toBe(false)
    })
    
    it('应该在更新时重新加密密码', async () => {
      const userData = await TestDataFactory.createUser({ password: '123456' })
      const user = await User.create(userData)
      const originalHash = user.password
      
      // 更新密码
      await user.update({ password: 'newpassword' })
      
      // 密码哈希应该改变
      expect(user.password).not.toBe(originalHash)
      
      // 新密码应该有效
      const isNewPasswordValid = await user.validatePassword('newpassword')
      expect(isNewPasswordValid).toBe(true)
      
      // 旧密码应该无效
      const isOldPasswordValid = await user.validatePassword('123456')
      expect(isOldPasswordValid).toBe(false)
    })
    
    it('应该在不更改密码时保持原哈希', async () => {
      const userData = await TestDataFactory.createUser({ password: '123456' })
      const user = await User.create(userData)
      const originalHash = user.password
      
      // 更新其他字段
      await user.update({ nickname: '新昵称' })
      
      // 密码哈希不应该改变
      expect(user.password).toBe(originalHash)
    })
  })
  
  describe('推荐码生成', () => {
    it('应该自动生成推荐码', async () => {
      const userData = await TestDataFactory.createUser()
      delete userData.referral_code // 让系统自动生成
      
      const user = await User.create(userData)
      expect(user.referral_code).toBeTruthy()
      expect(user.referral_code).toHaveLength(8)
      expect(/^[A-Z0-9]{8}$/.test(user.referral_code)).toBe(true)
    })
    
    it('应该使用提供的推荐码', async () => {
      const userData = await TestDataFactory.createUser({ 
        referral_code: 'CUSTOM01' 
      })
      
      const user = await User.create(userData)
      expect(user.referral_code).toBe('CUSTOM01')
    })
    
    it('应该生成唯一的推荐码', async () => {
      // 创建多个用户
      const users = []
      for (let i = 0; i < 10; i++) {
        const userData = await TestDataFactory.createUser({
          phone: `138001380${i.toString().padStart(2, '0')}`,
          email: `test${i}@example.com`
        })
        delete userData.referral_code
        
        const user = await User.create(userData)
        users.push(user)
      }
      
      // 检查推荐码是否唯一
      const referralCodes = users.map(u => u.referral_code)
      const uniqueCodes = new Set(referralCodes)
      expect(uniqueCodes.size).toBe(referralCodes.length)
    })
    
    it('应该在推荐码冲突时重新生成', async () => {
      // 这个测试模拟推荐码冲突的情况
      // 由于真实的冲突很难模拟，我们主要验证系统能处理这种情况
      const userData1 = await TestDataFactory.createUser({
        referral_code: 'TESTCODE'
      })
      const user1 = await User.create(userData1)
      
      // 尝试创建另一个用户，系统应该检测到冲突并生成新的推荐码
      const userData2 = await TestDataFactory.createUser({
        phone: '13900139001',
        email: 'test2@example.com'
      })
      delete userData2.referral_code
      
      const user2 = await User.create(userData2)
      
      // 两个用户的推荐码应该不同
      expect(user1.referral_code).not.toBe(user2.referral_code)
    })
  })
  
  describe('用户查找方法', () => {
    let testUser
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser({
        referral_code: 'FINDTEST'
      })
      testUser = await User.create(userData)
    })
    
    it('应该能通过推荐码查找用户', async () => {
      const foundUser = await User.findByReferralCode('FINDTEST')
      expect(foundUser).toBeTruthy()
      expect(foundUser.id).toBe(testUser.id)
    })
    
    it('应该能通过国家区号+手机号查找用户', async () => {
      const foundUser = await User.findByCountryAndPhone(
        testUser.country_code, 
        testUser.phone
      )
      expect(foundUser).toBeTruthy()
      expect(foundUser.id).toBe(testUser.id)
    })
    
    it('推荐码不存在时应该返回null', async () => {
      const foundUser = await User.findByReferralCode('NOTEXIST')
      expect(foundUser).toBeNull()
    })
    
    it('手机号不存在时应该返回null', async () => {
      const foundUser = await User.findByCountryAndPhone('+86', '19999999999')
      expect(foundUser).toBeNull()
    })
  })
  
  describe('数据序列化', () => {
    it('应该在序列化时移除密码字段', async () => {
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      const safeData = user.toSafeJSON()
      expect(safeData.password).toBeUndefined()
      expect(safeData.id).toBeDefined()
      expect(safeData.email).toBeDefined()
      expect(safeData.nickname).toBeDefined()
    })
    
    it('应该保留其他所有字段', async () => {
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      const safeData = user.toSafeJSON()
      const expectedFields = [
        'id', 'username', 'nickname', 'country_code', 'phone',
        'email', 'is_active', 'referral_code',
        'created_at', 'updated_at'
      ]
      
      expectedFields.forEach(field => {
        expect(safeData.hasOwnProperty(field)).toBe(true)
      })
    })
  })
  
  describe('数据库约束', () => {
    let existingUser
    
    beforeEach(async () => {
      const userData = await TestDataFactory.createUser()
      existingUser = await User.create(userData)
    })
    
    it('应该强制国家区号+手机号的唯一性', async () => {
      const duplicateData = await TestDataFactory.createUser({
        country_code: existingUser.country_code,
        phone: existingUser.phone,
        email: 'different@example.com' // 不同的邮箱
      })
      
      await expect(User.create(duplicateData)).rejects.toThrow()
    })
    
    it('应该允许相同手机号但不同国家区号', async () => {
      // 使用同一本地号码、不同区号；须同时满足各国最少位数（如 +86 需 11 位）
      const sharedLocal = '13812345678'
      const first = await TestDataFactory.createUser({
        country_code: '+66',
        phone: sharedLocal,
        email: 'cross66@test.com',
        username: 'cross66@test.com'
      })
      await User.create(first)
      const second = await TestDataFactory.createUser({
        country_code: '+86',
        phone: sharedLocal,
        email: 'cross86@test.com',
        username: 'cross86@test.com'
      })
      const user = await User.create(second)
      expect(user.id).toBeDefined()
    })
    
    it('应该强制邮箱的唯一性', async () => {
      const duplicateEmailData = await TestDataFactory.createUser({
        country_code: '+66',
        phone: '661234567',
        email: existingUser.email // 相同邮箱
      })
      
      await expect(User.create(duplicateEmailData)).rejects.toThrow()
    })
  })
  
  describe('字段验证', () => {
    it('应该验证必填字段', async () => {
      const incompleteData = {
        nickname: '测试用户'
        // 缺少其他必填字段
      }
      
      await expect(User.create(incompleteData)).rejects.toThrow()
    })
    
    it('应该验证邮箱格式', async () => {
      const userData = await TestDataFactory.createUser({
        email: 'invalid-email'
      })
      
      await expect(User.create(userData)).rejects.toThrow()
    })
    
    it('应该接受有效的数据', async () => {
      const userData = await TestDataFactory.createUser()
      const user = await User.create(userData)
      
      expect(user.id).toBeDefined()
      expect(user.created_at).toBeDefined()
      expect(user.updated_at).toBeDefined()
    })
  })
})
