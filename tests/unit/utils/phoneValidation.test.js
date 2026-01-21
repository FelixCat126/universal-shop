import { describe, it, expect, beforeAll } from 'vitest'
import UserController from '../../../src/server/controllers/userController.js'

describe('手机号验证工具', () => {
  describe('中国手机号验证 (+86)', () => {
    it('应该验证正确的中国手机号', () => {
      const validPhones = [
        '13812345678',
        '15987654321',
        '18611223344',
        '17712345678'
      ]
      
      validPhones.forEach(phone => {
        const result = UserController._validatePhoneNumber(phone, '+86')
        expect(result.isValid).toBe(true)
      })
    })
    
    it('应该拒绝格式错误的中国手机号', () => {
      const invalidPhones = [
        '12345678',      // 太短
        '12345678901',   // 不以1开头
        '198765432100',  // 太长
        '10012345678'    // 第二位不是3-9
      ]
      
      invalidPhones.forEach(phone => {
        const result = UserController._validatePhoneNumber(phone, '+86')
        expect(result.isValid).toBe(false)
        expect(result.message).toContain('中国手机号格式错误')
      })
    })
    
    it('应该拒绝包含非数字字符的手机号', () => {
      const result = UserController._validatePhoneNumber('abc12345678', '+86')
      expect(result.isValid).toBe(false)
      expect(result.message).toContain('手机号必须为纯数字')
    })
  })
  
  describe('泰国手机号验证 (+66)', () => {
    it('应该验证正确的泰国手机号', () => {
      const validPhones = [
        '612345678',    // 9位，以6开头
        '812345678',    // 9位，以8开头
        '912345678',    // 9位，以9开头
        '987654321'     // 9位，以9开头
      ]
      
      validPhones.forEach(phone => {
        const result = UserController._validatePhoneNumber(phone, '+66')
        expect(result.isValid).toBe(true)
      })
    })
    
    it('应该拒绝格式错误的泰国手机号', () => {
      const invalidPhones = [
        '12345678',     // 8位
        '701234567',    // 不以6、8、9开头
        '66123456789',  // 太长（11位）
        '12345678'      // 8位且不以6、8、9开头
      ]
      
      invalidPhones.forEach(phone => {
        const result = UserController._validatePhoneNumber(phone, '+66')
        expect(result.isValid).toBe(false)
        expect(result.message).toContain('泰国手机号格式错误')
      })
    })
    
    it('应该拒绝包含非数字字符的手机号', () => {
      const result = UserController._validatePhoneNumber('abc234567', '+66')
      expect(result.isValid).toBe(false)
      expect(result.message).toContain('手机号必须为纯数字')
    })
  })
  
  describe('马来西亚手机号验证 (+60)', () => {
    it('应该验证正确的马来西亚手机号', () => {
      const validPhones = [
        '123456789',     // 9位，以1开头
        '1234567890',    // 10位，以1开头
        '187654321',     // 9位，以1开头
        '1987654321'     // 10位，以1开头
      ]
      
      validPhones.forEach(phone => {
        const result = UserController._validatePhoneNumber(phone, '+60')
        expect(result.isValid).toBe(true)
      })
    })
    
    it('应该拒绝格式错误的马来西亚手机号', () => {
      const invalidPhones = [
        '12345',        // 太短
        '223456789',    // 不以1开头
        '012345678',    // 以0开头
        '12345678901'   // 太长（11位）
      ]
      
      invalidPhones.forEach(phone => {
        const result = UserController._validatePhoneNumber(phone, '+60')
        expect(result.isValid).toBe(false)
        expect(result.message).toContain('马来西亚手机号格式错误')
      })
    })
    
    it('应该拒绝包含非数字字符的手机号', () => {
      const result = UserController._validatePhoneNumber('abc456789', '+60')
      expect(result.isValid).toBe(false)
      expect(result.message).toContain('手机号必须为纯数字')
    })
  })
  
  describe('不支持的国家区号', () => {
    it('应该拒绝不支持的国家区号', () => {
      const result = UserController._validatePhoneNumber('1234567890', '+1')
      expect(result.isValid).toBe(false)
      expect(result.message).toContain('不支持的国家区号')
    })
  })
  
  describe('空值和特殊情况', () => {
    it('应该拒绝空字符串', () => {
      const result = UserController._validatePhoneNumber('', '+86')
      expect(result.isValid).toBe(false)
    })
    
    it('应该拒绝只有空格的字符串', () => {
      const result = UserController._validatePhoneNumber('   ', '+86')
      expect(result.isValid).toBe(false)
    })
    
    it('应该拒绝null', () => {
      const result = UserController._validatePhoneNumber(null, '+86')
      expect(result.isValid).toBe(false)
    })
    
    it('应该拒绝undefined', () => {
      const result = UserController._validatePhoneNumber(undefined, '+86')
      expect(result.isValid).toBe(false)
    })
  })
})
