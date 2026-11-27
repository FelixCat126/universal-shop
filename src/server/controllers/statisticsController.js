import { Op } from 'sequelize'
import { formatAmount } from '../../shared/money.js'
import { LRUCache } from 'lru-cache'
import sequelize from '../config/database.js'
import User from '../models/User.js'
import Order from '../models/Order.js'
import Product from '../models/Product.js'
import { logger } from '../utils/logger.js'
import * as statsCache from '../utils/statsCache.js'
import { revenueStatusSql } from '../constants/revenueStatus.js'

/**
 * 综合统计进程内短缓存（TTL 15s）：
 * dashboard 高频刷新摊薄全表聚合（含活跃用户 last_login_at 无索引扫描——保留原逻辑，
 * 靠本缓存摊薄，不为此加索引）。
 * 失效取舍：订单/用户写入后不主动清，最长 15s 读到旧值，dashboard 场景可接受；
 * 键含查询参数（当前端点无参数，保留扩展位）。
 * 测试环境旁路：测试库 beforeEach 清库，缓存会跨用例泄漏计数。
 */
/**
 * 综合统计的缓存（第 57 轮）：改用 statsCache 里的统一桶 →
 * 纳入**写时失效**（之前只受 TTL 约束，改了库存后它还返回旧数字，
 * 而 overview 已经更新了 → 同一个数字两个端点两个答案）。
 */
const comprehensiveCache = {
  get: (k) => statsCache.getCachedComprehensive(k),
  set: (k, v) => statsCache.setCachedComprehensive(k, v)
}
/** 测试环境默认旁路缓存（测试库每个用例前清库，缓存会跨用例泄漏旧计数） */
/**
 * 测试环境是否**旁路缓存**（第 57 轮：改成运行时判断）。
 *
 * 之前是模块加载时算一次的常量 —— 于是"运行中把 STATS_CACHE_ENABLED 打开"
 * 对这个控制器**不生效**，缓存行为的护栏根本测不出来
 * （测缓存就必须能真的把缓存打开）。
 *
 * 与 utils/statsCache.js 的口径保持一致（那边本来就是运行时读环境变量）。
 */
const isTestEnv = () =>
  process.env.NODE_ENV === 'test' && process.env.STATS_CACHE_ENABLED !== '1'
/**
 * 总览统计的短缓存 —— 见 utils/statsCache.js。
 * 写时失效挂在模型层（订单/用户任何写入立刻清），不用在控制器里手写。
 */
const { getCachedOverview, setCachedOverview } = statsCache

import {
  getBusinessTimezone,
  sqlDayBucket,
  businessDayStartDaysAgo,
  businessDaySeries,
  startOfBusinessDay
} from '../utils/businessTimezone.js'

/**
 * 趋势统计按"服务器本地时区"的自然日分桶，SQL 与 JS 两侧口径必须一致：
 * - Sequelize 默认把每个连接的会话时区 SET 为 UTC（options.timezone='+00:00'），
 *   直接 DATE(created_at) 会按 UTC 分桶；故 SQL 侧显式 AT TIME ZONE <本地偏移> 得到本地日期。
 * - JS 侧日期键用本地 getFullYear/getMonth/getDate 拼接（不能用 toISOString，那是 UTC 日期，
 *   与本地分桶在日界错位，本机 UTC+8 时每天 00:00-08:00 会错一天）。
 * PG 的 AT TIME ZONE 数字偏移是 POSIX 方向（东负西正），与 getTimezoneOffset 的符号天然一致。
 * 注：偏移按查询时刻计算，跨越夏令时切换的历史行可能有 ±1h 误差（部署地无夏令时，可忽略）。
 */
/**
 * 业务时区下的"今天"口径。
 *
 * 原来这里用的是**服务器本地时区**（`new Date().setHours(0,0,0,0)` 与
 * `AT TIME ZONE '<服务器偏移>'`）—— 服务器换时区，"今日营收"就跟着变；
 * 且在有夏令时的时区上，固定偏移的日分桶会与日历日筛选差一小时。
 *
 * 现在统一由 `business_timezone` 配置项决定（见 utils/businessTimezone.js），
 * SQL 侧用 `AT TIME ZONE '<IANA 名>'`（PG 按每一行的时间戳求正确偏移，DST 也对），
 * JS 侧用同一时区的日历日键 —— 两边逐字对齐。
 *
 * @param {string} tz 业务时区
 */
const localDateBucket = (tz) =>
  sequelize.fn('DATE', sequelize.literal(sqlDayBucket(tz)))

