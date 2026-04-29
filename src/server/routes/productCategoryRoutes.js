import express from 'express'
import ProductCategoryController from '../controllers/productCategoryController.js'

const router = express.Router()

router.get('/', ProductCategoryController.listPublic)

export default router
