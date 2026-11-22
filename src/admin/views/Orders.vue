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
              multiple
              collapse-tags
              :max-collapse-tags="2"
              clearable
              style="width: 190px"
              @change="applyFilters"
            >
              <el-option :label="t('orders.statusOptions.completed')" value="completed" />
              <el-option :label="t('orders.statusOptions.pending')" value="pending" />
              <el-option :label="t('orders.statusOptions.paid')" value="paid" />
              <el-option :label="t('orders.statusOptions.shipping')" value="shipping" />
              <el-option :label="t('orders.statusOptions.shipped')" value="shipped" />
              <el-option :label="t('orders.statusOptions.delivered')" value="delivered" />
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
            <!--
              ⚠️ 必须带 value-format。
              不带的话 v-model 拿到的是 **Date 对象**，经 URLSearchParams 会变成
              "Thu Nov 12 2026 00:00:00 GMT+0800 (China Standard Time)" 这种串，
              后端直接 500（PG 认不了 "GMT+0800" 这个时区名）。
            -->
            <el-date-picker
              v-model="filters.startDate"
              type="date"
              value-format="YYYY-MM-DD"
              :placeholder="t('orders.selectStartDate')"
              style="width: 150px"
              @change="applyFilters"
            />
          </el-form-item>
          
          <el-form-item :label="t('orders.endDate')">
            <el-date-picker
              v-model="filters.endDate"
              type="date"
              value-format="YYYY-MM-DD"
              :placeholder="t('orders.selectEndDate')"
              style="width: 150px"
              @change="applyFilters"
            />
          </el-form-item>
          
          <el-form-item>
            <el-button type="primary" @click="applyFilters" :loading="loading">
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
      <el-button type="success" @click="openExportTasks('orders')">
        <el-icon><Download /></el-icon>
        {{ t('orders.export') }}
      </el-button>
    </div>

    <!-- 异步导出任务（大数据量走后台生成，避免请求超时） -->
    <ExportTaskDialog
      v-model="showExportTasks"
      :default-type="exportTaskType"
      :params="exportParams"
    />

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
          <!-- 批量改状态：选中后出现（今天这几单一起发/这批单全部完成，运营的高频动作） -->
          <div
            v-if="selectedOrderIds.length"
            class="bulk-bar"
          >
            <span class="bulk-bar__count">{{ t('orders.bulkSelected', { count: selectedOrderIds.length }) }}</span>
            <el-select
              v-model="bulkStatus"
              :placeholder="t('orders.bulkTargetStatus')"
              size="small"
              style="width: 160px"
            >
              <el-option
                v-for="s in bulkStatusOptions"
                :key="s"
                :label="t(`orders.statusOptions.${s}`)"
                :value="s"
              />
            </el-select>
            <el-button
              size="small"
              type="primary"
              :loading="bulkActing"
              :disabled="!bulkStatus"
              @click="applyBulkStatus"
            >
              {{ t('orders.bulkApply') }}
            </el-button>
          </div>

          <el-table
            ref="orderTableRef"
            :data="orders"
            v-loading="loading"
            stripe
            border
            row-key="id"
            style="width: 100%"
            :default-sort="{ prop: 'created_at', order: 'descending' }"
            table-layout="fixed"
            class="order-table"
            @selection-change="onSelectionChange"
          
            :empty-text="t('common.noData')">
        <!--
          ⚠️ reserve-selection 必须开。
          不开的话，30 秒自动刷新会用新数组替换 orders → Element Plus 判定
          "数据实例变了" → clearSelection() 把勾选**静默清空**，
          运营勾好一��单准备批量改状态，等 30 秒勾就没了（还以为是系统抽风）。
        -->
        <el-table-column type="selection" width="46" reserve-selection />
        <el-table-column prop="order_no" :label="t('orders.orderNumber')" width="140" align="center">
          <template #default="scope">
            <div class="order-no">{{ scope.row.order_no }}</div>
          </template>
        </el-table-column>

        <el-table-column :label="t('orders.user')" width="120" min-width="110">
          <template #default="scope">
            <div class="user-info">
              <div class="user-nickname">{{ scope.row.user?.nickname || t('common.unknown') }}</div>
              <div v-if="scope.row.user?.phone" class="user-phone">{{ scope.row.user.phone }}</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column :label="t('orders.amount')" width="140" align="center">
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
                  ≈ {{ t('common.currency') }}{{ formatThbAmount(scope.row.total_amount_thb) }} THB
                </div>
              </template>
            </div>
          </template>
        </el-table-column>

        <el-table-column :label="t('common.paymentMethod')" width="105" align="center">
          <template #default="scope">
            <el-tag
              :type="scope.row.payment_method === 'cod' ? 'warning' : scope.row.payment_method === 'online' ? 'success' : 'info'"
              size="small"
            >
              {{ getPaymentMethodText(scope.row.payment_method) }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column :label="t('orders.status')" width="110" align="center">
          <template #default="scope">
            <el-tag :type="getStatusTagType(scope.row.status)" size="small">
              {{ getStatusText(scope.row.status) }}
            </el-tag>
          </template>
        </el-table-column>


        <el-table-column :label="t('orders.recipientInfo')" width="145" min-width="135">
          <template #default="scope">
            <div class="contact-info">
              <div class="contact-name">{{ scope.row.contact_name }}</div>
              <div class="contact-phone">{{ scope.row.contact_phone }}</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column :label="t('orders.orderDate')" width="125" align="center">
          <template #default="scope">
            <div class="created-time">{{ formatDate(scope.row.created_at) }}</div>
          </template>
        </el-table-column>

        <el-table-column :label="t('orders.actions')" width="110" align="center" fixed="right">
          <template #default="scope">
            <el-dropdown trigger="click" @command="(cmd) => handleOrderAction(cmd, scope.row)">
              <el-button size="small">
                {{ t('orders.actions') }}<el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <!--
                    **快捷改状态**：运营最高频的动作是发货/改状态，
                    原来必须「操作 → 查看详情 → 在弹窗里选状态 → 保存」＝4 次点击。
                    这里把该订单**当前状态允许流转到的状态**直接列进菜单：
                    点一次菜单 + 一次确认 = 2 次，且不用离开当前列表上下文。
                  -->
                  <el-dropdown-item
                    v-for="st in nextStatusesOf(scope.row)"
                    :key="'st_' + st"
                    :command="'status:' + st"
                  >
                    {{ t('orders.quickTo') }} {{ getStatusText(st) }}
                  </el-dropdown-item>
                  <el-dropdown-item command="detail" divided>{{ t('orders.viewDetails') }}</el-dropdown-item>
                  <!--
                    删除订单后端要求 super_admin（adminRoutes.js: DELETE /orders/:id）。
                    原来界面**不拦** → 操作员点了只得到一句"权限不足"，
                    看起来像系统坏了。现在按后端同一把尺子隐藏。
                  -->
                  <el-dropdown-item v-if="adminStore.isSuperAdmin" command="delete">
                    {{ t('common.delete') }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
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
            :total="pagination.total"
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
      width="min(900px, 94vw)"
      top="5vh"
      class="order-detail-dialog"
      :before-close="closeDetailModal"
    >
      <!-- 履约操作：改状态 / 填物流单号 / 内部备注 -->
      <template #footer>
        <!-- 窄屏（手机/平板）下改成整行堆叠，固定宽度会挤爆弹窗底部 -->
        <div style="display: flex; flex-direction: column; flex-wrap: wrap; align-items: flex-end; gap: 12px; justify-content: flex-end;">
          <div class="w-full sm:w-44">
            <label class="block text-xs text-gray-500 mb-1">{{ t('orders.trackingNumber') }}</label>
            <el-input
              v-model="fulfillForm.tracking_number"
              size="small"
              :placeholder="t('orders.trackingNumberPlaceholder')"
            />
          </div>
          <div class="w-full sm:w-56">
            <label class="block text-xs text-gray-500 mb-1">{{ t('orders.adminNote') }}</label>
            <el-input
              v-model="fulfillForm.admin_note"
              size="small"
              :placeholder="t('orders.adminNotePlaceholder')"
            />
          </div>
          <div class="w-full sm:w-40">
            <label class="block text-xs text-gray-500 mb-1">{{ t('orders.status') }}</label>
            <el-select v-model="fulfillForm.status" size="small" :placeholder="t('orders.pickStatus')">
              <el-option
                v-for="st in allowedNextStatuses"
                :key="st"
                :label="getStatusText(st)"
                :value="st"
              />
            </el-select>
          </div>
          <el-button
            type="primary"
            :loading="fulfillSaving"
            :disabled="!fulfillForm.status"
            @click="submitFulfillment"
          >
            {{ t('orders.saveFulfillment') }}
          </el-button>
        </div>
      </template>

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
                <el-descriptions-item :label="t('orders.trackingNumber')">
                  <span v-if="selectedOrder.tracking_number">{{ selectedOrder.tracking_number }}</span>
                  <span v-else class="text-gray-400">-</span>
                </el-descriptions-item>
                <el-descriptions-item :label="t('orders.shippedAt')">
                  <span v-if="selectedOrder.shipped_at">{{ formatDate(selectedOrder.shipped_at) }}</span>
                  <span v-else class="text-gray-400">-</span>
                </el-descriptions-item>
                <el-descriptions-item :label="t('orders.adminNote')" :span="2">
                  <span v-if="selectedOrder.admin_note" class="whitespace-pre-wrap">{{ selectedOrder.admin_note }}</span>
                  <span v-else class="text-gray-400">-</span>
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
                        ≈ {{ t('common.currency') }}{{ formatThbAmount(selectedOrder.total_amount_thb) }} THB
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
                      <div class="text-xs text-gray-500">{{ t('orders.priceThbRef', { v: formatAmount(lineTotalOf(item)) }) }}</div>
                    </template>
                    <template v-else>
                      <div>{{ formatLineRecordedFromThb(selectedOrder, lineTotalOf(item)) }}</div>
                      <div class="text-xs text-gray-500">THB {{ formatAmount(lineTotalOf(item)) }}</div>
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
import { ref, reactive, onMounted, computed, watch, onUnmounted } from 'vue'
import { formatAmount } from '../../shared/money.js'
import { ElMessage, ElMessageBox } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import { Search, Refresh, Download, TrendCharts, SuccessFilled, Coin, Calendar, Document, User, Location, ShoppingBag, ChatLineRound, ArrowDown } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { useAutoRefresh } from '../composables/useAutoRefresh.js'
import { useRoute, useRouter } from 'vue-router'
import { useAdminStore } from '../stores/admin.js'
import ExportTaskDialog from '../components/ExportTaskDialog.vue'
import { updateOrderStatus, bulkUpdateOrderStatus } from '../api/orders.js'
import config from '../../config/index.js'
import { formatRecordedOrderAmount, formatLineRecordedFromThb } from '../../portal/utils/orderBillingDisplay.js'

const orderLineImgFallback =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik02MCA2MEgxNDBWMTQwSDYwVjYwWiIgc3Ryb2tlPSIjOUI5QkEwIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiLz4KPGNpcmNsZSBjeD0iODAiIGN5PSI4MCIgcj0iMTAiIGZpbGw9IiM5QjlCQTAiLz4KPHBhdGggZD0iTTkwIDEwMEwxMjAgNzBMMTMwIDgwTDEyMCAxMDBMOTAgMTAwWiIgZmlsbD0iIzlCOUJBMCIvPgo8L3N2Zz4K'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()

// 使用adminStore
const adminStore = useAdminStore()

// 响应式数据
const orders = ref([])
const loading = ref(false)
// 异步导出任务对话框
const showExportTasks = ref(false)
const exportTaskType = ref('orders')
const showDetailModal = ref(false)
const selectedOrder = ref(null)
const detailLoading = ref(false)

/**
 * 履约操作表单：改状态 / 填物流单号 / 内部备注。
 *
 * 之前管理端**根本没有改订单状态的入口** —— 后端接口有（PUT /admin/orders/:id/status），
 * 但没有任何页面调用它，运营在后台无法发货/完成/取消订单。
 */
const fulfillForm = reactive({ status: '', tracking_number: '', admin_note: '' })
const fulfillSaving = ref(false)

/** 订单状态机（与后端 ORDER_STATUS_TRANSITIONS 保持一致） */
const ORDER_STATUS_TRANSITIONS = {
  pending: ['paid', 'shipping', 'cancelled'],
  paid: ['shipping', 'cancelled'],
  shipping: ['shipped', 'delivered', 'cancelled'],
  shipped: ['delivered'],
  delivered: ['completed'],
  completed: [],
  cancelled: []
}
const allowedNextStatuses = computed(() =>
  selectedOrder.value ? (ORDER_STATUS_TRANSITIONS[selectedOrder.value.status] || []) : []
)

/** 打开详情时把履约信息带进表单 */
const fillFulfillForm = (order) => {
  fulfillForm.status = ''
  fulfillForm.tracking_number = order?.tracking_number || ''
  fulfillForm.admin_note = order?.admin_note || ''
}

/** 提交履约操作 */
const submitFulfillment = async () => {
  if (!selectedOrder.value || !fulfillForm.status || fulfillSaving.value) return
  fulfillSaving.value = true
  try {
    const payload = { status: fulfillForm.status }
    if (fulfillForm.tracking_number) payload.tracking_number = fulfillForm.tracking_number
    if (fulfillForm.admin_note) payload.admin_note = fulfillForm.admin_note
    const res = await updateOrderStatus(selectedOrder.value.id, payload)
    if (res?.data?.success) {
      ElMessage.success(res.data.message || t('orders.fulfillmentSaved'))
      await loadOrders()
      // 重新拉详情，让物流单号/状态立刻反映出来
      // （注意：详情函数是 viewOrderDetail(order)，不是 openDetail）
      await viewOrderDetail(selectedOrder.value)
    } else {
      ElMessage.error(res?.data?.message || t('common.error'))
    }
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('common.error'))
  } finally {
    fulfillSaving.value = false
  }
}

// 分页数据
const currentPage = ref(1)
const pageSize = ref(20)

/**
 * 批量改订单状态。
 *
 * 之前只能一单一单点开详情改 —— 今天要发的十几单要点十几次，
 * 而且漏掉的那单往往就是客户催得最急的那单。
 *
 * 目标状态**只列出所选订单里至少有一单能流转到的状态**
 * （终态订单 completed/cancelled 不可再变，选了也没意义，不该出现在下拉里）。
 */
const orderTableRef = ref(null)
const selectedOrderIds = ref([])
const bulkStatus = ref('')
const bulkActing = ref(false)

const selectedOrders = computed(() => {
  const ids = new Set(selectedOrderIds.value)
  return orders.value.filter(o => ids.has(o.id))
})

/** 所选订单能流转到的目标状态（并集） */
const bulkStatusOptions = computed(() => {
  const set = new Set()
  for (const o of selectedOrders.value) {
    for (const s of (ORDER_STATUS_TRANSITIONS[o.status] || [])) set.add(s)
  }
  return [...set]
})

const onSelectionChange = (rows) => {
  selectedOrderIds.value = rows.map(r => r.id)
  // 目标状态可能因为选择变化而失效 → 清掉，避免带着旧值去提交
  if (bulkStatus.value && !bulkStatusOptions.value.includes(bulkStatus.value)) {
    bulkStatus.value = ''
  }
}

const applyBulkStatus = async () => {
  const ids = [...selectedOrderIds.value]
  if (!ids.length || !bulkStatus.value || bulkActing.value) {
    if (!ids.length) ElMessage.warning(t('orders.bulkNoSelection'))
    return
  }
  const status = bulkStatus.value
  try {
    await ElMessageBox.confirm(
      t('orders.bulkConfirm', { count: ids.length, status: t(`orders.statusOptions.${status}`) }),
      t('orders.bulkTargetStatus'),
      { type: 'warning', confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel') }
    )
  } catch {
    return // 用户取消
  }

  bulkActing.value = true
  try {
    const res = await bulkUpdateOrderStatus(ids, status)
    const payload = res?.data
    if (!payload?.success) {
      ElMessage.error(payload?.message || t('common.error'))
      return
    }
    const changed = payload.data?.changed?.length || 0
    const skipped = payload.data?.skipped || []
    if (skipped.length) {
      // 跳过的单要**看得见**：只报"成功"会让运营以为全改完了
      ElMessage.warning(t('orders.bulkPartial', { count: changed, skipped: skipped.length }))
      ElMessageBox.alert(
        skipped.map(s => `#${s.id}（${t(`orders.statusOptions.${s.status}`) || s.status}）：${s.reason || ''}`).join('\n'),
        t('orders.bulkSkippedTitle'),
        { type: 'warning' }
      ).catch(() => {})
    } else {
      ElMessage.success(t('orders.bulkSuccess', { count: changed }))
    }
    await loadOrders()
    // 清空选择，避免重复操作同一批
    selectedOrderIds.value = []
    bulkStatus.value = ''
    orderTableRef.value?.clearSelection()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('common.error'))
  } finally {
    bulkActing.value = false
  }
}

// 筛选条件
// status 是**数组**（多选）：面板上的"待发货"= paid + shipping 两个状态，
// 单选时列表条数会和卡上数字对不上，用户以为漏单。
const filters = reactive({
  status: [],
  keyword: '',
  startDate: '',
  endDate: ''
})

// 导出沿用当前列表的筛选条件，保证「导出的就是列表里看到的那批」
const exportParams = computed(() => ({
  status: filters.status.length ? filters.status.join(',') : undefined,
  keyword: filters.keyword || undefined,
  startDate: filters.startDate || undefined,
  endDate: filters.endDate || undefined
}))

// 分页信息
const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0
})

