import Address from '../models/Address.js'
import User from '../models/User.js'
import sequelize from '../config/database.js'

class AddressController {
  // 获取用户地址列表
  static async getUserAddresses(req, res) {
    try {
      const userId = req.user?.userId
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: '用户未登录'
        })
      }

      const addresses = await Address.findAll({
        where: { user_id: userId },
        order: [['is_default', 'DESC'], ['created_at', 'DESC']]
      })

      res.json({
        success: true,
        data: addresses
      })

    } catch (error) {
      console.error('获取地址列表失败:', error)
      res.status(500).json({
        success: false,
        message: '获取地址列表失败',
        error: error.message
      })
    }
  }

  // 创建新地址
  static async createAddress(req, res) {
    const transaction = await sequelize.transaction()
    
    try {
      const userId = req.user?.userId
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: '用户未登录'
        })
      }

      const {
        contact_name,
        contact_country_code = '+86',
        contact_phone,
        province,
        city,
        district,
        detail_address,
        postal_code,
        is_default = false,
        address_type = 'home'
      } = req.body

      // 验证必填字段
      if (!contact_name || !contact_phone || !detail_address) {
        return res.status(400).json({
          success: false,
          message: '收货人姓名、电话和详细地址为必填项'
        })
      }

      // 验证国家区号
      const supportedCountries = ['+86', '+66', '+60']
      if (!supportedCountries.includes(contact_country_code)) {
        return res.status(400).json({
          success: false,
          message: '不支持的国家区号'
        })
      }

      // 验证手机号格式和长度
      const phoneRegex = /^[1-9]\d+$/
      if (!phoneRegex.test(contact_phone)) {
        return res.status(400).json({
          success: false,
          message: '手机号必须为纯数字且不能以0开头'
        })
      }

      // 根据国家区号验证手机号长度
      let minLength
      let countryName
      switch (contact_country_code) {
        case '+86':
          minLength = 11
          countryName = '中国'
          break
        case '+60':
          minLength = 9
          countryName = '马来西亚'
          break
        case '+66':
          minLength = 9
          countryName = '泰国'
          break
      }

      if (contact_phone.length < minLength) {
        return res.status(400).json({
          success: false,
          message: `${countryName}手机号必须不少于${minLength}位数字`
        })
      }

      // 构建完整地址
      const addressParts = [province, city, district].filter(Boolean)
      const regionPart = addressParts.join(' ')
      const full_address = regionPart ? `${regionPart} ${detail_address}` : detail_address

      // 如果设置为默认地址，先取消其他默认地址
      if (is_default) {
        await Address.update(
          { is_default: false },
          { 
            where: { user_id: userId, is_default: true },
            transaction 
          }
        )
      }

      // 创建新地址
      const address = await Address.create({
        user_id: userId,
        contact_name,
        contact_country_code,
        contact_phone,
        province,
        city,
        district,
        detail_address,
        full_address,
        postal_code,
        is_default,
        address_type
      }, { transaction })

      await transaction.commit()

      res.status(201).json({
        success: true,
        message: '地址添加成功',
        data: address
      })

    } catch (error) {
      await transaction.rollback()
      console.error('创建地址失败:', error)
      res.status(500).json({
        success: false,
        message: '创建地址失败',
        error: error.message
      })
    }
  }

  // 更新地址
  static async updateAddress(req, res) {
    const transaction = await sequelize.transaction()
    
    try {
      const userId = req.user?.userId
      const { id } = req.params

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: '用户未登录'
        })
      }

      const {
        contact_name,
        contact_country_code = '+86',
        contact_phone,
        province,
        city,
        district,
        detail_address,
        postal_code,
        is_default = false,
        address_type = 'home'
      } = req.body

      // 验证必填字段
      if (!contact_name || !contact_phone || !detail_address) {
        return res.status(400).json({
          success: false,
          message: '收货人姓名、电话和详细地址为必填项'
        })
      }

      // 验证国家区号
      const supportedCountries = ['+86', '+66', '+60']
      if (!supportedCountries.includes(contact_country_code)) {
        return res.status(400).json({
          success: false,
          message: '不支持的国家区号'
        })
      }

      // 验证手机号格式和长度
      const phoneRegex = /^[1-9]\d+$/
      if (!phoneRegex.test(contact_phone)) {
        return res.status(400).json({
          success: false,
          message: '手机号必须为纯数字且不能以0开头'
        })
      }

      // 根据国家区号验证手机号长度
      let minLength
      let countryName
      switch (contact_country_code) {
        case '+86':
          minLength = 11
          countryName = '中国'
          break
        case '+60':
          minLength = 9
          countryName = '马来西亚'
          break
        case '+66':
          minLength = 9
          countryName = '泰国'
          break
      }

      if (contact_phone.length < minLength) {
        return res.status(400).json({
          success: false,
          message: `${countryName}手机号必须不少于${minLength}位数字`
        })
      }

      // 查找地址
      const address = await Address.findOne({
        where: { id, user_id: userId }
      })

      if (!address) {
        return res.status(404).json({
          success: false,
          message: '地址不存在'
        })
      }

      // 构建完整地址
      const addressParts = [province, city, district].filter(Boolean)
      const regionPart = addressParts.join(' ')
      const full_address = regionPart ? `${regionPart} ${detail_address}` : detail_address

      // 如果设置为默认地址，先取消其他默认地址
      if (is_default && !address.is_default) {
        await Address.update(
          { is_default: false },
          { 
            where: { user_id: userId, is_default: true },
            transaction 
          }
        )
      }

      // 更新地址
      await address.update({
        contact_name,
        contact_country_code,
        contact_phone,
        province,
        city,
        district,
        detail_address,
        full_address,
        postal_code,
        is_default,
        address_type
      }, { transaction })

      await transaction.commit()

      res.json({
        success: true,
        message: '地址更新成功',
        data: address
      })

    } catch (error) {
      await transaction.rollback()
      console.error('更新地址失败:', error)
      res.status(500).json({
        success: false,
        message: '更新地址失败',
        error: error.message
      })
    }
  }

  // 设置默认地址
  static async setDefaultAddress(req, res) {
    const transaction = await sequelize.transaction()
    
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
      })

      if (!address) {
        return res.status(404).json({
          success: false,
          message: '地址不存在'
        })
      }

      // 取消所有默认地址
      await Address.update(
        { is_default: false },
        { 
          where: { user_id: userId },
          transaction 
        }
      )

      // 设置当前地址为默认
      await address.update(
        { is_default: true },
        { transaction }
      )

      await transaction.commit()

      res.json({
        success: true,
        message: '默认地址设置成功',
        data: address
      })

    } catch (error) {
      await transaction.rollback()
      console.error('设置默认地址失败:', error)
      res.status(500).json({
        success: false,
        message: '设置默认地址失败',
        error: error.message
      })
    }
  }

  // 删除地址
  static async deleteAddress(req, res) {
    const transaction = await sequelize.transaction()
    
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
      })

      if (!address) {
        return res.status(404).json({
          success: false,
          message: '地址不存在'
        })
      }

      const wasDefault = address.is_default

      // 删除地址
      await address.destroy({ transaction })

      // 如果删除的是默认地址，自动设置第一个其他地址为默认
      if (wasDefault) {
        const firstAddress = await Address.findOne({
          where: { user_id: userId },
          order: [['created_at', 'ASC']],
          transaction
        })

        if (firstAddress) {
          await firstAddress.update({ is_default: true }, { transaction })
        }
      }

      await transaction.commit()

      res.json({
        success: true,
        message: '地址删除成功'
      })

    } catch (error) {
      await transaction.rollback()
      console.error('删除地址失败:', error)
      res.status(500).json({
        success: false,
        message: '删除地址失败',
        error: error.message
      })
    }
  }

  // 获取地址详情
  static async getAddressDetail(req, res) {
    try {
      const userId = req.user?.userId
      const { id } = req.params

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: '用户未登录'
        })
      }

      const address = await Address.findOne({
        where: { id, user_id: userId }
      })

      if (!address) {
        return res.status(404).json({
          success: false,
          message: '地址不存在'
        })
      }

      res.json({
        success: true,
        data: address
      })

    } catch (error) {
      console.error('获取地址详情失败:', error)
      res.status(500).json({
        success: false,
        message: '获取地址详情失败',
        error: error.message
      })
    }
  }

  // 管理员获取指定用户的地址列表
  static async getAdminUserAddresses(req, res) {
    try {
      const { userId } = req.params

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: '用户ID不能为空'
        })
      }

      // 验证用户是否存在
      const user = await User.findByPk(userId)
      if (!user) {
        return res.status(404).json({
          success: false,
          message: '用户不存在'
        })
      }

      const addresses = await Address.findAll({
        where: { user_id: userId },
        order: [['is_default', 'DESC'], ['created_at', 'DESC']]
      })

      res.json({
        success: true,
        data: addresses
      })

    } catch (error) {
      console.error('获取用户地址列表失败:', error)
      res.status(500).json({
        success: false,
        message: '获取用户地址列表失败',
        error: error.message
      })
    }
  }
}

export default AddressController