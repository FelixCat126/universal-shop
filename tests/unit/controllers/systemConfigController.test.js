import { describe, it, expect, beforeEach, vi } from 'vitest'
import SystemConfigController from '@server/controllers/systemConfigController.js'
import { TestDatabase } from '../../setup/test-database.js'
import { TestDataFactory } from '../../factories/index.js'

describe('SystemConfigController 单元测试', () => {
  let sequelize, SystemConfig
  
  beforeEach(async () => {
    sequelize = TestDatabase.getSequelize()
    await TestDatabase.clearAllData()
    SystemConfig = sequelize.models.SystemConfig
  })
  
  describe('getConfig 获取配置', () => {
    let req, res, testConfigs
    
    beforeEach(async () => {
      testConfigs = await TestDataFactory.createSystemConfig()
      const config = await SystemConfig.create(testConfigs)
      
      req = {}
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回系统配置', async () => {
      await SystemConfigController.getConfig(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          config_key: testConfigs.config_key,
          config_value: testConfigs.config_value
        })
      })
    })
  })
  
  describe('getAllConfigs 获取所有配置', () => {
    let req, res
    
    beforeEach(async () => {
      // 创建多个配置项
      const configKeys = [
        'site_name',
        'site_logo',
        'contact_email',
        'contact_phone',
        'default_currency'
      ]
      
      for (const key of configKeys) {
        const configData = await TestDataFactory.createSystemConfig({
          config_key: key,
          config_value: `value_${key}`,
          description: `Description for ${key}`
        })
        await SystemConfig.create(configData)
      }
      
      req = {
        query: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回所有配置', async () => {
      await SystemConfigController.getAllConfigs(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.configs.length).toBeGreaterThanOrEqual(5)
    })
    
    it('应该支持分页', async () => {
      req.query.page = 1
      req.query.page_size = 3
      
      await SystemConfigController.getAllConfigs(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      expect(responseData.configs.length).toBeLessThanOrEqual(3)
    })
    
    it('应该支持按配置键搜索', async () => {
      req.query.search = 'site'
      
      await SystemConfigController.getAllConfigs(req, res)
      
      const responseData = res.json.mock.calls[0][0].data
      responseData.configs.forEach(config => {
        expect(config.config_key.toLowerCase()).toContain('site')
      })
    })
  })
  
  describe('getConfigByKey 按键获取配置', () => {
    let req, res, testConfig
    
    beforeEach(async () => {
      const configData = await TestDataFactory.createSystemConfig({
        config_key: 'test_key',
        config_value: 'test_value'
      })
      testConfig = await SystemConfig.create(configData)
      
      req = {
        params: { key: 'test_key' }
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回指定配置', async () => {
      await SystemConfigController.getConfigByKey(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          config_key: 'test_key',
          config_value: 'test_value'
        })
      })
    })
    
    it('应该返回404当配置不存在', async () => {
      req.params.key = 'nonexistent_key'
      
      await SystemConfigController.getConfigByKey(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: '配置不存在'
      })
    })
  })
  
  describe('setConfig 设置配置', () => {
    let req, res
    
    beforeEach(() => {
      req = {
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该创建新配置', async () => {
      req.body = {
        config_key: 'new_config',
        config_value: 'new_value',
        description: 'New configuration'
      }
      
      await SystemConfigController.setConfig(req, res)
      
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '配置保存成功',
        data: expect.objectContaining({
          config_key: 'new_config',
          config_value: 'new_value'
        })
      })
    })
    
    it('应该更新已存在的配置', async () => {
      const configData = await TestDataFactory.createSystemConfig({
        config_key: 'existing_key',
        config_value: 'old_value'
      })
      await SystemConfig.create(configData)
      
      req.body = {
        config_key: 'existing_key',
        config_value: 'new_value'
      }
      
      await SystemConfigController.setConfig(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      const updatedConfig = await SystemConfig.findOne({
        where: { config_key: 'existing_key' }
      })
      expect(updatedConfig.config_value).toBe('new_value')
    })
    
    it('应该验证必填字段', async () => {
      req.body = {
        config_value: 'value_only'
        // 缺少config_key
      }
      
      await SystemConfigController.setConfig(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: expect.stringContaining('必填')
      })
    })
  })
  
  describe('updateConfig 更新配置', () => {
    let req, res, testConfig
    
    beforeEach(async () => {
      const configData = await TestDataFactory.createSystemConfig({
        config_key: 'update_test',
        config_value: 'original_value'
      })
      testConfig = await SystemConfig.create(configData)
      
      req = {
        params: { key: 'update_test' },
        body: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该更新配置值', async () => {
      req.body.config_value = 'updated_value'
      
      await SystemConfigController.updateConfig(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      await testConfig.reload()
      expect(testConfig.config_value).toBe('updated_value')
    })
    
    it('应该更新配置描述', async () => {
      req.body.description = 'Updated description'
      
      await SystemConfigController.updateConfig(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      await testConfig.reload()
      expect(testConfig.description).toBe('Updated description')
    })
    
    it('应该返回404当配置不存在', async () => {
      req.params.key = 'nonexistent'
      req.body.config_value = 'new_value'
      
      await SystemConfigController.updateConfig(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
    })
  })
  
  describe('deleteConfig 删除配置', () => {
    let req, res, testConfig
    
    beforeEach(async () => {
      const configData = await TestDataFactory.createSystemConfig({
        config_key: 'delete_test',
        config_value: 'test_value'
      })
      testConfig = await SystemConfig.create(configData)
      
      req = {
        params: { key: 'delete_test' }
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该删除配置', async () => {
      await SystemConfigController.deleteConfig(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '配置删除成功'
      })
      
      const deletedConfig = await SystemConfig.findOne({
        where: { config_key: 'delete_test' }
      })
      expect(deletedConfig).toBeNull()
    })
    
    it('应该返回404当配置不存在', async () => {
      req.params.key = 'nonexistent'
      
      await SystemConfigController.deleteConfig(req, res)
      
      expect(res.status).toHaveBeenCalledWith(404)
    })
  })
  
  describe('batchSetConfigs 批量设置配置', () => {
    let req, res
    
    beforeEach(() => {
      req = {
        body: {
          configs: []
        }
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该批量设置配置', async () => {
      req.body.configs = [
        { config_key: 'key1', config_value: 'value1' },
        { config_key: 'key2', config_value: 'value2' },
        { config_key: 'key3', config_value: 'value3' }
      ]
      
      await SystemConfigController.batchSetConfigs(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      // 验证所有配置都被创建
      for (const config of req.body.configs) {
        const savedConfig = await SystemConfig.findOne({
          where: { config_key: config.config_key }
        })
        expect(savedConfig).toBeTruthy()
        expect(savedConfig.config_value).toBe(config.config_value)
      }
    })
    
    it('应该验证批量配置数组', async () => {
      req.body.configs = []
      
      await SystemConfigController.batchSetConfigs(req, res)
      
      expect(res.status).toHaveBeenCalledWith(400)
    })
    
    it('应该处理部分失败', async () => {
      req.body.configs = [
        { config_key: 'valid_key', config_value: 'valid_value' },
        { config_key: '', config_value: 'invalid' }, // 无效的配置
        { config_key: 'another_key', config_value: 'another_value' }
      ]
      
      await SystemConfigController.batchSetConfigs(req, res)
      
      // 应该返回错误或部分成功的信息
      expect(res.status).toHaveBeenCalled()
    })
  })
  
  describe('getConfigsByCategory 按分类获取配置', () => {
    let req, res
    
    beforeEach(async () => {
      // 创建不同分类的配置
      const configs = [
        { config_key: 'site_name', config_value: 'My Site', category: 'site' },
        { config_key: 'site_logo', config_value: '/logo.png', category: 'site' },
        { config_key: 'email_host', config_value: 'smtp.example.com', category: 'email' },
        { config_key: 'email_port', config_value: '587', category: 'email' }
      ]
      
      for (const config of configs) {
        const configData = await TestDataFactory.createSystemConfig(config)
        await SystemConfig.create(configData)
      }
      
      req = {
        params: {}
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该返回指定分类的配置', async () => {
      req.params.category = 'site'
      
      await SystemConfigController.getConfigsByCategory(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      const responseData = res.json.mock.calls[0][0].data
      
      responseData.configs.forEach(config => {
        expect(config.category).toBe('site')
      })
    })
  })
  
  describe('resetToDefaults 重置为默认值', () => {
    let req, res
    
    beforeEach(async () => {
      // 创建一些自定义配置
      const configs = [
        { config_key: 'custom_key1', config_value: 'custom_value1' },
        { config_key: 'custom_key2', config_value: 'custom_value2' }
      ]
      
      for (const config of configs) {
        const configData = await TestDataFactory.createSystemConfig(config)
        await SystemConfig.create(configData)
      }
      
      req = {}
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该重置配置为默认值', async () => {
      await SystemConfigController.resetToDefaults(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: '已重置为默认配置'
      })
    })
  })
  
  describe('exportConfigs 导出配置', () => {
    let req, res
    
    beforeEach(async () => {
      const configs = [
        { config_key: 'key1', config_value: 'value1' },
        { config_key: 'key2', config_value: 'value2' }
      ]
      
      for (const config of configs) {
        const configData = await TestDataFactory.createSystemConfig(config)
        await SystemConfig.create(configData)
      }
      
      req = {}
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        setHeader: vi.fn(),
        send: vi.fn()
      }
    })
    
    it('应该导出配置为JSON', async () => {
      await SystemConfigController.exportConfigs(req, res)
      
      expect(res.setHeader).toHaveBeenCalled()
      expect(res.send).toHaveBeenCalled()
    })
  })
  
  describe('importConfigs 导入配置', () => {
    let req, res
    
    beforeEach(() => {
      req = {
        body: {
          configs: []
        }
      }
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis()
      }
    })
    
    it('应该导入配置', async () => {
      req.body.configs = [
        { config_key: 'import_key1', config_value: 'import_value1' },
        { config_key: 'import_key2', config_value: 'import_value2' }
      ]
      
      await SystemConfigController.importConfigs(req, res)
      
      expect(res.status).toHaveBeenCalledWith(200)
      
      // 验证配置被导入
      for (const config of req.body.configs) {
        const imported = await SystemConfig.findOne({
          where: { config_key: config.config_key }
        })
        expect(imported).toBeTruthy()
      }
    })
  })
})