// 后端全量聚合统计（新契约 /api/admin/orders 响应的 stats 字段）；无该字段时回退到当前页计算
const serverStats = ref(null)
// 业务时区（服务端返回）：前端兜底算"今天"时要用它，口径才和服务端一致
const serverTimezone = ref(null)

// 统计信息
const stats = computed(() => {
  const s = serverStats.value
  if (s && ['total', 'completed', 'totalAmount', 'todayAmount'].every(k => Number.isFinite(Number(s[k])))) {
    return {
      total: Number(s.total),
      completed: Number(s.completed),
      totalAmount: formatAmount(s.totalAmount),
      todayAmount: formatAmount(s.todayAmount)
    }
  }
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
  const totalAmount = orders.value.reduce((sum, order) => sum + sumOrderThb(order), 0)

  // "今天"必须按**业务时区**算（服务端也是按 business_timezone 算的）。
  // 直接用浏览器本地时区的话，一旦运营把业务时区改成别的（比如 Asia/Bangkok），
  // 这个兜底数字就会和服务端对不上。
  // 业务时区由服务端随列表返回（data.timezone）；拿不到时退回本地时区。
  const dayKey = (value) => {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: serverTimezone.value || undefined }).format(d)
    } catch {
      return d.toDateString()
    }
  }
  const today = dayKey(new Date())
  const todayOrders = orders.value.filter(order => dayKey(order.created_at) === today)
  const todayAmount = todayOrders.reduce((sum, order) => sum + sumOrderThb(order), 0)
  
  return {
    total,
    completed,
    totalAmount,
    todayAmount
  }
})

