import express from 'express'
import AddressController from '../controllers/addressController.js'
import { authenticateToken } from '../middlewares/authMiddleware.js'

const router = express.Router()

// 所有地址路由都需要认证
router.use(authenticateToken)

// 地址管理路由
router.get('/', AddressController.getUserAddresses)        // 获取用户地址列表
router.post('/', AddressController.createAddress)          // 创建新地址
router.get('/:id', AddressController.getAddressDetail)     // 获取地址详情
router.put('/:id', AddressController.updateAddress)        // 更新地址
router.put('/:id/default', AddressController.setDefaultAddress)  // 设置默认地址
router.delete('/:id', AddressController.deleteAddress)     // 删除地址

export default router