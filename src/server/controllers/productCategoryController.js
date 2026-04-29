import { Op } from 'sequelize'
import ProductCategory from '../models/ProductCategory.js'
import Product from '../models/Product.js'

class ProductCategoryController {
  /** 前台 / 公共：全部类别，按排序 */
  static async listPublic (req, res) {
    try {
      const rows = await ProductCategory.findAll({
        order: [['sort_order', 'ASC'], ['id', 'ASC']]
      })
      return res.json({ success: true, data: rows })
    } catch (e) {
      console.error('listPublic categories', e)
      return res.status(500).json({ success: false, message: '获取类别列表失败' })
    }
  }

  /** 后台：分页 + 名称模糊筛选 */
  static async listAdmin (req, res) {
    try {
      const keyword = (req.query.keyword || '').trim()
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
      const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10) || 20))
      const offset = (page - 1) * pageSize

      const where = {}
      if (keyword) {
        where.name = { [Op.like]: `%${keyword}%` }
      }

      const { count, rows } = await ProductCategory.findAndCountAll({
        where,
        offset,
        limit: pageSize,
        order: [['sort_order', 'ASC'], ['id', 'ASC']]
      })

      return res.json({
        success: true,
        data: {
          list: rows,
          total: count,
          page,
          pageSize,
          totalPages: Math.ceil(count / pageSize) || 0
        }
      })
    } catch (e) {
      console.error('listAdmin categories', e)
      return res.status(500).json({ success: false, message: '获取类别列表失败' })
    }
  }

  static async create (req, res) {
    try {
      const rawName = req.body.name
      const name = rawName != null ? String(rawName).trim() : ''
      if (!name) {
        return res.status(400).json({ success: false, message: '类别名称不能为空' })
      }
      const sort_order = Number(req.body.sort_order)
      const row = await ProductCategory.create({
        name,
        sort_order: Number.isFinite(sort_order) ? sort_order : 0
      })
      return res.status(201).json({ success: true, data: row })
    } catch (e) {
      console.error('create category', e)
      return res.status(500).json({ success: false, message: '创建类别失败' })
    }
  }

  static async update (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      if (Number.isNaN(id)) {
        return res.status(400).json({ success: false, message: '无效的 ID' })
      }
      const row = await ProductCategory.findByPk(id)
      if (!row) {
        return res.status(404).json({ success: false, message: '类别不存在' })
      }
      const patch = {}
      if (req.body.name !== undefined) {
        const n = String(req.body.name).trim()
        if (!n) {
          return res.status(400).json({ success: false, message: '类别名称不能为空' })
        }
        patch.name = n
      }
      if (req.body.sort_order !== undefined) {
        const s = Number(req.body.sort_order)
        patch.sort_order = Number.isFinite(s) ? s : row.sort_order
      }
      await row.update(patch)
      return res.json({ success: true, data: row })
    } catch (e) {
      console.error('update category', e)
      return res.status(500).json({ success: false, message: '更新类别失败' })
    }
  }

  static async remove (req, res) {
    try {
      const id = parseInt(req.params.id, 10)
      if (Number.isNaN(id)) {
        return res.status(400).json({ success: false, message: '无效的 ID' })
      }
      const row = await ProductCategory.findByPk(id)
      if (!row) {
        return res.status(404).json({ success: false, message: '类别不存在' })
      }
      const n = await Product.count({ where: { category_id: id } })
      if (n > 0) {
        return res.status(400).json({
          success: false,
          message: `该类别下还有 ${n} 个商品，无法删除`
        })
      }
      await row.destroy()
      return res.json({ success: true, message: '已删除' })
    } catch (e) {
      console.error('remove category', e)
      return res.status(500).json({ success: false, message: '删除类别失败' })
    }
  }
}

export default ProductCategoryController
