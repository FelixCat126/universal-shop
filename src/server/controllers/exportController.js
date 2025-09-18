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
              attributes: ['name', 'alias', 'price']
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

      // 三语言表头字段定义：泰文（中文、英文）
      const getTrilingualHeaders = () => {
        return {
          'หมายเลขคำสั่งซื้อ（电商订单号、Order Number）': '电商订单号',
          'น้ำหนักสินค้า（货物重量(kg)、Weight(kg)）': '货物重量(kg)',
          'ชื่อผู้รับ（收件人姓名、Recipient Name）': '收件人姓名',
          'เบอร์โทรผู้รับ（收件人手机、Recipient Mobile）': '收件人手机',
          'เบอร์โทรศัพท์ผู้รับ（收件人电话、Recipient Phone）': '收件人电话',
          'จังหวัด（目的府、Province）': '目的府',
          'อำเภอ/เขต（目的区县、District）': '目的区县',
          'ตำบล/แขวง（目的镇、Sub-district）': '目的镇',
          'รหัสไปรษณีย์（目的邮编、Postal Code）': '目的邮编',
          'ที่อยู่ผู้รับ（收件地址、Delivery Address）': '收件地址',
          'ชื่อสินค้า（物品名称、Product Name）': '物品名称',
          'มูลค่าสินค้า（物品价值、Product Value）': '物品价值',
          'หมายเหตุ（备注、Remarks）': '备注',
          'เก็บเงินปลายทาง（代收货款、Cash on Delivery）': '代收货款',
          'สถานะคำสั่งซื้อ（订单状态、Order Status）': '订单状态',
          'ยาว（长(cm)、Length(cm)）': '长(cm)',
          'กว้าง（宽(cm)、Width(cm)）': '宽(cm)',
          'สูง（高(cm)、Height(cm)）': '高(cm)',
          'ค่าบรรจุภัณฑ์（包装费、Packaging Fee）': '包装费'
        }
      }
      
      // 准备Excel数据 - 按照模板字段格式
      const excelData = orders.map(order => {
        // 合并所有商品名称，优先使用别名
        const productNames = order.items && order.items.length > 0 
          ? order.items.map(item => {
              // 优先使用别名，如果没有别名则使用商品名称
              const productName = item.product?.alias || item.product?.name || ''
              return productName
            }).filter(name => name).join(', ')
          : ''
        
        // 计算代收货款：货到付款=订单金额，在线付款=0
        const codAmount = order.payment_method === 'cod' ? order.total_amount : '0'
        
        // 订单状态三语言转换：泰文（中文、英文）
        const getStatusText = (status) => {
          const statusMap = {
            'pending': 'รอการชำระเงิน（待支付、Pending Payment）',
            'paid': 'ชำระเงินแล้ว（已支付、Paid）', 
            'shipping': 'กำลังจัดส่ง（送货中、Shipping）',
            'shipped': 'จัดส่งแล้ว（已发货、Shipped）',
            'delivered': 'ส่งถึงแล้ว（已送达、Delivered）',
            'completed': 'เสร็จสิ้น（已完成、Completed）',
            'cancelled': 'ยกเลิกแล้ว（已取消、Cancelled）'
          }
          return statusMap[status] || `${status}（${status}、${status}）`
        }
        
        // 优先使用分字段数据，回退到地址解析
        let province = order.province || ''
        let city = order.city || ''
        let district = order.district || ''
        let detailAddress = order.delivery_address || ''
        
        // 如果分字段为空，尝试解析完整地址
        if (!province && !city && !district && order.delivery_address) {
          const addressInfo = parseAddress(order.delivery_address)
          province = addressInfo.province
          city = addressInfo.city
          district = addressInfo.district
          detailAddress = addressInfo.detail
        }
        
        return {
          'หมายเลขคำสั่งซื้อ（电商订单号、Order Number）': order.order_no || '',
          'น้ำหนักสินค้า（货物重量(kg)、Weight(kg)）': '', // 暂时留空
          'ชื่อผู้รับ（收件人姓名、Recipient Name）': order.contact_name || '',
          'เบอร์โทรผู้รับ（收件人手机、Recipient Mobile）': order.contact_phone || '',
          'เบอร์โทรศัพท์ผู้รับ（收件人电话、Recipient Phone）': order.contact_phone || '', // 复用手机号
          'จังหวัด（目的府、Province）': province,
          'อำเภอ/เขต（目的区县、District）': city,
          'ตำบล/แขวง（目的镇、Sub-district）': district,
          'รหัสไปรษณีย์（目的邮编、Postal Code）': order.postal_code || '',
          'ที่อยู่ผู้รับ（收件地址、Delivery Address）': detailAddress,
          'ชื่อสินค้า（物品名称、Product Name）': productNames,
          'มูลค่าสินค้า（物品价值、Product Value）': order.total_amount || '',
          'หมายเหตุ（备注、Remarks）': order.notes || '',
          'เก็บเงินปลายทาง（代收货款、Cash on Delivery）': codAmount,
          'สถานะคำสั่งซื้อ（订单状态、Order Status）': getStatusText(order.status),
          'ยาว（长(cm)、Length(cm)）': '', // 留空
          'กว้าง（宽(cm)、Width(cm)）': '', // 留空
          'สูง（高(cm)、Height(cm)）': '', // 留空
          'ค่าบรรจุภัณฑ์（包装费、Packaging Fee）': '' // 留空
        }
      })

      // 创建工作簿
      const workbook = XLSX.utils.book_new()
      const worksheet = XLSX.utils.json_to_sheet(excelData)

      // 设置列宽 - 按三语言表头字段调整（表头较长需要更宽的列宽）
      worksheet['!cols'] = [
        { width: 35 }, // หมายเลขคำสั่งซื้อ（电商订单号、Order Number）
        { width: 30 }, // น้ำหนักสินค้า（货物重量(kg)、Weight(kg)）
        { width: 32 }, // ชื่อผู้รับ（收件人姓名、Recipient Name）
        { width: 35 }, // เบอร์โทรผู้รับ（收件人手机、Recipient Mobile）
        { width: 35 }, // เบอร์โทรศัพท์ผู้รับ（收件人电话、Recipient Phone）
        { width: 25 }, // จังหวัด（目的府、Province）
        { width: 30 }, // อำเภอ/เขต（目的区县、District）
        { width: 35 }, // ตำบล/แขวง（目的镇、Sub-district）
        { width: 30 }, // รหัสไปรษณีย์（目的邮编、Postal Code）
        { width: 40 }, // ที่อยู่ผู้รับ（收件地址、Delivery Address）
        { width: 32 }, // ชื่อสินค้า（物品名称、Product Name）
        { width: 30 }, // มูลค่าสินค้า（物品价值、Product Value）
        { width: 25 }, // หมายเหตุ（备注、Remarks）
        { width: 40 }, // เก็บเงินปลายทาง（代收货款、Cash on Delivery）
        { width: 35 }, // สถานะคำสั่งซื้อ（订单状态、Order Status）
        { width: 25 }, // ยาว（长(cm)、Length(cm)）
        { width: 25 }, // กว้าง（宽(cm)、Width(cm)）
        { width: 25 }, // สูง（高(cm)、Height(cm)）
        { width: 35 }  // ค่าบรรจุภัณฑ์（包装费、Packaging Fee）
      ]

      // 设置表头行样式 - 灰色背景
      const headerRowIndex = 1 // Excel中行号从1开始
      const totalColumns = 19 // 总列数（包含新增的订单状态列）
      
      // 为表头行的每一列设置灰色背景
      for (let col = 0; col < totalColumns; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col }) // 第0行（表头行）
        if (!worksheet[cellAddress]) {
          worksheet[cellAddress] = { v: '', t: 's' }
        }
        if (!worksheet[cellAddress].s) {
          worksheet[cellAddress].s = {}
        }
        worksheet[cellAddress].s.fill = {
          patternType: 'solid',
          fgColor: { rgb: 'D0D0D0' } // 灰色背景
        }
        worksheet[cellAddress].s.font = {
          bold: true // 表头字体加粗
        }
        worksheet[cellAddress].s.alignment = {
          horizontal: 'center', // 水平居中
          vertical: 'center'    // 垂直居中
        }
      }

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
