<template>
  <div class="orders-management">
    <!-- 页面标题 -->
    <div class="page-header">
      <h2 class="page-title">{{ t('orders.title') }}</h2>
      <p class="page-description">{{ t('orders.description') }}</p>
    </div>

    <!-- 搜索和筛选 -->
    <div class="filter-section">
      <el-card>
        <el-form :model="filters" inline class="search-form">
          <el-form-item :label="t('orders.status')">
            <el-select
              v-model="filters.status"
              :placeholder="t('orders.selectStatus')"
              clearable
              style="width: 150px"
              @change="loadOrders"
            >
              <el-option :label="t('orders.statusOptions.completed')" value="completed" />
              <el-option :label="t('orders.statusOptions.pending')" value="pending" />
              <el-option :label="t('orders.statusOptions.cancelled')" value="cancelled" />
            </el-select>
          </el-form-item>
          
          <el-form-item :label="t('orders.search')">
            <el-input
              v-model="filters.keyword"
              :placeholder="t('orders.searchPlaceholder')"
              clearable
              style="width: 200px"
              @input="debounceSearch"
            />
          </el-form-item>
          
          <el-form-item :label="t('orders.startDate')">
            <el-date-picker
              v-model="filters.startDate"
              type="date"
              :placeholder="t('orders.selectStartDate')"
              style="width: 150px"
              @change="loadOrders"
            />
          </el-form-item>
          
          <el-form-item :label="t('orders.endDate')">
            <el-date-picker
              v-model="filters.endDate"
              type="date"
              :placeholder="t('orders.selectEndDate')"
              style="width: 150px"
              @change="loadOrders"
            />
          </el-form-item>
          
          <el-form-item>
            <el-button type="primary" @click="loadOrders" :loading="loading">
              <el-icon><Search /></el-icon>
              {{ t('orders.search') }}
            </el-button>
            <el-button @click="resetFilters">
              <el-icon><Refresh /></el-icon>
              {{ t('orders.reset') }}
            </el-button>
            <el-button type="success" @click="exportOrders" :loading="isExporting">
              <el-icon><Download /></el-icon>
              {{ t('orders.export') }}
            </el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>

    <!-- 统计信息 -->
    <div class="stats-section">
      <el-row :gutter="20">
        <el-col :span="6">
          <el-card class="stats-card">
            <div class="stats-content">
              <div class="stats-value">{{ stats.total }}</div>
              <div class="stats-label">{{ t('orders.totalOrders') }}</div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#409EFF"><TrendCharts /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stats-card">
            <div class="stats-content">
              <div class="stats-value">{{ stats.completed }}</div>
              <div class="stats-label">{{ t('orders.statusOptions.completed') }}</div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#67C23A"><SuccessFilled /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stats-card">
            <div class="stats-content">
              <div class="stats-value">{{ t('common.currency') }}{{ stats.totalAmount }}</div>
              <div class="stats-label">{{ t('orders.totalRevenue') }}</div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#E6A23C"><Coin /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stats-card">
            <div class="stats-content">
              <div class="stats-value">{{ t('common.currency') }}{{ stats.todayAmount }}</div>
              <div class="stats-label">{{ t('orders.todayOrders') }}</div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#F56C6C"><Calendar /></el-icon>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- 订单列表 -->
    <div class="table-section">
      <el-card>
        <template #header>
          <div class="table-header">
            <span>{{ t('orders.title') }}</span>
            <span class="table-info">{{ t('orders.totalOrders') }} {{ stats.total }}</span>
          </div>
        </template>

        <div class="table-wrapper">
          <el-table
            :data="orders"
            v-loading="loading"
            stripe
            border
            style="width: 100%; min-width: 1400px"
            :default-sort="{ prop: 'created_at', order: 'descending' }"
            table-layout="fixed"
            class="order-table"
          >
        <el-table-column prop="order_no" :label="t('orders.orderNumber')" width="240" align="center">
          <template #default="scope">
            <div class="order-no">{{ scope.row.order_no }}</div>
          </template>
        </el-table-column>

        <el-table-column :label="t('orders.customer')" width="220" min-width="200">
          <template #default="scope">
            <div class="user-info">
              <div class="user-nickname">{{ scope.row.user?.nickname || t('common.unknown') }}</div>
              <div v-if="scope.row.user?.phone" class="user-phone">{{ scope.row.user.phone }}</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column :label="t('orders.amount')" width="140" align="center">
          <template #default="scope">
            <div class="amount">{{ t('common.currency') }}{{ scope.row.total_amount }}</div>
          </template>
        </el-table-column>

        <el-table-column :label="t('common.paymentMethod')" width="150" align="center">
          <template #default="scope">
            <el-tag :type="scope.row.payment_method === 'cod' ? 'warning' : 'success'" size="small">
              {{ getPaymentMethodText(scope.row.payment_method) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column :label="t('orders.status')" width="140" align="center">
          <template #default="scope">
            <el-tag :type="getStatusTagType(scope.row.status)" size="small">
              {{ getStatusText(scope.row.status) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column :label="t('orders.customerInfo')" width="200" min-width="180">
          <template #default="scope">
            <div class="contact-info">
              <div class="contact-name">{{ scope.row.contact_name }}</div>
              <div class="contact-phone">{{ scope.row.contact_phone }}</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column :label="t('orders.orderDate')" width="180" align="center">
          <template #default="scope">
            <div class="created-time">{{ formatDate(scope.row.created_at) }}</div>
          </template>
        </el-table-column>

        <el-table-column :label="t('orders.actions')" width="200" align="center" fixed="right">
          <template #default="scope">
            <div class="action-buttons">
              <el-button
                type="primary"
                size="small"
                @click="viewOrderDetail(scope.row)"
              >
                {{ t('orders.viewDetails') }}
              </el-button>
              <el-button
                type="danger"
                size="small"
                @click="deleteOrder(scope.row.id)"
              >
                {{ t('common.delete') }}
              </el-button>
            </div>
          </template>
        </el-table-column>
          </el-table>
        </div>

        <!-- 分页 -->
        <div class="pagination-wrapper">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :small="false"
            :disabled="loading"
            :background="true"
            layout="total, sizes, prev, pager, next, jumper"
            :total="stats.total"
            @size-change="handleSizeChange"
            @current-change="handleCurrentChange"
          />
        </div>
      </el-card>
    </div>

    <!-- 订单详情对话框 -->
    <el-dialog
      v-model="showDetailModal"
      :title="t('orders.orderDetails')"
      width="900px"
      top="5vh"
      class="order-detail-dialog"
      :before-close="closeDetailModal"
    >
      <div v-if="selectedOrder" class="order-detail-container">
        <!-- 订单状态和基本信息卡片 -->
        <el-row :gutter="20" class="detail-row">
          <el-col :span="16">
            <el-card shadow="never" class="info-card">
              <template #header>
                <div class="card-header">
                  <el-icon class="header-icon" color="#409eff"><Document /></el-icon>
                  <span>{{ t('orders.orderInfo') }}</span>
                </div>
              </template>
              <el-descriptions :column="2" border>
                <el-descriptions-item :label="t('orders.orderNumber')">
                  <el-tag type="info" size="small">{{ selectedOrder.order_no }}</el-tag>
                </el-descriptions-item>
                <el-descriptions-item :label="t('orders.status')">
                  <el-tag 
                    :type="getStatusTagType(selectedOrder.status)"
                    size="small"
                  >
                    {{ getStatusText(selectedOrder.status) }}
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item :label="t('orders.amount')">
                  <span class="amount-text">{{ t('common.currency') }}{{ selectedOrder.total_amount }}</span>
                </el-descriptions-item>
                <el-descriptions-item :label="t('common.paymentMethod')">
                  <el-tag 
                    :type="selectedOrder.payment_method === 'cod' ? 'warning' : 'success'"
                    size="small"
                  >
                    {{ getPaymentMethodText(selectedOrder.payment_method) }}
                  </el-tag>
                </el-descriptions-item>
                <el-descriptions-item :label="t('orders.orderDate')" :span="2">
                  {{ formatDate(selectedOrder.created_at) }}
                </el-descriptions-item>
              </el-descriptions>
            </el-card>
          </el-col>
          <el-col :span="8">
            <!-- 客户信息卡片 -->
            <el-card shadow="never" class="info-card">
              <template #header>
                <div class="card-header">
                  <el-icon class="header-icon" color="#67c23a"><User /></el-icon>
                  <span>{{ t('orders.customerInfo') }}</span>
                </div>
              </template>
              <el-descriptions :column="1" border>
                <el-descriptions-item :label="t('users.nickname')">
                  {{ selectedOrder.user?.nickname || t('common.unknown') }}
                </el-descriptions-item>
                <el-descriptions-item :label="t('users.phone')">
                  {{ selectedOrder.user?.phone || t('common.unknown') }}
                </el-descriptions-item>
              </el-descriptions>
            </el-card>
          </el-col>
        </el-row>

        <!-- 收货信息卡片 -->
        <el-card shadow="never" class="info-card">
          <template #header>
            <div class="card-header">
              <el-icon class="header-icon" color="#e6a23c"><Location /></el-icon>
              <span>{{ t('orders.shippingInfo') }}</span>
            </div>
          </template>
          <el-descriptions :column="3" border>
            <el-descriptions-item :label="t('orders.contactName')">
              {{ selectedOrder.contact_name }}
            </el-descriptions-item>
            <el-descriptions-item :label="t('orders.contactPhone')">
              {{ selectedOrder.contact_phone }}
            </el-descriptions-item>
            <el-descriptions-item :label="t('orders.address')" :span="3">
              <el-text class="address-text">{{ selectedOrder.delivery_address }}</el-text>
            </el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 商品列表卡片 -->
        <el-card v-if="selectedOrder.items && selectedOrder.items.length > 0" shadow="never" class="info-card">
          <template #header>
            <div class="card-header">
              <el-icon class="header-icon" color="#f56c6c"><ShoppingBag /></el-icon>
              <span>{{ t('orders.productList') }}</span>
              <el-tag type="info" size="small" class="item-count">
                {{ selectedOrder.items.length }} {{ selectedOrder.items.length > 1 ? 'items' : 'item' }}
              </el-tag>
            </div>
          </template>
          <div class="product-list">
            <div 
              v-for="(item, index) in selectedOrder.items" 
              :key="item.id"
              class="product-item"
              :class="{ 'item-border': index < selectedOrder.items.length - 1 }"
            >
              <div class="product-main">
                <div class="product-info">
                  <h4 class="product-name">{{ item.product_name_zh }}</h4>
                  <div class="product-meta">
                    <el-tag size="small" type="info">
                      {{ t('orders.quantity') }}: {{ item.quantity }}
                    </el-tag>
                    <template v-if="item.discount && item.discount > 0">
                      <span class="price-current">{{ t('orders.price') }}: {{ t('common.currency') }}{{ item.price }}</span>
                      <span class="price-original">{{ t('common.currency') }}{{ item.original_price }}</span>
                      <el-tag type="danger" size="small">{{ item.discount }}%折</el-tag>
                    </template>
                    <template v-else>
                      <span class="price-current">{{ t('orders.price') }}: {{ t('common.currency') }}{{ item.price }}</span>
                    </template>
                  </div>
                </div>
                <div class="product-total">
                  <div class="total-label">小计</div>
                  <div class="total-amount">{{ t('common.currency') }}{{ (item.price * item.quantity).toFixed(2) }}</div>
                </div>
              </div>
            </div>
          </div>
        </el-card>

        <!-- 订单备注卡片 -->
        <el-card v-if="selectedOrder.notes" shadow="never" class="info-card">
          <template #header>
            <div class="card-header">
              <el-icon class="header-icon" color="#909399"><ChatLineRound /></el-icon>
              <span>订单备注</span>
            </div>
          </template>
          <el-text class="notes-text">{{ selectedOrder.notes }}</el-text>
        </el-card>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Download, TrendCharts, SuccessFilled, Coin, Calendar, Document, User, Location, ShoppingBag, ChatLineRound } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { useAdminStore } from '../stores/admin.js'

const { t } = useI18n()

// 使用adminStore
const adminStore = useAdminStore()

// 响应式数据
const orders = ref([])
const loading = ref(false)
const isExporting = ref(false)
const showDetailModal = ref(false)
const selectedOrder = ref(null)

// 分页数据
const currentPage = ref(1)
const pageSize = ref(20)

// 筛选条件
const filters = reactive({
  status: '',
  keyword: '',
  startDate: '',
  endDate: ''
})

// 分页信息
const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0
})

// 统计信息
const stats = computed(() => {
  const total = orders.value.length
  const completed = orders.value.filter(order => order.status === 'completed').length
  const totalAmount = orders.value.reduce((sum, order) => sum + parseFloat(order.total_amount || 0), 0).toFixed(2)
  
  const today = new Date().toDateString()
  const todayOrders = orders.value.filter(order => new Date(order.created_at).toDateString() === today)
  const todayAmount = todayOrders.reduce((sum, order) => sum + parseFloat(order.total_amount || 0), 0).toFixed(2)
  
  return {
    total,
    completed,
    totalAmount,
    todayAmount
  }
})

// 搜索防抖
let searchTimeout = null
const debounceSearch = () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    loadOrders()
  }, 500)
}

