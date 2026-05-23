import express from 'express'
import PartnerPortalController from '../controllers/partnerPortalController.js'
import { authenticatePartner } from '../middlewares/partnerAuthMiddleware.js'
import { loginLimiter, writeLimiter } from '../middlewares/security.js'
import { validate, createPartnerOrderSchema } from '../middlewares/validate.js'
import { requireCaptchaAfterFailures } from '../middlewares/loginGuard.js'

const router = express.Router()

router.post('/login', loginLimiter, requireCaptchaAfterFailures(), PartnerPortalController.login)

router.use(authenticatePartner)
/** 写操作（下单/确认支付/地址写）走更严的限流 */
router.use(['/orders', '/addresses'], writeLimiter)
router.get('/addresses', PartnerPortalController.listAddresses)
router.post('/addresses', PartnerPortalController.createAddress)
router.put('/addresses/:id/default', PartnerPortalController.setDefaultAddress)
router.put('/addresses/:id', PartnerPortalController.updateAddress)
router.delete('/addresses/:id', PartnerPortalController.deleteAddress)
router.get('/me', PartnerPortalController.me)
router.get('/products', PartnerPortalController.listProducts)
router.post('/orders', validate({ body: createPartnerOrderSchema }), PartnerPortalController.createOrder)
router.post('/orders/:id/confirm-payment', PartnerPortalController.confirmPartnerOrderPayment)
router.get('/orders', PartnerPortalController.listMyOrders)
router.get('/orders/:id', PartnerPortalController.orderDetail)

export default router