class StatisticsController {
  // 获取统计总览数据
  static async getOverviewStats(req, res) {
    try {
      // 缓存键带业务时区：改了时区配置后，旧口径的缓存不能继续被读到
      const tz = await getBusinessTimezone()
      const cacheKey = `overview:${tz}`
      // 命中短缓存就直接返回（省掉 4 条全表聚合）
      const cached = getCachedOverview(cacheKey)
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
      setCachedOverview(data, cacheKey)

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
      const tz = await getBusinessTimezone()
      const sevenDaysAgo = businessDayStartDaysAgo(tz, new Date(), 7)

      // 获取过去7天的订单数据
      const orderTrend = await Order.findAll({
        attributes: [
          [localDateBucket(tz), 'date'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('SUM', sequelize.literal('COALESCE(total_amount_thb, total_amount)')), 'amount']
        ],
        where: {
          created_at: {
            [Op.gte]: sevenDaysAgo
          }
        },
        group: [localDateBucket(tz)],
        order: [[localDateBucket(tz), 'ASC']]
      })

      // 生成完整的7天数据，包括没有订单的日期
      const trendData = []
      for (const { dateStr, date } of businessDaySeries(tz, new Date(), 7)) {
        
        const dayData = orderTrend.find(item => item.dataValues.date === dateStr)
        
        trendData.push({
          date: dateStr,
          dateLabel: date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
          count: dayData ? parseInt(dayData.dataValues.count) : 0,
          amount: dayData ? formatAmount(dayData.dataValues.amount || 0) : '0.00'
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
      const tz = await getBusinessTimezone()
      const sevenDaysAgo = businessDayStartDaysAgo(tz, new Date(), 7)

      // 获取过去7天的注册用户数据
      const userTrend = await User.findAll({
        attributes: [
          [localDateBucket(tz), 'date'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        where: {
          created_at: {
            [Op.gte]: sevenDaysAgo
          }
        },
        group: [localDateBucket(tz)],
        order: [[localDateBucket(tz), 'ASC']]
      })

      // 生成完整的7天数据，包括没有注册用户的日期
      const trendData = []
      for (const { dateStr, date } of businessDaySeries(tz, new Date(), 7)) {
        
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
      const tz = await getBusinessTimezone()
      // 键含全部查询参数（排序后序列化，与参数顺序无关）+ 业务时区；
      // 命中直接返回
      const cacheKey = JSON.stringify([
        tz,
        ...Object.keys(req.query || {}).sort().map(k => [k, req.query[k]])
      ])
      if (!isTestEnv()) {
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
      if (!isTestEnv()) comprehensiveCache.set(cacheKey, data)

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
    const tz = await getBusinessTimezone()
    // 近 7 天活跃的起点：按**业务时区**的零点（与订单趋势同一口径）
    const sevenDaysAgo = businessDayStartDaysAgo(tz, new Date(), 7)
    const todayStart = startOfBusinessDay(tz)

    /**
     * 查询合并：**9 条 → 4 条**，orders 表的全表扫从 5 次降到 3 次。
     *
     * 原来的写法是「每个数字一条 count」，于是：
     *   - COUNT(*) 与 SUM(...) 各扫一遍 orders（总数与营收）
     *   - COUNT(*) 与活跃数各扫一遍 users
     *   - 待发货/待支付各扫一遍 orders，低库存/缺货各扫一遍 products
     * 而这些数字**全都可以用一条查询里的多个 FILTER 聚合一次算出来** ——
     * PG 的 FILTER 让"不同口径的行数"可以在一次扫描里同时得到。
     *
     * 口径一个都没变（数字与优化前逐项相等，见 dashboard.actionable.test.js），
     * 变的只是**少扫了几遍表** —— 面板是运营每 30 秒自动刷新的页面，
     * 用户量越大，这几遍全表扫越贵。
     */
    const revenueSql = revenueStatusSql((v) => sequelize.escape(v))

    const [orderStats, userStats, todayStats, actionable] = await Promise.all([
      /**
       * 总单数 + 总营收（一次扫 orders）。
       * 总营收只算**真实成交**：未付款/已取消的单不算营收。
       */
      Order.findOne({
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
          [
            sequelize.literal(
              `COALESCE(SUM(COALESCE(total_amount_thb, total_amount)) FILTER (WHERE ${revenueSql}), 0)`
            ),
            'revenue'
          ]
        ],
        raw: true
      }),
      /**
       * 总用户数 + 近七天活跃用户数（一次扫 users）。
       * last_login_at 有索引（013 迁移补的），FILTER 里带上边界即可。
       */
      User.findOne({
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
          [
            sequelize.literal(
              `COUNT(*) FILTER (WHERE last_login_at IS NOT NULL AND last_login_at >= ${sequelize.escape(sevenDaysAgo.toISOString())})`
            ),
            'active'
          ]
        ],
        raw: true
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
              `COALESCE(SUM(COALESCE(total_amount_thb, total_amount)) FILTER (WHERE ${revenueSql}), 0)`
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
        // 待发货 + 待支付（一次扫 orders）
        Order.findOne({
          attributes: [
            [
              sequelize.literal(
                `COUNT(*) FILTER (WHERE status IN ('paid', 'shipping'))`
              ),
              'shipment'
            ],
            [
              sequelize.literal(`COUNT(*) FILTER (WHERE status = 'pending')`),
              'payment'
            ]
          ],
          raw: true
        }),
        /**
         * 低库存 + 缺货（第 57 轮）：**用 count() 而不是 COUNT(*) FILTER**。
         *
         * FILTER 聚合是"扫一遍全表再挑行" —— 商品上万后，
         * 每 15 秒（缓存 TTL）就要全表扫一次，纯粹白烧。
         *
         * 改成两条 count：条件 `stock > 0 AND stock <= 10` / `stock = 0`
         * 都能**直接命中 idx_product_stock 的索引区间** → 只扫相关行。
         *
         * 口径一个都没变（仍是全部商品，不区分 status），数字与之前逐项相等。
         * 形状保持 { low, out }，调用方不用改。
         */
        (async () => {
          const [low, out] = await Promise.all([
            Product.count({ where: { stock: { [Op.gt]: 0, [Op.lte]: 10 } } }),
            Product.count({ where: { stock: 0 } })
          ])
          return { low, out }
        })()
      ])
    ])

    const totalAmount = parseFloat(orderStats?.revenue || 0)

    return {
      totalOrders: Number(orderStats?.total || 0),
      totalAmount: formatAmount(totalAmount),
      totalUsers: Number(userStats?.total || 0),
      activeUsers: Number(userStats?.active || 0),
      todayOrders: Number(todayStats?.orders || 0),
      todayAmount: formatAmount(todayStats?.amount || 0),
      // actionable 只有两项：[0]=订单侧计数（待发货/待支付），[1]=商品侧计数（低库存/缺货）
      pendingShipment: Number(actionable[0]?.shipment || 0),
      pendingPayment: Number(actionable[0]?.payment || 0),
      lowStock: Number(actionable[1]?.low || 0),
      outOfStock: Number(actionable[1]?.out || 0)
    }
  }

  // 内部方法：获取订单趋势数据
  static async getOrderTrendData() {
    const tz = await getBusinessTimezone()
    const sevenDaysAgo = businessDayStartDaysAgo(tz, new Date(), 7)

    const orderTrend = await Order.findAll({
      attributes: [
        [localDateBucket(tz), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
        // 与公共 getOrderTrend 口径一致：优先泰铢底价，缺省回退结算金额
        [sequelize.fn('SUM', sequelize.literal('COALESCE(total_amount_thb, total_amount)')), 'amount']
      ],
      where: {
        created_at: {
          [Op.gte]: sevenDaysAgo
        }
      },
      group: [localDateBucket(tz)],
      order: [[localDateBucket(tz), 'ASC']]
    })

    const trendData = []
    for (const { dateStr, date } of businessDaySeries(tz, new Date(), 7)) {
      
      const dayData = orderTrend.find(item => item.dataValues.date === dateStr)
      
      trendData.push({
        date: dateStr,
        dateLabel: date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
        count: dayData ? parseInt(dayData.dataValues.count) : 0,
        amount: dayData ? formatAmount(dayData.dataValues.amount || 0) : '0.00'
      })
    }

    return trendData
  }

  // 内部方法：获取用户注册趋势数据
  static async getUserRegistrationTrendData() {
    const tz = await getBusinessTimezone()
    const sevenDaysAgo = businessDayStartDaysAgo(tz, new Date(), 7)

    const userTrend = await User.findAll({
      attributes: [
        [localDateBucket(tz), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: {
        created_at: {
          [Op.gte]: sevenDaysAgo
        }
      },
      group: [localDateBucket(tz)],
      order: [[localDateBucket(tz), 'ASC']]
    })

    const trendData = []
    for (const { dateStr, date } of businessDaySeries(tz, new Date(), 7)) {
      
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
