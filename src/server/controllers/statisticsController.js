import { Op } from 'sequelize'
import { LRUCache } from 'lru-cache'
import sequelize from '../config/database.js'
import User from '../models/User.js'
import Order from '../models/Order.js'
import Product from '../models/Product.js'
import { logger } from '../utils/logger.js'

/**
 * 综合统计进程内短缓存（TTL 15s）：
 * dashboard 高频刷新摊薄全表聚合（含活跃用户 last_login_at 无索引扫描——保留原逻辑，
 * 靠本缓存摊薄，不为此加索引）。
 * 失效取舍：订单/用户写入后不主动清，最长 15s 读到旧值，dashboard 场景可接受；
 * 键含查询参数（当前端点无参数，保留扩展位）。
 * 测试环境旁路：测试库 beforeEach 清库，缓存会跨用例泄漏计数。
 */
const comprehensiveCache = new LRUCache({ max: 50, ttl: 15_000 })
const isTestEnv = process.env.NODE_ENV === 'test'

/**
 * 趋势统计按"服务器本地时区"的自然日分桶，SQL 与 JS 两侧口径必须一致：
 * - Sequelize 默认把每个连接的会话时区 SET 为 UTC（options.timezone='+00:00'），
 *   直接 DATE(created_at) 会按 UTC 分桶；故 SQL 侧显式 AT TIME ZONE <本地偏移> 得到本地日期。
 * - JS 侧日期键用本地 getFullYear/getMonth/getDate 拼接（不能用 toISOString，那是 UTC 日期，
 *   与本地分桶在日界错位，本机 UTC+8 时每天 00:00-08:00 会错一天）。
 * PG 的 AT TIME ZONE 数字偏移是 POSIX 方向（东负西正），与 getTimezoneOffset 的符号天然一致。
 * 注：偏移按查询时刻计算，跨越夏令时切换的历史行可能有 ±1h 误差（部署地无夏令时，可忽略）。
 */
