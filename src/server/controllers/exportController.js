import XLSX from 'xlsx'
import User from '../models/User.js'
import Order from '../models/Order.js'
import OrderItem from '../models/OrderItem.js'
import Product from '../models/Product.js'

class ExportController {
  // 导出用户数据
  static async exportUsers(req, res) {
    try {
      // 获取所有用户数据
      const users = await User.findAll({
        order: [['created_at', 'DESC']]
      })

      // 准备Excel数据
      const excelData = users.map(user => ({
        'ID': user.id,
        '用户名': user.username || '',
        '昵称': user.nickname,
        '邮箱': user.email || '',
        '手机号': user.phone,
        '推荐码': user.referral_code || '',
        '被推荐码': user.referred_by_code || '',
        '注册时间': user.created_at ? new Date(user.created_at).toLocaleString('zh-CN') : '',
        '更新时间': user.updated_at ? new Date(user.updated_at).toLocaleString('zh-CN') : ''
      }))

      // 创建工作簿
      const workbook = XLSX.utils.book_new()
      const worksheet = XLSX.utils.json_to_sheet(excelData)

      // 设置列宽
      worksheet['!cols'] = [
        { width: 8 },  // ID
        { width: 20 }, // 用户名
        { width: 15 }, // 昵称
        { width: 25 }, // 邮箱
        { width: 15 }, // 手机号
        { width: 12 }, // 推荐码
        { width: 12 }, // 被推荐码
        { width: 20 }, // 注册时间
        { width: 20 }  // 更新时间
      ]

      // 添加工作表到工作簿
      XLSX.utils.book_append_sheet(workbook, worksheet, '用户列表')

      // 生成Excel文件
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

      // 设置响应头
      const filename = `用户数据_${new Date().toISOString().split('T')[0]}.xlsx`
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)

      // 发送文件
      res.send(buffer)

    } catch (error) {
      console.error('导出用户数据失败:', error)
      res.status(500).json({
        success: false,
        message: '导出失败',
        error: error.message
      })
    }
  }

  // 导出订单数据
  static async exportOrders(req, res) {
    try {
      // 获取所有订单数据，包含关联的用户和订单项
      const orders = await Order.findAll({
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['nickname', 'phone']
          },
          {
            model: OrderItem,
            as: 'items',
            include: [{
              model: Product,
              as: 'product',
              attributes: ['name', 'price']
            }]
          }
        ],
        order: [['created_at', 'DESC']]
      })

      // 解析地址的辅助函数
      const parseAddress = (address) => {
        if (!address) return { province: '', city: '', district: '', detail: '' }
        
        // 尝试解析地址格式，支持多种可能的格式
        const addressStr = address.trim()
        
        // 省市区的常见后缀
        const provinceSuffixes = ['省', '市', '自治区', '特别行政区']
        const citySuffixes = ['市', '州', '盟', '地区']
        const districtSuffixes = ['区', '县', '市', '旗']
        
        let province = ''
        let city = ''
        let district = ''
        let detail = addressStr
        
        // 查找省份
        for (const suffix of provinceSuffixes) {
          const index = addressStr.indexOf(suffix)
          if (index > 0) {
            province = addressStr.substring(0, index + suffix.length)
            detail = addressStr.substring(index + suffix.length)
            break
          }
        }
        
        // 查找城市
        if (detail) {
          for (const suffix of citySuffixes) {
            const index = detail.indexOf(suffix)
            if (index > 0) {
              city = detail.substring(0, index + suffix.length)
              detail = detail.substring(index + suffix.length)
              break
            }
          }
        }
        
        // 查找区县
        if (detail) {
          for (const suffix of districtSuffixes) {
            const index = detail.indexOf(suffix)
            if (index > 0) {
              district = detail.substring(0, index + suffix.length)
              detail = detail.substring(index + suffix.length)
              break
            }
          }
        }
        
        return { province, city, district, detail }
      }

      // 准备Excel数据
      const excelData = []
      
      orders.forEach(order => {
        // 解析地址
        const addressInfo = parseAddress(order.delivery_address)
        
        // 如果订单有多个商品，每个商品一行
        if (order.items && order.items.length > 0) {
          order.items.forEach((item, index) => {
            excelData.push({
              '订单ID': order.id,
              '订单号': order.order_no,
              '用户昵称': order.user?.nickname || '',
              '联系电话': order.contact_phone,
              '收货人': order.contact_name,
              '省份': addressInfo.province,
              '城市': addressInfo.city,
              '区县': addressInfo.district,
              '详细地址': addressInfo.detail,
              '邮政编码': order.postal_code || '',
              '商品名称': item.product?.name || '',
              '商品单价': item.price,
              '购买数量': item.quantity,
              '小计金额': (item.price * item.quantity).toFixed(2),
              '订单总额': index === 0 ? order.total_amount : '', // 只在第一行显示总额
              '支付方式': index === 0 ? (order.payment_method === 'cod' ? '货到付款' : '在线支付') : '',
              '订单状态': index === 0 ? order.status : '',
              '推荐码': index === 0 ? (order.referral_code || '') : '',
              '货物重量': '', // 空白字段
              '长': '', // 空白字段
              '宽': '', // 空白字段
              '高': '', // 空白字段
              '代收货款': index === 0 ? order.total_amount : '', // 自动填写订单金额
              '包装费': '', // 空白字段
              '备注': index === 0 ? (order.notes || '') : '',
              '下单时间': index === 0 ? (order.created_at ? new Date(order.created_at).toLocaleString('zh-CN') : '') : ''
            })
          })
        } else {
          // 没有商品的订单
          excelData.push({
            '订单ID': order.id,
            '订单号': order.order_no,
            '用户昵称': order.user?.nickname || '',
            '联系电话': order.contact_phone,
            '收货人': order.contact_name,
            '省份': addressInfo.province,
            '城市': addressInfo.city,
            '区县': addressInfo.district,
            '详细地址': addressInfo.detail,
            '邮政编码': order.postal_code || '',
            '商品名称': '',
            '商品单价': '',
            '购买数量': '',
            '小计金额': '',
            '订单总额': order.total_amount,
            '支付方式': order.payment_method === 'cod' ? '货到付款' : '在线支付',
            '订单状态': order.status,
            '推荐码': order.referral_code || '',
            '货物重量': '', // 空白字段
            '长': '', // 空白字段
            '宽': '', // 空白字段
            '高': '', // 空白字段
            '代收货款': order.total_amount, // 自动填写订单金额
            '包装费': '', // 空白字段
            '备注': order.notes || '',
            '下单时间': order.created_at ? new Date(order.created_at).toLocaleString('zh-CN') : ''
          })
        }
      })

      // 创建工作簿
      const workbook = XLSX.utils.book_new()
      const worksheet = XLSX.utils.json_to_sheet(excelData)

      // 设置列宽
      worksheet['!cols'] = [
        { width: 8 },  // 订单ID
        { width: 20 }, // 订单号
        { width: 15 }, // 用户昵称
        { width: 15 }, // 联系电话
        { width: 12 }, // 收货人
        { width: 12 }, // 省份
        { width: 12 }, // 城市
        { width: 12 }, // 区县
        { width: 25 }, // 详细地址
        { width: 12 }, // 邮政编码
        { width: 20 }, // 商品名称
        { width: 10 }, // 商品单价
        { width: 8 },  // 购买数量
        { width: 10 }, // 小计金额
        { width: 10 }, // 订单总额
        { width: 10 }, // 支付方式
        { width: 10 }, // 订单状态
        { width: 12 }, // 推荐码
        { width: 10 }, // 货物重量
        { width: 8 },  // 长
        { width: 8 },  // 宽
        { width: 8 },  // 高
        { width: 12 }, // 代收货款
        { width: 10 }, // 包装费
        { width: 20 }, // 备注
        { width: 20 }  // 下单时间
      ]

      // 添加工作表到工作簿
      XLSX.utils.book_append_sheet(workbook, worksheet, '订单列表')

      // 生成Excel文件
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

      // 设置响应头
      const filename = `订单数据_${new Date().toISOString().split('T')[0]}.xlsx`
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)

      // 发送文件
      res.send(buffer)

    } catch (error) {
      console.error('导出订单数据失败:', error)
      res.status(500).json({
        success: false,
        message: '导出失败',
        error: error.message
      })
    }
  }
}

export default ExportController