// 加载订单列表
const loadOrders = async () => {
  try {
    loading.value = true
    const params = {
      page: pagination.page,
      limit: pagination.limit,
      ...filters
    }
    
    const queryString = new URLSearchParams(params).toString()
    const response = await adminStore.apiRequest(`/api/admin/orders?${queryString}`, {
      method: 'GET'
    })
    
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        orders.value = data.data?.orders || []
        pagination.total = data.data?.total || 0
        pagination.totalPages = data.data?.totalPages || 1
      }
    } else {
      const errorData = await response.json()
      ElMessage.error(t('orders.messages.loadFailed') + '：' + (errorData.message || '未知错误'))
    }
  } catch (error) {
    console.error('加载订单失败:', error)
    ElMessage.error(t('orders.messages.loadFailed') + '：' + (error.response?.data?.message || error.message))
  } finally {
    loading.value = false
  }
}



// 删除订单
const deleteOrder = async (orderId) => {
  try {
    await ElMessageBox.confirm(
      t('orders.messages.confirmDelete'),
      t('common.confirm'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    
    const response = await adminStore.apiRequest(`/api/admin/orders/${orderId}`, {
      method: 'DELETE'
    })
    
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        ElMessage.success(t('orders.messages.deleteSuccess'))
        loadOrders()
      } else {
        ElMessage.error(data.message || t('orders.messages.deleteFailed'))
      }
    } else {
      const errorData = await response.json()
      ElMessage.error(errorData.message || t('orders.messages.deleteFailed'))
    }
  } catch (error) {
    if (error === 'cancel') {
      return // 用户取消操作
    }
    console.error('删除订单失败:', error)
    ElMessage.error(t('orders.messages.deleteFailed') + '：' + (error.response?.data?.message || error.message))
  }
}

