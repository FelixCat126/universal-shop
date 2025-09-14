import express from 'express'
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
router.get('/all', getAllRegions) // For admin or initial data load

export default router