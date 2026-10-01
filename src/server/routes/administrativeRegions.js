import express from 'express'
import { cacheGet } from '../utils/responseCache.js'
import {
  getProvinces,
  getDistricts,
  getSubDistricts,
  getRegionByPostalCode,
  getAllRegions
} from '../controllers/administrativeRegionController.js'

const router = express.Router()

router.get('/provinces', getProvinces)
router.get('/provinces/:id/districts', getDistricts)
router.get('/districts/:id/sub-districts', getSubDistricts)
router.get('/postal-code/:code', getRegionByPostalCode)
// 行政区划数据近乎静态且当前无写入口：/all 全量挂 300s 缓存，变更后最长 5 分钟自然过期
router.get('/all', cacheGet({ ttlMs: 300_000 }), getAllRegions) // For admin or initial data load

export default router