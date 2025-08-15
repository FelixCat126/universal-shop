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

      // 构建完整地址
      const addressParts = [province, city, district, detail_address].filter(Boolean)
      const full_address = addressParts.join('')

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
      const addressParts = [province, city, district, detail_address].filter(Boolean)
      const full_address = addressParts.join('')

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
}

export default AddressController