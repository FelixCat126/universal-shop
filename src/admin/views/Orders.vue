<template>
  <div class="orders-management">
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
          </el-form-item>
        </el-form>
      </el-card>
    </div>

    <div class="admin-module-toolbar">
      <el-button type="success" @click="exportOrders" :loading="isExporting">
        <el-icon><Download /></el-icon>
        {{ t('orders.export') }}
      </el-button>
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

        <el-table-column :label="t('orders.user')" width="180" min-width="160">
          <template #default="scope">
            <div class="user-info">
              <div class="user-nickname">{{ scope.row.user?.nickname || t('common.unknown') }}</div>
              <div v-if="scope.row.user?.phone" class="user-phone">{{ scope.row.user.phone }}</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column :label="t('orders.amount')" width="200" align="center">
          <template #default="scope">
            <div class="amount">
              <template v-if="scope.row.payment_method === 'points'">
                <div class="converted-amount">{{ adminOrderPointsLabel(scope.row) }}</div>
              </template>
              <template v-else>
                <div class="converted-amount">{{ formatRecordedOrderAmount(scope.row).mainLabel }}</div>
                <div v-if="scope.row.payment_method === 'online'" class="original-amount">≈ {{ adminUsdtHint(scope.row) }} USDT</div>
                <div
                  v-if="scope.row.currency_code && scope.row.currency_code !== 'THB' && scope.row.total_amount_thb != null"
                  class="original-amount"
                >
                  ≈ {{ t('common.currency') }}{{ Number(scope.row.total_amount_thb).toFixed(2) }} THB
                </div>
              </template>
            </div>
          </template>
        </el-table-column>

        <el-table-column :label="t('common.paymentMethod')" width="150" align="center">
          <template #default="scope">
            <el-tag
              :type="scope.row.payment_method === 'cod' ? 'warning' : scope.row.payment_method === 'online' ? 'success' : 'info'"
              size="small"
            >
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


        <el-table-column :label="t('orders.recipientInfo')" width="200" min-width="180">
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
      <div v-loading="detailLoading" class="order-detail-loading-wrap">
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
                  <span class="amount-text">
                    <template v-if="selectedOrder.payment_method === 'points'">
                      <div class="primary-amount">{{ adminOrderPointsLabel(selectedOrder) }}</div>
                    </template>
                    <template v-else>
                      <div class="primary-amount">{{ formatRecordedOrderAmount(selectedOrder).mainLabel }}</div>
                      <div v-if="selectedOrder.payment_method === 'online'" class="original-amount-detail">≈ {{ adminUsdtHint(selectedOrder) }} USDT</div>
                      <div
                        v-if="selectedOrder.currency_code && selectedOrder.currency_code !== 'THB' && selectedOrder.total_amount_thb != null"
                        class="original-amount-detail"
                      >
                        ≈ {{ t('common.currency') }}{{ Number(selectedOrder.total_amount_thb).toFixed(2) }} THB
                      </div>
                    </template>
                  </span>
                </el-descriptions-item>
                <el-descriptions-item :label="t('common.paymentMethod')">
                  <el-tag 
                    :type="selectedOrder.payment_method === 'cod' ? 'warning' : selectedOrder.payment_method === 'online' ? 'success' : 'info'"
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
                <el-descriptions-item :label="t('user.referredBy')">
                  {{ selectedOrder.user?.referrer?.nickname || selectedOrder.user?.dataValues?.referrer?.nickname || '-' }}
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
          <el-descriptions :column="2" border>
            <el-descriptions-item :label="t('orders.contactName')">
              {{ selectedOrder.contact_name }}
            </el-descriptions-item>
            <el-descriptions-item :label="t('orders.contactPhone')">
              {{ selectedOrder.contact_phone }}
            </el-descriptions-item>
            <el-descriptions-item :label="t('orders.address')" :span="2">
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
                {{ t('orders.productListCount', { n: selectedOrder.items.length }) }}
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
                <div class="product-thumb-wrap">
                  <img
                    class="product-thumb"
                    :src="orderLineImageSrc(item)"
                    alt=""
                    @error="onOrderLineImageError"
                  />
                </div>
                <div class="product-info">
                  <h4 class="product-name">{{ item.product_name_zh }}</h4>
                  <div class="product-meta">
                    <el-tag size="small" type="info">
                      {{ t('orders.quantity') }}: {{ item.quantity }}
                    </el-tag>
                    <template v-if="item.discount && item.discount > 0">
                      <span class="price-current">{{ t('orders.price') }} (THB): {{ item.price }}</span>
                      <span class="price-original">{{ t('orders.originalPrice') }} (THB): {{ item.original_price }}</span>
                      <el-tag type="danger" size="small">{{ item.discount }}%折</el-tag>
                    </template>
                    <template v-else>
                      <span class="price-current">{{ t('orders.price') }} (THB): {{ item.price }}</span>
                    </template>
                  </div>
                </div>
                <div class="product-total">
                  <div class="total-label">{{ t('orders.subtotal') }}</div>
                  <div class="total-amount">
                    <template v-if="selectedOrder.payment_method === 'points'">
                      <div>{{ adminLinePointsLabel(item) }}</div>
                      <div class="text-xs text-gray-500">{{ t('orders.priceThbRef', { v: (item.price * item.quantity).toFixed(2) }) }}</div>
                    </template>
                    <template v-else>
                      <div>{{ formatLineRecordedFromThb(selectedOrder, item.price * item.quantity) }}</div>
                      <div class="text-xs text-gray-500">THB {{ (item.price * item.quantity).toFixed(2) }}</div>
                    </template>
                  </div>
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
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Refresh, Download, TrendCharts, SuccessFilled, Coin, Calendar, Document, User, Location, ShoppingBag, ChatLineRound } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useAdminStore } from '../stores/admin.js'
import config from '../../config/index.js'
import { formatRecordedOrderAmount, formatLineRecordedFromThb } from '../../portal/utils/orderBillingDisplay.js'

