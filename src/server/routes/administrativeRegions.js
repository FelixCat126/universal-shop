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

// 第 49 轮：这几个接口**每次打开地址表单都要打**（客户端与合作方端各一处），
// 数据近乎静态却一直没缓存（同一个文件里的 /all 反而有 300s 缓存）→ 补齐。
router.get('/provinces', cacheGet({ ttlMs: 300_000 }), getProvinces)
router.get('/provinces/:id/districts', cacheGet({ ttlMs: 300_000 }), getDistricts)
router.get('/districts/:id/sub-districts', cacheGet({ ttlMs: 300_000 }), getSubDistricts)
router.get('/postal-code/:code', getRegionByPostalCode)
// 行政区划数据近乎静态且当前无写入口：/all 全量挂 300s 缓存，变更后最长 5 分钟自然过期
router.get('/all', cacheGet({ ttlMs: 300_000 }), getAllRegions) // For admin or initial data load

export default router