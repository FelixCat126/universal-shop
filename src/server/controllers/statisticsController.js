import { Op } from 'sequelize'
import { LRUCache } from 'lru-cache'
import sequelize from '../config/database.js'
import User from '../models/User.js'
import Order from '../models/Order.js'
import Product from '../models/Product.js'
import { logger } from '../utils/logger.js'
import * as statsCache from '../utils/statsCache.js'
import { NON_REVENUE_STATUSES, revenueWhere } from '../constants/revenueStatus.js'

/**
 * 综合统计进程内短缓存（TTL 15s）：
 * dashboard 高频刷新摊薄全表聚合（含活跃用户 last_login_at 无索引扫描——保留原逻辑，
 * 靠本缓存摊薄，不为此加索引）。
 * 失效取舍：订单/用户写入后不主动清，最长 15s 读到旧值，dashboard 场景可接受；
 * 键含查询参数（当前端点无参数，保留扩展位）。
 * 测试环境旁路：测试库 beforeEach 清库，缓存会跨用例泄漏计数。
 */
const comprehensiveCache = new LRUCache({ max: 50, ttl: 15_000 })
/** 测试环境默认旁路缓存（测试库每个用例前清库，缓存会跨用例泄漏旧计数） */
const isTestEnv = process.env.NODE_ENV === 'test' && process.env.STATS_CACHE_ENABLED !== '1'
/**
 * 总览统计的短缓存 —— 见 utils/statsCache.js。
 * 写时失效挂在模型层（订单/用户任何写入立刻清），不用在控制器里手写。
 */
const { getCachedOverview, setCachedOverview } = statsCache

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
      // 命中短缓存就直接返回（省掉 4 条全表聚合）
      const cached = getCachedOverview()
      if (cached) {
        return res.json({ success: true, data: cached })
      }

      /**
       * 查询逻辑全部收在 getOverviewStatsData()（内部方法）里 ——
       * /overview 与 /comprehensive 用的是同一套口径，
       * 两处各写一份迟早会漂移（上次就漂了：一边有"今日营收"一边没有）。
       *
       * 注意用 StatisticsController.xxx 而不是 this.xxx：
       * 路由把静态方法**脱钩**传进 Express（handler(req,res,next)），
       * 这时 this 是 undefined → this.getOverviewStatsData() 直接抛 TypeError → 500。
       */
      const data = await StatisticsController.getOverviewStatsData()
      setCachedOverview(data)

      res.json({ success: true, data })
    } catch (error) {
      logger.error('获取统计总览失败', { err: error?.message, stack: error?.stack })
      res.status(500).json({
        success: false,
        message: '获取统计总览失败',
        code: 'INTERNAL_SERVER_ERROR'
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
        code: 'INTERNAL_SERVER_ERROR'
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
        code: 'INTERNAL_SERVER_ERROR'
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
        code: 'INTERNAL_SERVER_ERROR'
      })
    }
  }

  // 内部方法：获取总览统计数据
  static async getOverviewStatsData() {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    /**
     * 六组查询**并发**发出去，而不是一个算完再算下一个。
     *
     * 之前是串行 await = N 次「发查询 → 等结果 → 再发下一个」的往返；
     * 数据库端的计算量没变，但**网络往返延迟 ×N**。
     * 面板每次打开都要跑一遍，往返延迟是用户直接感受到的（尤其跨机房时）。
     * Promise.all 把 N 次往返压成 1 次。
     */
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [totalOrders, totalAmountResult, totalUsers, activeUsers, todayStats, actionable] = await Promise.all([
      // 总订单数
      Order.count(),
      // 总金额数（只算**真实成交**：未付款/已取消的单不算营收）
      Order.findOne({
        attributes: [
          [sequelize.fn('SUM', sequelize.literal('COALESCE(total_amount_thb, total_amount)')), 'total']
        ],
        where: revenueWhere(Op)
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
      }),
      // 今日订单数 + 今日营收
      Order.findOne({
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'orders'],
          // 今日营收只算真实成交的；今日订单数仍是全部下单（没付的单也是单）
          // → 用 PG 的 FILTER 子句把两个口径拆开，不能靠 where 过滤（会把订单数也滤掉）
          [
            // ⚠️ 必须用 literal 而不是 fn：fn 会把整串当**函数名**加引号
            // （fn("SUM(x) FILTER(...)") → "SUM(x) FILTER(...)" → SQL 语法错误 500）
            sequelize.literal(
              `SUM(COALESCE(total_amount_thb, total_amount)) FILTER (WHERE status NOT IN (${NON_REVENUE_STATUSES.map((x) => sequelize.escape(x)).join(', ')}))`
            ),
            'amount'
          ]
        ],
        where: { created_at: { [Op.gte]: todayStart } },
        raw: true
      }),
      /**
       * 待办数 —— 面板上最该盯的四个数字：
       *   待发货：收了钱还没寄的（提醒发货）
       *   待支付：下单没付的（跟进催付）
       *   低库存：还剩一点货的（该补货了）
       *   缺货：已经卖光了的（断货风险）
       * 这几个对应"今天要干什么"，而累计营收只说明"过去发生了什么"。
       *
       * 口径必须和商品页的库存筛选**完全一致**（低库存=0<stock<=10，缺货=stock=0），
       * 否则点进商品页看到的条数和面板上的数字对不上。
       */
      Promise.all([
        Order.count({ where: { status: { [Op.in]: ['paid', 'shipping'] } } }),
        Order.count({ where: { status: 'pending' } }),
        Product.count({ where: { stock: { [Op.and]: [{ [Op.gt]: 0 }, { [Op.lte]: 10 }] } } }),
        Product.count({ where: { stock: 0 } })
      ])
    ])

    const totalAmount = parseFloat(totalAmountResult?.dataValues?.total || 0)

    return {
      totalOrders,
      totalAmount: totalAmount.toFixed(2),
      totalUsers,
      activeUsers,
      todayOrders: Number(todayStats?.orders || 0),
      todayAmount: Number(todayStats?.amount || 0).toFixed(2),
      pendingShipment: actionable[0],
      pendingPayment: actionable[1],
      lowStock: actionable[2],
      outOfStock: actionable[3]
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