const orderLineImgFallback =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik02MCA2MEgxNDBWMTQwSDYwVjYwWiIgc3Ryb2tlPSIjOUI5QkEwIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiLz4KPGNpcmNsZSBjeD0iODAiIGN5PSI4MCIgcj0iMTAiIGZpbGw9IiM5QjlCQTAiLz4KPHBhdGggZD0iTTkwIDEwMEwxMjAgNzBMMTMwIDgwTDEyMCAxMDBMOTAgMTAwWiIgZmlsbD0iIzlCOUJBMCIvPgo8L3N2Zz4K'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

// 使用adminStore
const adminStore = useAdminStore()

// 响应式数据
const orders = ref([])
const loading = ref(false)
const isExporting = ref(false)
const showDetailModal = ref(false)
const selectedOrder = ref(null)
const detailLoading = ref(false)

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
  const sumOrderThb = (order) => {
    if (order.payment_method === 'points') return 0
    const raw =
      order.total_amount_thb != null && order.total_amount_thb !== ''
        ? order.total_amount_thb
        : order.total_amount
    return parseFloat(raw || 0)
  }
  const totalAmount = orders.value.reduce((sum, order) => sum + sumOrderThb(order), 0).toFixed(2)

  const today = new Date().toDateString()
  const todayOrders = orders.value.filter(order => new Date(order.created_at).toDateString() === today)
  const todayAmount = todayOrders.reduce((sum, order) => sum + sumOrderThb(order), 0).toFixed(2)
  
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
    
    // 显示加载状态
    const loadingMessage = ElMessage({
      message: t('orders.messages.deleting'),
      type: 'info',
      duration: 0
    })
    
    const response = await adminStore.apiRequest(`/api/admin/orders/${orderId}`, {
      method: 'DELETE'
    })
    
    // 关闭加载消息
    loadingMessage.close()
    
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        ElMessage.success(t('orders.messages.deleteSuccess'))
        // 刷新订单列表
        await loadOrders()
      } else {
        ElMessage.error(data.message || t('orders.messages.deleteFailed'))
      }
    } else {
      const errorData = await response.json().catch(() => ({ message: '网络错误' }))
      ElMessage.error(errorData.message || t('orders.messages.deleteFailed'))
    }
  } catch (error) {
    if (error === 'cancel') {
      return // 用户取消操作
    }
    console.error('删除订单失败:', error)
    ElMessage.error(t('orders.messages.deleteFailed') + '：' + (error.message || '未知错误'))
  }
}