const localDateKey = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const localTzOffsetLiteral = () => {
  const offMin = new Date().getTimezoneOffset()
  const sign = offMin <= 0 ? '-' : '+'
  const abs = Math.abs(offMin)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

// 本地自然日的 SQL 分桶表达式（以下查询均为单表查询，created_at 无歧义）
const localDateBucket = () =>
  sequelize.fn('DATE', sequelize.literal(`created_at AT TIME ZONE '${localTzOffsetLiteral()}'`))

class StatisticsController {
  // 获取统计总览数据
  static async getOverviewStats(req, res) {
    try {
      // 获取近七天活跃用户数（近七天内有登录记录的）
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      // 四条聚合相互独立：并行执行，总耗时从串行求和降为单条最大
      const [totalOrders, totalAmountResult, totalUsers, activeUsers] = await Promise.all([
        // 总订单数
        Order.count(),
        // 总金额数
        Order.findOne({
          attributes: [
            [sequelize.fn('SUM', sequelize.literal('COALESCE(total_amount_thb, total_amount)')), 'total']
          ]
        }),
        // 总用户数
        User.count(),
        // 近七天活跃用户数
        User.count({
          where: {
            last_login_at: {
              [Op.gte]: sevenDaysAgo,
              [Op.ne]: null
            }
          }
        })
      ])
      const totalAmount = parseFloat(totalAmountResult?.dataValues?.total || 0)

      res.json({
        success: true,
        data: {
          totalOrders,
          totalAmount: totalAmount.toFixed(2),
          totalUsers,
          activeUsers
        }
      })
    } catch (error) {
      logger.error('获取统计总览失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取统计总览失败',
        error: error.message
      })
    }
  }

  // 获取七天订单趋势数据
  static async getOrderTrend(req, res) {
    try {
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      sevenDaysAgo.setHours(0, 0, 0, 0)

      // 获取过去7天的订单数据
      const orderTrend = await Order.findAll({
        attributes: [
          [localDateBucket(), 'date'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('SUM', sequelize.literal('COALESCE(total_amount_thb, total_amount)')), 'amount']
        ],
        where: {
          created_at: {
            [Op.gte]: sevenDaysAgo
          }
        },
        group: [localDateBucket()],
        order: [[localDateBucket(), 'ASC']]
      })

      // 生成完整的7天数据，包括没有订单的日期
      const trendData = []
      for (let i = 6; i >= 0; i--) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const dateStr = localDateKey(date)
        
        const dayData = orderTrend.find(item => item.dataValues.date === dateStr)
        
        trendData.push({
          date: dateStr,
          dateLabel: date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
          count: dayData ? parseInt(dayData.dataValues.count) : 0,
          amount: dayData ? parseFloat(dayData.dataValues.amount || 0).toFixed(2) : '0.00'
        })
      }

      res.json({
        success: true,
        data: trendData
      })
    } catch (error) {
      logger.error('获取订单趋势失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取订单趋势失败',
        error: error.message
      })
    }
  }

  // 获取七天注册用户趋势数据
  static async getUserRegistrationTrend(req, res) {
    try {
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      sevenDaysAgo.setHours(0, 0, 0, 0)

      // 获取过去7天的注册用户数据
      const userTrend = await User.findAll({
        attributes: [
          [localDateBucket(), 'date'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        where: {
          created_at: {
            [Op.gte]: sevenDaysAgo
          }
        },
        group: [localDateBucket()],
        order: [[localDateBucket(), 'ASC']]
      })

      // 生成完整的7天数据，包括没有注册用户的日期
      const trendData = []
      for (let i = 6; i >= 0; i--) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const dateStr = localDateKey(date)
        
        const dayData = userTrend.find(item => item.dataValues.date === dateStr)
        
        trendData.push({
          date: dateStr,
          dateLabel: date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
          count: dayData ? parseInt(dayData.dataValues.count) : 0
        })
      }

      res.json({
        success: true,
        data: trendData
      })
    } catch (error) {
      logger.error('获取用户注册趋势失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取用户注册趋势失败',
        error: error.message
      })
    }
  }

  // 获取综合统计数据（包含总览和趋势）
  static async getComprehensiveStats(req, res) {
    try {
      // 键含全部查询参数（排序后序列化，与参数顺序无关）；命中直接返回
      const cacheKey = JSON.stringify(
        Object.keys(req.query || {}).sort().map(k => [k, req.query[k]])
      )
      if (!isTestEnv) {
        const cached = comprehensiveCache.get(cacheKey)
        if (cached) {
          return res.json({
            success: true,
            data: cached
          })
        }
      }

      // 并行获取所有统计数据
      const [overviewStats, orderTrend, userTrend] = await Promise.all([
        StatisticsController.getOverviewStatsData(),
        StatisticsController.getOrderTrendData(),
        StatisticsController.getUserRegistrationTrendData()
      ])

      const data = {
        overview: overviewStats,
        orderTrend,
        userTrend
      }
      if (!isTestEnv) comprehensiveCache.set(cacheKey, data)

      res.json({
        success: true,
        data
      })
    } catch (error) {
      logger.error('获取综合统计失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取综合统计失败',
        error: error.message
      })
    }
  }

  // 内部方法：获取总览统计数据
  static async getOverviewStatsData() {
    const totalOrders = await Order.count()
    
    const totalAmountResult = await Order.findOne({
      attributes: [
        [sequelize.fn('SUM', sequelize.literal('COALESCE(total_amount_thb, total_amount)')), 'total']
      ]
    })
    const totalAmount = parseFloat(totalAmountResult?.dataValues?.total || 0)
    
    const totalUsers = await User.count()
    
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    
    const activeUsers = await User.count({
      where: {
        last_login_at: {
          [Op.gte]: sevenDaysAgo,
          [Op.ne]: null
        }
      }
    })

    return {
      totalOrders,
      totalAmount: totalAmount.toFixed(2),
      totalUsers,
      activeUsers
    }
  }

  // 内部方法：获取订单趋势数据
  static async getOrderTrendData() {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    sevenDaysAgo.setHours(0, 0, 0, 0)

    const orderTrend = await Order.findAll({
      attributes: [
        [localDateBucket(), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
        // 与公共 getOrderTrend 口径一致：优先泰铢底价，缺省回退结算金额
        [sequelize.fn('SUM', sequelize.literal('COALESCE(total_amount_thb, total_amount)')), 'amount']
      ],
      where: {
        created_at: {
          [Op.gte]: sevenDaysAgo
        }
      },
      group: [localDateBucket()],
      order: [[localDateBucket(), 'ASC']]
    })

    const trendData = []
    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = localDateKey(date)
      
      const dayData = orderTrend.find(item => item.dataValues.date === dateStr)
      
      trendData.push({
        date: dateStr,
        dateLabel: date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
        count: dayData ? parseInt(dayData.dataValues.count) : 0,
        amount: dayData ? parseFloat(dayData.dataValues.amount || 0).toFixed(2) : '0.00'
      })
    }

    return trendData
  }

  // 内部方法：获取用户注册趋势数据
  static async getUserRegistrationTrendData() {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    sevenDaysAgo.setHours(0, 0, 0, 0)

    const userTrend = await User.findAll({
      attributes: [
        [localDateBucket(), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: {
        created_at: {
          [Op.gte]: sevenDaysAgo
        }
      },
      group: [localDateBucket()],
      order: [[localDateBucket(), 'ASC']]
    })

    const trendData = []
    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = localDateKey(date)
      
      const dayData = userTrend.find(item => item.dataValues.date === dateStr)
      
      trendData.push({
        date: dateStr,
        dateLabel: date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
        count: dayData ? parseInt(dayData.dataValues.count) : 0
      })
    }

    return trendData
  }
}

export default StatisticsController