// 筛选变更统一入口：先回到第 1 页再加载，避免高页码改筛选触发超界回退的二次请求
const applyFilters = () => {
  currentPage.value = 1
  pagination.page = 1
  loadOrders()
}

// 搜索防抖
let searchTimeout = null
const debounceSearch = () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    applyFilters()
  }, 500)
}

// 加载订单列表
/**
 * 请求序号守卫：快速切换状态筛选/搜索会并发发起请求，
 * 旧响应后到会覆盖新结果（表格与筛选器条件对不上，运营据此改状态会改错单）。
 * 与 admin Products.vue 的 loadSeq 同一套模式。
 */
let orderLoadSeq = 0

const loadOrders = async () => {
  // seq 必须在 try 外声明：finally 块会访问它（块级作用域，try 内声明则不可见）
  const seq = ++orderLoadSeq
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
      if (seq !== orderLoadSeq) return // 已有更新的请求在途，丢弃过期响应
      if (data.success) {
        orders.value = data.data?.orders || []
        // 分页信息：优先取 pagination 子对象（新契约），兼容旧的扁平字段
        const pg = data.data?.pagination
        pagination.total = pg?.total ?? data.data?.total ?? 0
        pagination.totalPages = pg?.totalPages ?? data.data?.totalPages ?? 1
        serverStats.value = data.data?.stats || null
        serverTimezone.value = data.data?.timezone || null

        // 删除/操作后当前页可能超出新的总页数，自动回退到最后一页再加载
        if (pagination.totalPages > 0 && pagination.page > pagination.totalPages) {
          pagination.page = pagination.totalPages
          currentPage.value = pagination.totalPages
          await loadOrders()
          return
        }
      }
    } else {
      const errorData = await response.json()
      ElMessage.error(t('orders.messages.loadFailed') + '：' + (errorData.message || '未知错误'))
    }
  } catch (error) {
    console.error('加载订单失败:', error)
    ElMessage.error(t('orders.messages.loadFailed') + '：' + (error.response?.data?.message || error.message))
  } finally {
    if (seq === orderLoadSeq) loading.value = false
  }
}



