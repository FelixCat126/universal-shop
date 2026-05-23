import express from 'express'
import AddressController from '../controllers/addressController.js'
import { authenticateToken } from '../middlewares/authMiddleware.js'
import { writeLimiter } from '../middlewares/security.js'

const router = express.Router()

router.use(authenticateToken)

router.get('/', AddressController.getUserAddresses)
router.post('/', writeLimiter, AddressController.createAddress)
router.get('/:id', AddressController.getAddressDetail)
router.put('/:id', writeLimiter, AddressController.updateAddress)
router.put('/:id/default', writeLimiter, AddressController.setDefaultAddress)
router.delete('/:id', writeLimiter, AddressController.deleteAddress)

export default router