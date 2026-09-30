import AdministrativeRegion from '../models/AdministrativeRegion.js'
import sequelize from '../config/database.js'
import { logger } from '../utils/logger.js'

// Helper to format region data based on locale
const formatRegion = (region, locale) => {
  const name = locale === 'th-TH' ? region.name_local : region.name_alias
  return {
    id: region.id,
    name: name,
    postal_code: region.postal_code,
    level: region.level
  }
}

export const getProvinces = async (req, res) => {
  try {
    const { locale = 'th-TH' } = req.query
    const countryCode = 'TH' // 固定为泰国
    
    const provinces = await AdministrativeRegion.getProvinces(countryCode, locale)
    
    res.json({
      success: true,
      data: provinces
    })
  } catch (error) {
    logger.error('获取省份列表失败', { err: error?.message, stack: error?.stack })
    res.status(500).json({
      success: false,
      message: '获取省份列表失败'
    })
  }
}

export const getDistricts = async (req, res) => {
  try {
    const { id } = req.params
    // 非正整数 id 会让 PG 抛 invalid input syntax（500），提前返回 400
    if (!/^\d+$/.test(String(id)) || Number(id) <= 0) {
      return res.status(400).json({
        success: false,
        message: '无效的区域ID'
      })
    }
    const { locale = 'th-TH' } = req.query
    
    const districts = await AdministrativeRegion.getDistricts(id, locale)
    
    res.json({
      success: true,
      data: districts
    })
  } catch (error) {
    logger.error('获取市区列表失败', { err: error?.message, stack: error?.stack })
    res.status(500).json({
      success: false,
      message: '获取市区列表失败'
    })
  }
}

export const getSubDistricts = async (req, res) => {
  try {
    const { id } = req.params
    // 非正整数 id 会让 PG 抛 invalid input syntax（500），提前返回 400
    if (!/^\d+$/.test(String(id)) || Number(id) <= 0) {
      return res.status(400).json({
        success: false,
        message: '无效的区域ID'
      })
    }
    const { locale = 'th-TH' } = req.query
    
    const subDistricts = await AdministrativeRegion.getSubDistricts(id, locale)
    
    res.json({
      success: true,
      data: subDistricts
    })
  } catch (error) {
    logger.error('获取子区列表失败', { err: error?.message, stack: error?.stack })
    res.status(500).json({
      success: false,
      message: '获取子区列表失败'
    })
  }
}

export const getRegionByPostalCode = async (req, res) => {
  try {
    const { code } = req.params
    const { locale = 'th-TH' } = req.query
    
    const region = await AdministrativeRegion.getByPostalCode(code, locale)
    
    if (!region) {
      return res.status(404).json({
        success: false,
        message: '未找到对应的行政区域'
      })
    }
    
    res.json({
      success: true,
      data: {
        subDistrict: {
          id: region.id,
          name: region.getDisplayName(locale)
        },
        district: {
          id: region.parent?.id,
          name: region.parent?.getDisplayName(locale)
        },
        province: {
          id: region.parent?.parent?.id,
          name: region.parent?.parent?.getDisplayName(locale)
        },
        postal_code: region.postal_code
      }
    })
  } catch (error) {
    logger.error('根据邮编查找行政区域失败', { err: error?.message, stack: error?.stack })
    res.status(500).json({
      success: false,
      message: '查找失败'
    })
  }
}

export const getAllRegions = async (req, res) => {
  try {
    const { locale = 'th-TH' } = req.query
    const countryCode = 'TH'
    
    const regions = await AdministrativeRegion.findAll({
      where: {
        country_code: countryCode,
        is_active: 1
      },
      order: [['level', 'ASC'], ['sort_order', 'ASC']],
      attributes: [
        'id',
        'parent_id',
        'level',
        'name_local',
        'name_alias',
        'postal_code',
        [sequelize.literal(locale === 'th-TH' ? 'name_local' : 'name_alias'), 'name']
      ]
    })
    
    res.json({
      success: true,
      data: regions
    })
  } catch (error) {
    logger.error('获取所有行政区域失败', { err: error?.message, stack: error?.stack })
    res.status(500).json({
      success: false,
      message: '获取数据失败'
    })
  }
}