// 查看订单详情
const viewOrderDetail = (order) => {
  try {
    selectedOrder.value = order // 显示基本信息
    showDetailModal.value = true
    
    // 暂时只显示基本信息，避免API调用导致的路由问题
    // 后续可以在API稳定后再添加详细信息获取
    console.log('显示订单详情:', order)
  } catch (error) {
    console.error('显示订单详情失败:', error)
    ElMessage.error(t('orders.messages.loadFailed'))
  }
}

// 关闭详情模态框
const closeDetailModal = () => {
  showDetailModal.value = false
  selectedOrder.value = null
}

// 导出订单
const exportOrders = async () => {
  try {
    isExporting.value = true
    ElMessage.info(t('orders.messages.exporting'))
    
    // 调用导出API
    const response = await adminStore.apiRequest('/api/admin/export/orders', {
      method: 'GET'
    })
    
    if (response.ok) {
      // 获取文件数据
      const blob = await response.blob()
      
      // 创建下载链接
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      
      // 从响应头获取文件名，如果没有则使用默认名称
      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `订单数据_${new Date().toISOString().split('T')[0]}.xlsx`
      
      if (contentDisposition) {
        const matches = contentDisposition.match(/filename\*=UTF-8''(.+)/)
        if (matches) {
          filename = decodeURIComponent(matches[1])
        }
      }
      
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      
      ElMessage.success(t('orders.messages.exportSuccess'))
    } else {
      const errorData = await response.json()
      ElMessage.error(errorData.message || t('orders.messages.exportFailed'))
    }
  } catch (error) {
    console.error('导出订单失败:', error)
    ElMessage.error(t('orders.messages.exportFailed'))
  } finally {
    isExporting.value = false
  }
}

