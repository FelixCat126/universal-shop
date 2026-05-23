import express from 'express'
import ProductCategoryController from '../controllers/productCategoryController.js'
import { cacheGet } from '../utils/responseCache.js'

const router = express.Router()

// 公开类别列表：30s 短缓存，挡得住爬虫连发
router.get('/', cacheGet({ ttlMs: 30_000 }), ProductCategoryController.listPublic)

export default router