// 操作列下拉菜单统一分发：窄列 + fixed 共存，避免宽操作列遮挡业务列
/** 某订单当前允许流转到的状态（与后端 ORDER_STATUS_TRANSITIONS 保持一致） */
const nextStatusesOf = (row) => (ORDER_STATUS_TRANSITIONS[row?.status] || [])

const handleOrderAction = (command, row) => {
  if (command === 'detail') return viewOrderDetail(row)
  if (command === 'delete') return deleteOrder(row.id)
  if (typeof command === 'string' && command.startsWith('status:')) {
    return quickChangeStatus(row, command.slice('status:'.length))
  }
}

/**
 * 快捷改状态：确认 → 调接口 → 刷新列表。
 * 不走详情弹窗 —— 运营改状态时通常不需要先看整单详情。
 */
const quickChangeStatus = async (row, nextStatus) => {
  const label = getStatusText(nextStatus)
  try {
    await ElMessageBox.confirm(
      `${t('orders.quickConfirm', { status: label })}`,
      t('orders.quickTitle'),
      { type: 'warning', confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel') }
    )
  } catch {
    return // 用户取消
  }
  const res = await updateOrderStatus(row.id, { status: nextStatus })
  /**
   * ⚠️ `updateOrderStatus` 走 axios → 返回的是**响应对象**，
   * 业务字段在 `res.data` 里。之前判 `res.success`（恒为 undefined）→
   * **状态明明改成功了，却弹「错误」，而且不刷新列表**
   * （只能等 30 秒的自动刷新才看得到）。
   */
  if (res.data?.success) {
    ElMessage.success(t('orders.quickDone', { status: label }))
    loadOrders()
  } else {
    ElMessage.error(res.data?.message || t('common.error'))
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

/**
 * 详情请求序号守卫。
 *
 * 列表的 loadOrders 有序号守卫，详情这里以前没有 ——
 * 慢网络下点 A 单的「查看详情」再点 B 单，A 的响应后到 →
 * 弹窗标题显示的是 **A**（用户预期是 B）→ 运营在弹窗底部改状态/填物流单号，
 * **改的是 A 单**。相邻行误改订单状态是真实资损。
 */
let detailLoadSeq = 0

// 查看订单详情
const viewOrderDetail = async (order) => {
  const seq = ++detailLoadSeq
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
    if (seq !== detailLoadSeq) return   // 已有更新的详情请求在途，丢弃过期响应
    if (!response.ok || !data.success) {
      ElMessage.error((data && data.message) ? data.message : t('orders.messages.detailLoadFailed'))
      showDetailModal.value = false
      return
    }
    selectedOrder.value = data.data
    fillFulfillForm(data.data)
  } catch (error) {
    console.error('加载订单详情失败:', error)
    if (seq === detailLoadSeq) {
      ElMessage.error(t('orders.messages.detailLoadFailed'))
      showDetailModal.value = false
    }
  } finally {
    if (seq === detailLoadSeq) detailLoading.value = false
  }
}

// 关闭详情模态框
const closeDetailModal = () => {
  showDetailModal.value = false
  selectedOrder.value = null
}

// 打开导出任务对话框
const openExportTasks = (type = 'orders') => {
  exportTaskType.value = type
  showExportTasks.value = true
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
const syncFiltersFromRoute = () => {
  const qk = route.query.keyword
  filters.keyword = qk != null && String(qk).trim() !== '' ? String(qk).trim() : ''

  /**
   * 深链状态：面板上的"待发货/待支付"卡片点了会带着 ?status=paid,shipping 跳过来，
   * 这里把它还原成多选框里的选中项 —— 用户落地时看到的是**已经筛好的列表**，
   * 不用再手动去下拉框里勾一遍。
   */
  const qs = route.query.status
  const statusList = (Array.isArray(qs) ? qs.join(',') : String(qs || ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  filters.status = statusList
}

const resetFilters = () => {
  Object.assign(filters, {
    status: [],
    keyword: '',
    startDate: '',
    endDate: ''
  })
  currentPage.value = 1
  pagination.page = 1
  const hasQuery = Object.keys(route.query).length > 0
  if (hasQuery) {
    router.replace({ name: 'Orders', query: {} })
    return
  }
  loadOrders()
}

watch(
  () => [route.query.keyword, route.query.status],
  () => {
    syncFiltersFromRoute()
    currentPage.value = 1
    pagination.page = 1
    loadOrders()
  }
)

// 工具函数
const formatDate = (dateString) => {
  return new Date(dateString).toLocaleString(locale.value)
}

/**
 * 行金额：优先用**权威行小计** line_total。
 *
 * 组合包（bundle）订单的明细行是"按权重把组合价分摊到组件行"的，
 * 单价 = round2(行小计 / 行数量) → 除不尽的尾差就丢了，
 * "单价 × 数量"与实收对不上（实测能差十几泰铢）。有 line_total 就用它。
 */
const lineTotalOf = (item) => {
  const lt = Number(item?.line_total)
  if (Number.isFinite(lt)) return lt
  return Number(item?.price || 0) * Number(item?.quantity || 0)
}

const getStatusText = (status) => {
  const statusMap = {
    completed: t('orders.statusOptions.completed'),
    pending: t('orders.statusOptions.pending'),
    paid: t('orders.statusOptions.paid'),
    delivered: t('orders.statusOptions.delivered'),
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
    delivered: 'success',
    paid: 'info',
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
  return formatAmount(thb * r)
}

// THB 金额展示：非有限数值兜底为 0.00，避免 NaN
const formatThbAmount = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
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

/**
 * 自动刷新订单列表（30s）。
 *
 * 为什么需要：商家把订单页开着等人下单时，**新订单不会自己出现** ——
 * 必须手动刷新才看得到。晚回客户一句"我下单了怎么没人理"，就是真金白银的损失。
 *
 * 刷新的是"同一屏"（保留当前页码与筛选条件），不是跳回第一页。
 */
useAutoRefresh(loadOrders, {
  intervalMs: 30_000,
  // 正在操作详情弹窗时不刷新（改状态/填单号时被顶掉会很难受）
  shouldRefresh: () => !showDetailModal.value
})

// 组件挂载时加载数据
onMounted(() => {
  syncFiltersFromRoute()
  loadOrders()
})
onUnmounted(() => {
  if (searchTimeout) clearTimeout(searchTimeout)
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

/* 批量操作条：选中订单后出现 */
.bulk-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid #c6e2ff;
  border-radius: 8px;
  background: #ecf5ff;
}

.bulk-bar__count {
  font-size: 13px;
  color: #337ecc;
  font-weight: 600;
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

<!--
  非 scoped：el-dialog 的根元素**不带**父组件的 scope 属性，
  写在 scoped 块里的 .order-detail-dialog 规则根本匹配不到（实测 maxHeight=none）。

  订单详情弹窗必须**不能超过视口**，超出部分让 body 滚动 ——
  之前弹窗内容比手机视口还高（实测 1197px vs 851px），
  底部固定的操作区（状态 / 物流单号 / 保存）被顶到屏幕外，
  手机上根本点不到："改订单状态"这件事在小屏上等于不存在。
-->
<style>
.order-detail-dialog {
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
}
.order-detail-dialog .el-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.order-detail-dialog .el-dialog__footer {
  flex: 0 0 auto;
}
</style>