// 分页切换
const changePage = (newPage) => {
  if (newPage >= 1 && newPage <= pagination.totalPages) {
    pagination.page = newPage
    loadOrders()
  }
}

// Element Plus分页处理
const handleSizeChange = (size) => {
  pageSize.value = size
  currentPage.value = 1
  pagination.page = 1
  pagination.limit = size
  loadOrders()
}

const handleCurrentChange = (page) => {
  currentPage.value = page
  pagination.page = page
  loadOrders()
}

// 重置筛选条件
const resetFilters = () => {
  Object.assign(filters, {
    status: '',
    keyword: '',
    startDate: '',
    endDate: ''
  })
  currentPage.value = 1
  pagination.page = 1
  loadOrders()
}

// 工具函数
const formatDate = (dateString) => {
  return new Date(dateString).toLocaleString('zh-CN')
}

const getStatusText = (status) => {
  const statusMap = {
    completed: t('orders.statusOptions.completed'),
    pending: t('orders.statusOptions.pending'),
    cancelled: t('orders.statusOptions.cancelled'),
    processing: t('orders.statusOptions.processing'),
    shipped: t('orders.statusOptions.shipped')
  }
  return statusMap[status] || status
}

const getStatusTagType = (status) => {
  const tagTypeMap = {
    completed: 'success',
    pending: 'warning',
    cancelled: 'danger'
  }
  return tagTypeMap[status] || 'info'
}

