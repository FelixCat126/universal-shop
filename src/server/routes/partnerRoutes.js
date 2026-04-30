import express from 'express'
import PartnerPortalController from '../controllers/partnerPortalController.js'
import { authenticatePartner } from '../middlewares/partnerAuthMiddleware.js'

const router = express.Router()

router.post('/login', PartnerPortalController.login)

router.use(authenticatePartner)
router.get('/addresses', PartnerPortalController.listAddresses)
router.post('/addresses', PartnerPortalController.createAddress)
router.put('/addresses/:id/default', PartnerPortalController.setDefaultAddress)
router.put('/addresses/:id', PartnerPortalController.updateAddress)
router.delete('/addresses/:id', PartnerPortalController.deleteAddress)
router.get('/me', PartnerPortalController.me)
router.get('/products', PartnerPortalController.listProducts)
router.post('/orders', PartnerPortalController.createOrder)
router.post('/orders/:id/confirm-payment', PartnerPortalController.confirmPartnerOrderPayment)
router.get('/orders', PartnerPortalController.listMyOrders)
router.get('/orders/:id', PartnerPortalController.orderDetail)

export default router