// 查看订单详情
const viewOrderDetail = async (order) => {
  showDetailModal.value = true
  selectedOrder.value = null
  detailLoading.value = true
  try {
    const response = await adminStore.apiRequest(`/api/admin/orders/${order.id}`, {
      method: 'GET'
    })
    let data = {}
    try {
      data = await response.json()
    } catch {
      data = {}
    }
    if (!response.ok || !data.success) {
      ElMessage.error((data && data.message) ? data.message : t('orders.messages.detailLoadFailed'))
      showDetailModal.value = false
      return
    }
    selectedOrder.value = data.data
  } catch (error) {
    console.error('加载订单详情失败:', error)
    ElMessage.error(t('orders.messages.detailLoadFailed'))
    showDetailModal.value = false
  } finally {
    detailLoading.value = false
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

    const response = await adminStore.apiRequest('/api/admin/export/orders', {
      method: 'GET'
    })

    if (response.ok) {
      const blob = await response.blob()

      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url

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
const syncKeywordFromRoute = () => {
  const qk = route.query.keyword
  filters.keyword = qk != null && String(qk).trim() !== '' ? String(qk).trim() : ''
}

const resetFilters = () => {
  Object.assign(filters, {
    status: '',
    keyword: '',
    startDate: '',
    endDate: ''
  })
  currentPage.value = 1
  pagination.page = 1
  if (route.query.keyword != null && String(route.query.keyword).trim() !== '') {
    router.replace({ name: 'Orders', query: {} })
    return
  }
  loadOrders()
}

watch(
  () => route.query.keyword,
  () => {
    syncKeywordFromRoute()
    currentPage.value = 1
    pagination.page = 1
    loadOrders()
  }
)

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
    shipped: t('orders.statusOptions.shipped'),
    shipping: t('orders.statusOptions.shipping')
  }
  return statusMap[status] || status
}

const getStatusTagType = (status) => {
  const tagTypeMap = {
    completed: 'success',
    pending: 'warning',
    cancelled: 'danger',
    shipping: 'info'
  }
  return tagTypeMap[status] || 'info'
}

const getStatusClass = (status) => {
  return `status-${status}`
}

const getPaymentMethodText = (method) => {
  if (method === 'cod') return '💰 ' + t('common.cod')
  if (method === 'online') return '💳 ' + t('common.online')
  if (method === 'points') return '⭐ ' + t('common.pointsRedeem')
  return String(method || '')
}

const getPaymentMethodClass = (method) => {
  return `payment-${method}`
}

const adminUsdtHint = (row) => {
  const thb = parseFloat(row.total_amount_thb)
  const r = parseFloat(row.exchange_rate)
  if (!(Number.isFinite(thb) && Number.isFinite(r))) return '0.00'
  return (thb * r).toFixed(2)
}

/** 管理端列表/详情：积分换购订单展示本单扣除积分 */
const adminOrderPointsLabel = (order) => {
  const n = Number(order?.points_redeemed)
  if (Number.isFinite(n) && n >= 0) {
    return t('orders.pointsPaidDisplay', { n })
  }
  return '—'
}

const adminLinePointsLabel = (item) => {
  const n = Number(item?.points_line_cost)
  if (Number.isFinite(n) && n >= 0) {
    return t('orders.linePointsDisplay', { n })
  }
  return '—'
}

const orderLineImageSrc = (item) => {
  const raw = item?.product?.image_url ?? item?.product?.image ?? ''
  const u = typeof raw === 'string' ? raw.trim() : ''
  if (!u) return orderLineImgFallback
  return config.buildStaticUrl(u) || orderLineImgFallback
}

const onOrderLineImageError = (event) => {
  event.target.src = orderLineImgFallback
}

// 组件挂载时加载数据
onMounted(() => {
  syncKeywordFromRoute()
  loadOrders()
})
</script>

<style scoped>
.orders-management {
  padding: 0;
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

.converted-amount {
  font-weight: 600;
  color: #409EFF;
  font-size: 14px;
  line-height: 1.2;
}

.original-amount {
  font-size: 12px;
  color: #909399;
  line-height: 1.2;
  margin-top: 2px;
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

.order-detail-loading-wrap {
  min-height: 200px;
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
  
  .exchange-rate-info {
    font-size: 14px;
    font-weight: 400;
    color: #6b7280;
    margin-left: 8px;
  }
  
  .primary-amount {
    font-size: 18px;
    font-weight: 600;
    color: #409EFF;
    line-height: 1.2;
  }
  
  .original-amount-detail {
    font-size: 14px;
    color: #6b7280;
    margin-top: 4px;
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
      align-items: center;
      gap: 16px;
    }

    .product-thumb-wrap {
      flex-shrink: 0;
      width: 80px;
      height: 80px;
      border-radius: 8px;
      overflow: hidden;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
    }

    .product-thumb {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .product-info {
      flex: 1;
      min-width: 0;
      
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
      flex-direction: row;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 12px;
    }

    .product-item .product-thumb-wrap {
      width: 64px;
      height: 64px;
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