const getStatusClass = (status) => {
  return `status-${status}`
}

const getPaymentMethodText = (method) => {
  return method === 'cod' ? '💰 ' + t('common.cod') : '💳 ' + t('common.online')
}

const getPaymentMethodClass = (method) => {
  return `payment-${method}`
}

// 组件挂载时加载数据
onMounted(() => {
  loadOrders()
})
</script>

<style scoped>
.orders-management {
  padding: 0;
}

/* 页面标题 */
.page-header {
  background: white;
  padding: 24px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  margin-bottom: 20px;
}

.page-title {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
  margin: 0 0 8px 0;
}

.page-description {
  color: #909399;
  font-size: 14px;
  margin: 0;
}

/* 搜索筛选区域 */
.filter-section {
  margin-bottom: 20px;
}

.search-form {
  padding: 8px 0;
}

/* 统计卡片 */
.stats-section {
  margin-bottom: 20px;
}

.stats-card {
  position: relative;
  padding: 20px;
  cursor: pointer;
  transition: all 0.3s;
}

.stats-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.stats-content {
  padding: 10px 0;
}

.stats-value {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
  line-height: 1;
}

.stats-label {
  font-size: 14px;
  color: #909399;
  margin-top: 8px;
}

.stats-icon {
  position: absolute;
  right: 20px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0.8;
}

/* 表格区域 */
.table-section {
  margin-bottom: 20px;
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  color: #303133;
}

.table-info {
  font-size: 14px;
  color: #909399;
  font-weight: normal;
}

.table-wrapper {
  overflow-x: auto;
}

.order-table {
  font-size: 14px;
}

.order-table .el-table__cell {
  padding: 12px 8px;
}

.order-table .el-table__body td {
  border-bottom: 1px solid #EBEEF5;
}

/* 表格内容样式 */
.order-no {
  font-family: 'Monaco', 'Consolas', monospace;
  font-weight: 600;
  color: #409EFF;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-info {
  line-height: 1.4;
}

.user-nickname {
  font-weight: 600;
  color: #303133;
  margin-bottom: 2px;
}

.user-phone {
  font-size: 12px;
  color: #909399;
}

.amount {
  font-weight: 600;
  color: #67C23A;
  font-size: 15px;
}

/* 订单商品样式 */
.order-items-list {
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  overflow: hidden;
}

.order-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f5f7fa;
}

.order-item:last-child {
  border-bottom: none;
}

.item-info {
  flex: 1;
}

.item-name {
  font-weight: 500;
  color: #303133;
  margin-bottom: 4px;
}

.item-details {
  font-size: 12px;
  color: #909399;
}

.original-price {
  text-decoration: line-through;
  color: #c0c4cc;
  margin-left: 4px;
}

.discount-tag {
  background: #f56c6c;
  color: white;
  padding: 1px 4px;
  border-radius: 2px;
  font-size: 10px;
  margin-left: 4px;
}

