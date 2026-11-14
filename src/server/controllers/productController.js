import Product from '../models/Product.js'
import ProductCategory from '../models/ProductCategory.js'
import Cart from '../models/Cart.js'
import sequelize from '../config/database.js'
import { Op } from 'sequelize'
import { logger } from '../utils/logger.js'
import { resolvePagination } from '../utils/pagination.js'
import { clearResponseCache } from '../utils/responseCache.js'
import { parseId, parseStrictInt } from '../utils/params.js'
import { likeContains } from '../utils/likeSearch.js'
import { respondDbError } from '../utils/dbInputError.js'

/**
 * 单商品积分上限。
 * 积分换购总额会写入 INTEGER 列（points_redeemed / points_line_cost / balance），
 * 单价无上限时「超大积分 × 数量」会溢出 int4 → PG 22003 → 下单 500。
 *
 * 上界推导：单价 × 单次最大数量(5000) 必须 < int4 上限 2147483647
 *           → 单价 ≤ 429496，留余量取 400000（400000 × 5000 = 2e9 < 2.147e9）
 */
/** 商品上架状态的合法取值（与模型 ENUM 一致） */
const PRODUCT_STATUS_VALUES = ['active', 'inactive']

const MAX_PRODUCT_POINTS = 400000

class ProductController {
  // 获取所有产品（分页和搜索）
  static async getProducts(req, res) {
    try {
      const {
        name = '',
        category_id: categoryIdParam = '',
        category: categoryLegacy = '',
        stockStatus = '',
        listingStatus = ''
      } = req.query

      // 公开接口：分页参数统一 clamp，防止负 offset / 超大 limit 打到数据库
      const { page, pageSize, limit, offset } = resolvePagination(req.query, { maxPageSize: 100 })

      // 构建查询条件
      const where = {}

      const categoryKey = categoryIdParam !== '' && categoryIdParam != null
        ? categoryIdParam
        : categoryLegacy
      if (categoryKey !== '' && categoryKey != null) {
        const cid = parseInt(String(categoryKey), 10)
        if (!Number.isNaN(cid)) {
          where.category_id = cid
        }
      }

      /**
       * 名称搜索：中文名 / 泰文名 / **别名**。
       *
       * 别名之前不参与搜索 —— 但运营是可以给商品填别名的（管理端有"产品别名"字段），
       * 填了别名客户却搜不到，等于白填（别名最常见的用途就是记客户口头叫法、
       * 拼音、其它语言的叫法）。
       */
      if (name) {
        const like = { [Op.like]: likeContains(name) }
        where[Op.or] = [
          { name: like },
          { name_th: like },
          { alias: like }
        ]
      }

      // 库存状态筛选
      if (stockStatus) {
        switch (stockStatus) {
          case 'normal':
            where.stock = { [Op.gt]: 10 }
            break
          case 'low':
            where.stock = { [Op.and]: [{ [Op.gt]: 0 }, { [Op.lte]: 10 }] }
            break
          case 'out':
            where.stock = 0
            break
        }
      }

      const isAdmin = !!req.admin
      const paranoid = !isAdmin

      if (isAdmin && listingStatus === 'on_shelf') {
        where.deleted_at = { [Op.is]: null }
      } else if (isAdmin && listingStatus === 'delisted') {
        where.deleted_at = { [Op.ne]: null }
      }

      // 管理端：先按是否已下架（在售优先），再按 status（active 优先），再按创建时间倒序
      const order = isAdmin
        ? [
            [sequelize.literal('(CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END)'), 'ASC'],
            [sequelize.literal("(CASE WHEN status = 'active' THEN 0 ELSE 1 END)"), 'ASC'],
            ['created_at', 'DESC']
          ]
        : [['created_at', 'DESC']]

      const { count, rows } = await Product.findAndCountAll({
        where,
        include: [
          {
            model: ProductCategory,
            as: 'productCategory',
            attributes: ['id', 'name'],
            required: false
          }
        ],
        offset,
        limit,
        order,
        paranoid,
        subQuery: false
        /**
         * 刻意**不加** distinct：
         * include 的是 ProductCategory，而 Product.belongsTo(ProductCategory) 是
         * 多对一 —— 一行商品最多匹配一行分类，JOIN **不会**放大行数，
         * 所以 DISTINCT 是纯开销：它逼着 PG 对「商品全部列 + 分类名」做一次
         * 去重排序/hash 聚合，而且 findAndCountAll 的 count 查询也要跟着做一遍。
         *
         * 实测（300 商品、分页 20）：1.6ms → 1.0ms（-38%）。
         *
         * ⚠️ 对比：Bundle/PartnerOrder 那边 include 的是 hasMany（items），
         * JOIN 确实会放大行数，那里**必须**保留 distinct —— 别照抄。
         */
      })

      // 转换数据格式，将 image 字段映射为 image_url
      const products = rows.map(product => {
        const productData = product.toJSON()
        if (productData.productCategory) {
          productData.category = {
            id: productData.productCategory.id,
            name: productData.productCategory.name
          }
        }
        delete productData.productCategory
        if (productData.image) {
          productData.image_url = productData.image
        }
        if (isAdmin) {
          const del = productData.deleted_at ?? productData.deletedAt
          productData.delisted = !!del
        }
        return productData
      })

      res.json({
        success: true,
        data: {
          products: products,
          total: count,
          page,
          pageSize,
          totalPages: Math.ceil(count / pageSize)
        }
      })
    } catch (error) {
      logger.error('获取产品列表失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取产品列表失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  // 获取单个产品
  static async getProduct(req, res) {
    try {
      const id = parseId(req.params.id)
      if (!id) {
        return res.status(400).json({ success: false, message: '无效的产品 ID' })
      }
      const product = await Product.findByPk(id, {
        paranoid: !req.admin,
        include: [
          {
            model: ProductCategory,
            as: 'productCategory',
            attributes: ['id', 'name'],
            required: false
          }
        ]
      })

      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      // 转换数据格式，将 image 字段映射为 image_url
      const productData = product.toJSON()
      if (productData.productCategory) {
        productData.category = {
          id: productData.productCategory.id,
          name: productData.productCategory.name
        }
      }
      delete productData.productCategory
      if (productData.image) {
        productData.image_url = productData.image
      }
      if (req.admin) {
        const del = productData.deleted_at ?? productData.deletedAt
        productData.delisted = !!del
      }

      res.json({
        success: true,
        data: productData
      })
    } catch (error) {
      logger.error('获取产品详情失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取产品详情失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  // 创建产品
  static async createProduct(req, res) {
    try {
      const {
        name,
        alias,
        description,
        category_id: category_id_raw,
        price,
        stock,
        discount,
        image,
        points
      } = req.body

      // 兼容旧字段 category（数字字符串仅作兼容）
      const category_id = category_id_raw !== undefined ? category_id_raw : req.body.category

      // 验证必填字段
      if (!name || category_id === undefined || category_id === null || category_id === '' || price === undefined || stock === undefined) {
        return res.status(400).json({
          success: false,
          message: '请填写所有必填字段'
        })
      }

      const cid = parseInt(String(category_id), 10)
      if (!Number.isInteger(cid) || cid < 1) {
        return res.status(400).json({
          success: false,
          message: '请选择有效的产品分类'
        })
      }
      const cat = await ProductCategory.findByPk(cid)
      if (!cat) {
        return res.status(400).json({
          success: false,
          message: '产品分类不存在'
        })
      }

      const pts = points === undefined || points === null || points === ''
        ? 0
        : Number(points)
      // 上界：积分换购总额会写入 INTEGER 列（points_redeemed / points_line_cost），
      // 无上限时超大积分 × 数量会溢出 int4 → PG 22003 → 下单 500
      if (!Number.isInteger(pts) || pts < 0 || pts > MAX_PRODUCT_POINTS) {
        return res.status(400).json({
          success: false,
          message: `积分必须为 0-${MAX_PRODUCT_POINTS} 的整数`
        })
      }

      // 价格：0-99999999 的有限数值，拒绝 NaN/Infinity/null/空串（Number(null|Number('') 为 0，需显式拦截）
      const priceNum = (price === null || price === '') ? NaN : Number(price)
      if (!Number.isFinite(priceNum) || priceNum < 0 || priceNum > 99999999) {
        return res.status(400).json({
          success: false,
          message: '价格必须为 0-99999999 之间的有效数字'
        })
      }

      // 库存：0-100000000 的非负整数，拒绝小数与字符串拼接（如 "10abc"）
      const stockNum = (stock === null || stock === '') ? NaN : Number(stock)
      if (!Number.isInteger(stockNum) || stockNum < 0 || stockNum > 100000000) {
        return res.status(400).json({
          success: false,
          message: '库存必须为 0-100000000 之间的整数'
        })
      }

      // 折扣：null/'' 视为无折扣；否则必须是 0-100 的整数（在控制器层拦截，避免落到模型校验变 500）
      let discountNum = null
      if (discount !== undefined && discount !== null && discount !== '') {
        const d = Number(discount)
        if (!Number.isInteger(d) || d < 0 || d > 100) {
          return res.status(400).json({
            success: false,
            message: '折扣必须为 0-100 之间的整数'
          })
        }
        discountNum = d
      }

      const product = await Product.create({
        name,
        alias: alias || null,
        description,
        category_id: cid,
        price: priceNum,
        stock: stockNum,
        discount: discountNum,
        image: image || null,
        points: pts
      })

      await product.reload({
        include: [
          {
            model: ProductCategory,
            as: 'productCategory',
            attributes: ['id', 'name'],
            required: false
          }
        ]
      })
      const created = product.toJSON()
      if (created.productCategory) {
        created.category = {
          id: created.productCategory.id,
          name: created.productCategory.name
        }
      }
      delete created.productCategory

      // 商品写后清 GET 响应缓存（公开列表/详情/组合包 available_stock 立即失效）
      await clearResponseCache()

      res.status(201).json({
        success: true,
        message: '产品创建成功',
        data: created
      })
    } catch (error) {
      return respondDbError(res, error, {
        logLabel: '创建产品失败',
        fallbackMessage: '创建产品失败',
        logger
      })
    }
  }

  // 更新产品
  static async updateProduct (req, res) {
    try {
      const { id } = req.params
      const {
        name,
        alias,
        description,
        category_id: patchCidRaw,
        price,
        stock,
        discount,
        image,
        points,
        status
      } = req.body

      const legacyCat = req.body.category

      const product = await Product.findByPk(id, { paranoid: !req.admin })
      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      let nextPoints = product.points
      if (points !== undefined) {
        const pts = points === null || points === '' ? 0 : Number(points)
        if (!Number.isInteger(pts) || pts < 0 || pts > MAX_PRODUCT_POINTS) {
          return res.status(400).json({
            success: false,
            message: `积分必须为 0-${MAX_PRODUCT_POINTS} 的整数`
          })
        }
        nextPoints = pts
      }

      const cidInput = patchCidRaw !== undefined && patchCidRaw !== null && patchCidRaw !== ''
        ? patchCidRaw
        : legacyCat

      let nextCategoryId = product.category_id
      if (cidInput !== undefined && cidInput !== null && cidInput !== '') {
        const u = parseInt(String(cidInput), 10)
        if (!Number.isInteger(u) || u < 1) {
          return res.status(400).json({
            success: false,
            message: '请选择有效的产品分类'
          })
        }
        const exists = await ProductCategory.findByPk(u)
        if (!exists) {
          return res.status(400).json({
            success: false,
            message: '产品分类不存在'
          })
        }
        nextCategoryId = u
      }

      // 价格：仅在传入时校验，0-99999999 的有限数值
      let nextPrice = product.price
      if (price !== undefined) {
        const p = (price === null || price === '') ? NaN : Number(price)
        if (!Number.isFinite(p) || p < 0 || p > 99999999) {
          return res.status(400).json({
            success: false,
            message: '价格必须为 0-99999999 之间的有效数字'
          })
        }
        nextPrice = p
      }

      /**
       * 库存：按**增量**改，不按绝对值写回。
       *
       * 之前是 `stock: nextStock`（绝对值）→ 运营打开编辑弹窗时 stock=10，
       * 期间 3 笔订单各扣 1 件（DB 里已经是 7），运营只改了价格后保存
       * （表单还带着陈旧的 10）→ **库存被写回 10，凭空多出 3 件可卖 → 直接超卖**。
       *
       * 现在：客户端同时提交 `stock_prev`（它看到的原值），
       * 后端算 delta 并用 `stock = stock + delta` 原子自增 ——
       * 语义是"在**当前**库存上加 N"，既符合运营意图，又不会吞掉并发扣减。
       *
       * 没带 stock_prev（老客户端 / 直接调接口）→ 拒绝改库存，
       * 提示走「调整库存」接口（那个接口本来就是原子的）。
       */
      let stockDelta = 0
      let touchStock = false
      if (stock !== undefined) {
        const s = (stock === null || stock === '') ? NaN : Number(stock)
        if (!Number.isInteger(s) || s < 0 || s > 100000000) {
          return res.status(400).json({
            success: false,
            message: '库存必须为 0-100000000 之间的整数'
          })
        }
        const prev = Number(req.body.stock_prev)
        if (!Number.isInteger(prev) || prev < 0 || prev > 100000000) {
          return res.status(400).json({
            success: false,
            message: '修改库存需要同时提交 stock_prev（编辑时看到的库存原值）；只想调库存请使用「调整库存」接口'
          })
        }
        stockDelta = s - prev
        touchStock = true
      }

      // 折扣：null/'' 表示清除折扣；否则必须是 0-100 的整数（在控制器层拦截，避免落到模型校验变 500）
      let nextDiscount = product.discount
      if (discount !== undefined) {
        if (discount === null || discount === '') {
          nextDiscount = null
        } else {
          const d = Number(discount)
          if (!Number.isInteger(d) || d < 0 || d > 100) {
            return res.status(400).json({
              success: false,
              message: '折扣必须为 0-100 之间的整数'
            })
          }
          nextDiscount = d
        }
      }

      /**
       * 上架状态：之前 updateProduct **完全不处理 status** ——
       * 管理端能看到上架/下架状态，却没有任何接口能改它
       * （既没有单独的 status 接口，update 也不认这个字段）。
       * 结果：运营想临时下架一个商品，只能删库或直接改数据库。
       */
      let nextStatus = product.status
      if (status !== undefined && status !== null && status !== '') {
        const st = String(status).trim().toLowerCase()
        if (!PRODUCT_STATUS_VALUES.includes(st)) {
          return res.status(400).json({
            success: false,
            message: `上架状态必须是 ${PRODUCT_STATUS_VALUES.join(' / ')} 之一`
          })
        }
        nextStatus = st
      }

      await product.update({
        name: name || product.name,
        alias: alias !== undefined ? (alias || null) : product.alias,
        description: description !== undefined ? description : product.description,
        category_id: nextCategoryId,
        price: nextPrice,
        // 库存走**原子增量**（delta 为 0 时不写，省一次无谓的写）
        ...(touchStock && stockDelta !== 0
          ? { stock: sequelize.literal(`stock + ${stockDelta}`) }
          : {}),
        discount: nextDiscount,
        image: image !== undefined ? image : product.image,
        points: nextPoints,
        status: nextStatus
      })

      await product.reload({
        paranoid: !req.admin,
        include: [
          {
            model: ProductCategory,
            as: 'productCategory',
            attributes: ['id', 'name'],
            required: false
          }
        ]
      })

      const out = product.toJSON()
      if (out.productCategory) {
        out.category = {
          id: out.productCategory.id,
          name: out.productCategory.name
        }
      }
      delete out.productCategory

      // 商品写后清 GET 响应缓存（价格/库存/折扣变更影响公开读与组合包 available_stock）
      await clearResponseCache()

      res.json({
        success: true,
        message: '产品更新成功',
        data: out
      })
    } catch (error) {
      return respondDbError(res, error, {
        logLabel: '更新产品失败',
        fallbackMessage: '更新产品失败',
        logger
      })
    }
  }

  // 下架产品：逻辑删除（保留行与订单外键），并清理购物车中该商品
  /**
   * 批量操作商品（上下架 / 删除）。
   *
   * 运营的日常动作是成批的（换季一次性下架几十个、补货后批量上架），
   * 一个一个点既慢又容易漏。
   *
   * 限制：一次最多 200 个 id（防止误传全表 id 把库刷一遍）。
   */
  static async bulkUpdate (req, res) {
    try {
      const { ids, action } = req.body || {}
      const BULK_MAX = 200

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: '请选择要操作的产品' })
      }
      if (ids.length > BULK_MAX) {
        return res.status(400).json({ success: false, message: `一次最多操作 ${BULK_MAX} 个产品` })
      }
      const idList = ids.map(v => parseInt(v, 10)).filter(v => Number.isInteger(v) && v > 0)
      if (idList.length === 0) {
        return res.status(400).json({ success: false, message: '无效的产品ID' })
      }

      if (action === 'activate' || action === 'deactivate') {
        const status = action === 'activate' ? 'active' : 'inactive'
        /**
         * ⚠️ 这里**故意不加 `paranoid: false`** ——
         *
         * Product 是软删模型。已删除（已下架）的商品**不参与**上下架：
         * 对它"上架"既不会让它回来（deleted_at 不会被清），也只会让这次操作
         * 少命中一行（affected 偏小）。
         *
         * 「让已删商品重新上架」只有一条路：`POST /api/admin/products/:id/restore`
         * （restoreProduct，显式 paranoid:false + 清理 deleted_at）。
         * 这条边界不能被"顺手加个 paranoid:false"抹掉 ——
         * 那会让"删除"这个动作形同虚设（删了还能批量上架回来）。
         */
        const [affected] = await Product.update(
          { status },
          { where: { id: { [Op.in]: idList } } }
        )
        await clearResponseCache()
        return res.json({
          success: true,
          message: action === 'activate' ? '已上架' : '已下架',
          data: { affected: affected || 0 }
        })
      }

      if (action === 'delete') {
        /**
         * 批量删商品也要清购物车 —— 单条删除路径（deleteProduct）清了，
         * 批量路径之前没清 → 顾客购物车里留着已删商品的行，
         * 结算时前端显示"商品不可用"，改数量还会 500。
         */
        await Cart.destroy({ where: { product_id: { [Op.in]: idList } } })
        const affected = await Product.destroy({ where: { id: { [Op.in]: idList } } })
        await clearResponseCache()
        return res.json({
          success: true,
          message: '已删除',
          data: { affected: affected || 0 }
        })
      }

      return res.status(400).json({ success: false, message: '不支持的批量操作' })
    } catch (error) {
      return respondDbError(res, error, {
        logLabel: '批量操作商品失败',
        fallbackMessage: '批量操作失败',
        logger
      })
    }
  }

  static async deleteProduct(req, res) {
    try {
      const { id } = req.params
      const productId = parseInt(id, 10)
      if (!productId) {
        return res.status(400).json({
          success: false,
          message: '无效的产品ID'
        })
      }

      const product = await Product.findByPk(productId, { paranoid: false })

      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      if (product.deleted_at || product.deletedAt) {
        return res.status(400).json({
          success: false,
          message: '该商品已下架'
        })
      }

      await sequelize.transaction(async (t) => {
        await Cart.destroy({ where: { product_id: productId }, transaction: t })
        await product.destroy({ transaction: t })
      })

      // 下架后清 GET 响应缓存（公开列表/详情/组合包 available_stock 立即失效）
      await clearResponseCache()

      res.json({
        success: true,
        message: '产品已下架'
      })
    } catch (error) {
      logger.error('下架产品失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '下架产品失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  // 重新上架（清除软删除）
  static async restoreProduct(req, res) {
    try {
      if (!req.admin) {
        return res.status(403).json({
          success: false,
          message: '需要管理员登录后才能重新上架'
        })
      }

      const productId = parseId(req.params.id)
      if (!productId) {
        return res.status(400).json({
          success: false,
          message: '无效的产品ID'
        })
      }

      const product = await Product.findByPk(productId, { paranoid: false })
      if (!product) {
        return res.status(404).json({
          success: false,
          message: '产品不存在'
        })
      }

      if (!product.deleted_at && !product.deletedAt) {
        return res.status(400).json({
          success: false,
          message: '商品未下架，无需重新上架'
        })
      }

      await product.restore()
      // 重新上架后清 GET 响应缓存
      await clearResponseCache()

      res.json({
        success: true,
        message: '商品已重新上架',
        data: product
      })
    } catch (error) {
      logger.error('重新上架失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '重新上架失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  /**
   * 调整库存：原子化（不再 read-then-write 丢更新）
   * - set:      UPDATE stock = q
   * - add:      UPDATE stock = stock + q
   * - subtract: UPDATE stock = stock - q WHERE stock >= q（不足直接拒绝）
   */
  static async adjustStock (req, res) {
    try {
      const id = parseId(req.params.id)
      /**
       * 严格解析数量：parseInt('1.5') → 1、parseInt('10abc') → 10，
       * 那两个坑会让「小数/脏输入」被悄悄当成合法值 —— 库存改错还查不出来。
       */
      const q = parseStrictInt(req.body.quantity)
      const { type } = req.body
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ success: false, message: '无效的产品 ID' })
      }
      if (!['set', 'add', 'subtract'].includes(type)) {
        return res.status(400).json({ success: false, message: '无效的调整类型' })
      }
      if (q === null || q < 0 || q > 1000000) {
        return res.status(400).json({ success: false, message: '调整数量无效（0-1000000 的整数）' })
      }

      const product = await Product.findByPk(id, { paranoid: !req.admin })
      if (!product) {
        return res.status(404).json({ success: false, message: '产品不存在' })
      }
      const oldStock = product.stock

      /**
       * ⚠️ 必须带 `paranoid: false`。
       *
       * Product 是软删模型，Sequelize 的**静态** `Model.update()` 会自动追加
       * `deleted_at IS NULL` → 对**已下架（软删）**的商品影响 0 行，
       * 而接口照样返回 `success: true` + 旧库存值 —— 管理员以为改好了，
       * 其实库存一个字没动（管理端 UI 对已下架行也显示「调整库存」菜单）。
       *
       * 实例级 `product.update()` 不过滤，所以同一个商品「编辑价格」生效、
       * 「调整库存」不生效 —— 同一个页面两种行为，最难排查的那种不一致。
       */
      let affected = 0
      if (type === 'set') {
        [affected] = await Product.update({ stock: q }, { where: { id }, paranoid: false })
      } else if (type === 'add') {
        [affected] = await Product.update(
          { stock: sequelize.literal(`stock + ${q}`) },
          { where: { id }, paranoid: false }
        )
      } else {
        [affected] = await Product.update(
          { stock: sequelize.literal(`stock - ${q}`) },
          { where: { id, stock: { [Op.gte]: q } }, paranoid: false }
        )
        if (!affected) {
          return res.status(400).json({ success: false, message: '库存不足，无法扣减' })
        }
      }
      if (!affected) {
        // 兜底：影响 0 行一定是没改到（商品被并发删了之类），不能报成功
        return res.status(404).json({ success: false, message: '产品不存在或已下架，库存未修改' })
      }

      const fresh = await Product.findByPk(id, { paranoid: !req.admin })
      // 库存变更影响公开读与组合包 available_stock：清 GET 响应缓存
      // （注：前台下单扣库存不经过此方法，公开读库存最多滞后到缓存 TTL 结束——已确认的取舍）
      await clearResponseCache()
      res.json({
        success: true,
        message: '库存调整成功',
        data: {
          oldStock,
          newStock: fresh ? fresh.stock : null,
          product: fresh
        }
      })
    } catch (error) {
      logger.error('调整库存失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({ success: false, message: '调整库存失败' })
    }
  }

  // 批量检查商品库存
  static async checkStock(req, res) {
    try {
      const { productIds } = req.body

      if (!productIds || !Array.isArray(productIds)) {
        return res.status(400).json({
          success: false,
          message: '产品ID列表不能为空'
        })
      }

      const products = await Product.findAll({
        where: {
          id: productIds
        },
        attributes: ['id', 'stock']
      })

      res.json({
        success: true,
        data: products
      })
    } catch (error) {
      logger.error('检查库存失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '检查库存失败',
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }
}

export default ProductController