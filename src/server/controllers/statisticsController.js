import { Op } from 'sequelize'
import sequelize from '../config/database.js'
import User from '../models/User.js'
import Order from '../models/Order.js'
import Product from '../models/Product.js'

class StatisticsController {
  // 获取统计总览数据
  static async getOverviewStats(req, res) {
    try {
      // 获取总订单数
      const totalOrders = await Order.count()
      
      // 获取总金额数
      const totalAmountResult = await Order.findOne({
        attributes: [
          [sequelize.fn('SUM', sequelize.col('total_amount')), 'total']
        ]
      })
      const totalAmount = parseFloat(totalAmountResult?.dataValues?.total || 0)
      
      // 获取总用户数
      const totalUsers = await User.count()
      
      // 获取近七天活跃用户数（近七天内有登录记录的）
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
      console.error('获取统计总览失败:', error)
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
          [sequelize.fn('DATE', sequelize.col('created_at')), 'date'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
          [sequelize.fn('SUM', sequelize.col('total_amount')), 'amount']
        ],
        where: {
          created_at: {
            [Op.gte]: sevenDaysAgo
          }
        },
        group: [sequelize.fn('DATE', sequelize.col('created_at'))],
        order: [[sequelize.fn('DATE', sequelize.col('created_at')), 'ASC']]
      })

      // 生成完整的7天数据，包括没有订单的日期
      const trendData = []
      for (let i = 6; i >= 0; i--) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const dateStr = date.toISOString().split('T')[0]
        
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
      console.error('获取订单趋势失败:', error)
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
          [sequelize.fn('DATE', sequelize.col('created_at')), 'date'],
          [sequelize.fn('COUNT', sequelize.col('id')), 'count']
        ],
        where: {
          created_at: {
            [Op.gte]: sevenDaysAgo
          }
        },
        group: [sequelize.fn('DATE', sequelize.col('created_at'))],
        order: [[sequelize.fn('DATE', sequelize.col('created_at')), 'ASC']]
      })

      // 生成完整的7天数据，包括没有注册用户的日期
      const trendData = []
      for (let i = 6; i >= 0; i--) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const dateStr = date.toISOString().split('T')[0]
        
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
      console.error('获取用户注册趋势失败:', error)
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
      // 并行获取所有统计数据
      const [overviewStats, orderTrend, userTrend] = await Promise.all([
        StatisticsController.getOverviewStatsData(),
        StatisticsController.getOrderTrendData(),
        StatisticsController.getUserRegistrationTrendData()
      ])

      res.json({
        success: true,
        data: {
          overview: overviewStats,
          orderTrend,
          userTrend
        }
      })
    } catch (error) {
      console.error('获取综合统计失败:', error)
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
        [sequelize.fn('SUM', sequelize.col('total_amount')), 'total']
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
        [sequelize.fn('DATE', sequelize.col('created_at')), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
        [sequelize.fn('SUM', sequelize.col('total_amount')), 'amount']
      ],
      where: {
        created_at: {
          [Op.gte]: sevenDaysAgo
        }
      },
      group: [sequelize.fn('DATE', sequelize.col('created_at'))],
      order: [[sequelize.fn('DATE', sequelize.col('created_at')), 'ASC']]
    })

    const trendData = []
    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      
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
        [sequelize.fn('DATE', sequelize.col('created_at')), 'date'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: {
        created_at: {
          [Op.gte]: sevenDaysAgo
        }
      },
      group: [sequelize.fn('DATE', sequelize.col('created_at'))],
      order: [[sequelize.fn('DATE', sequelize.col('created_at')), 'ASC']]
    })

    const trendData = []
    for (let i = 6; i >= 0; i--) {
      const date = new Date()
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().split('T')[0]
      
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