.item-total {
  font-weight: 600;
  color: #67C23A;
  font-size: 14px;
}

.contact-info {
  line-height: 1.4;
}

.contact-name {
  font-weight: 500;
  color: #303133;
  margin-bottom: 2px;
}

.contact-phone {
  font-size: 12px;
  color: #909399;
}

.created-time {
  font-size: 12px;
  color: #909399;
}

/* 分页 */
.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 20px;
  padding: 20px 0;
}



/* 订单详情对话框样式 */
.order-detail-dialog {
  .el-dialog__header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 20px 24px;
    border-radius: 8px 8px 0 0;
  }
  
  .el-dialog__title {
    color: white;
    font-weight: 600;
    font-size: 18px;
  }
  
  .el-dialog__headerbtn .el-dialog__close {
    color: white;
    font-size: 20px;
    
    &:hover {
      color: #f0f0f0;
    }
  }
  
  .el-dialog__body {
    padding: 20px;
    background: #f8fafc;
  }
}

.order-detail-container {
  .detail-row {
    margin-bottom: 20px;
  }
  
  .info-card {
    margin-bottom: 20px;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    
    &:last-child {
      margin-bottom: 0;
    }
    
    .el-card__header {
      background: white;
      padding: 16px 20px;
      border-bottom: 1px solid #f0f0f0;
    }
    
    .el-card__body {
      padding: 20px;
      background: white;
    }
  }
  
  .card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    color: #374151;
    
    .header-icon {
      font-size: 18px;
    }
    
    .item-count {
      margin-left: auto;
    }
  }
  
  .amount-text {
    font-size: 16px;
    font-weight: 600;
    color: #059669;
  }
  
  .address-text {
    color: #6b7280;
    line-height: 1.5;
  }
  
  .notes-text {
    color: #6b7280;
    line-height: 1.6;
    font-style: italic;
  }
}

/* 商品列表样式 */
.product-list {
  .product-item {
    padding: 16px 0;
    
    &.item-border {
      border-bottom: 1px solid #f0f0f0;
    }
    
    .product-main {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
    }
    
    .product-info {
      flex: 1;
      
      .product-name {
        margin: 0 0 12px 0;
        font-size: 16px;
        font-weight: 600;
        color: #1f2937;
        line-height: 1.4;
      }
      
      .product-meta {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        
        .price-current {
          color: #059669;
          font-weight: 500;
        }
        
        .price-original {
          color: #9ca3af;
          text-decoration: line-through;
          font-size: 14px;
        }
      }
    }
    
    .product-total {
      text-align: right;
      min-width: 100px;
      
      .total-label {
        font-size: 12px;
        color: #9ca3af;
        margin-bottom: 4px;
      }
      
      .total-amount {
        font-size: 18px;
        font-weight: 600;
        color: #1f2937;
      }
    }
  }
}

/* Element Plus 组件样式定制 */
.order-detail-dialog {
  .el-descriptions {
    .el-descriptions__label {
      background: #f9fafb;
      color: #374151;
      font-weight: 500;
    }
    
    .el-descriptions__content {
      background: white;
      color: #1f2937;
    }
  }
  
  .el-tag {
    border: none;
    font-weight: 500;
    
    &.el-tag--info {
      background: #e5f3ff;
      color: #0066cc;
    }
    
    &.el-tag--success {
      background: #dcfce7;
      color: #166534;
    }
    
    &.el-tag--warning {
      background: #fef3c7;
      color: #92400e;
    }
    
    &.el-tag--danger {
      background: #fee2e2;
      color: #dc2626;
    }
  }
}

@media (max-width: 768px) {
  .filters {
    flex-direction: column;
  }
  
  .orders-table {
    font-size: 12px;
  }
  
  .orders-table th,
  .orders-table td {
    padding: 8px 4px;
  }
  
  .order-detail-dialog {
    .order-detail-container .detail-row {
      flex-direction: column;
    }
    
    .product-item .product-main {
      flex-direction: column;
      gap: 12px;
    }
    
    .product-total {
      text-align: left;
    }
  }
}

.action-buttons {
  display: flex;
  gap: 8px;
  justify-content: center;
  align-items: center;
  white-space: nowrap;
}

.action-buttons .el-button {
  margin: 0 !important;
  min-width: 60px;
  flex-shrink: 0;
}
</style>