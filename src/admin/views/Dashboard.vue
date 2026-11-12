<template>
  <div class="dashboard">
    <div class="admin-module-toolbar">
      <el-button type="primary" :loading="loading" @click="loadStatistics">
        <el-icon><Refresh /></el-icon>
        {{ t('dashboard.refreshData') }}
      </el-button>
    </div>

    <!-- 今日待办：面板最该盯的一组数字 -->
    <section class="todo-section">
      <div class="section-heading">
        <h2 class="section-title">{{ t('dashboard.todayTodo') }}</h2>
        <span class="section-hint">{{ t('dashboard.todayTodoHint') }}</span>
      </div>
      <el-row :gutter="16">
        <el-col :xs="12" :sm="8" :md="8" :lg="4">
          <el-card class="stats-card admin-stagger" shadow="hover" :style="{ '--ui-stagger-index': 4 }">
            <div class="stats-content">
              <div class="stats-value">
                <CountUp :value="overviewStats.todayOrders || 0" />
              </div>
              <div class="stats-label">{{ t('dashboard.todayOrders') }}</div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#409EFF"><Calendar /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="8" :lg="4">
          <el-card class="stats-card admin-stagger" shadow="hover" :style="{ '--ui-stagger-index': 5 }">
            <div class="stats-content">
              <div class="stats-value stats-value--amount">{{ t('common.currency') }}{{ overviewStats.todayAmount || '0.00' }}</div>
              <div class="stats-label">{{ t('dashboard.todayAmount') }}</div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#67C23A"><Coin /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="8" :lg="4">
          <el-card
            class="stats-card stats-card--action admin-stagger"
            shadow="hover"
            :style="{ '--ui-stagger-index': 6 }"
            :class="{ 'stats-card--zero': !overviewStats.pendingShipment }"
            role="button"
            tabindex="0"
            :aria-label="t('dashboard.pendingShipment')"
            @click="goOrders(['paid', 'shipping'])"
            @keydown.enter.prevent="goOrders(['paid', 'shipping'])"
            @keydown.space.prevent="goOrders(['paid', 'shipping'])"
          >
            <div class="stats-content">
              <div class="stats-value">
                <CountUp :value="overviewStats.pendingShipment || 0" />
              </div>
              <div class="stats-label">{{ t('dashboard.pendingShipment') }}</div>
              <div v-if="overviewStats.pendingShipment" class="stats-action-hint">
                {{ t('dashboard.goHandle') }}
                <el-icon><ArrowRight /></el-icon>
              </div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#E6A23C"><Van /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="8" :lg="4">
          <el-card
            class="stats-card stats-card--action admin-stagger"
            shadow="hover"
            :style="{ '--ui-stagger-index': 7 }"
            :class="{ 'stats-card--zero': !overviewStats.pendingPayment }"
            role="button"
            tabindex="0"
            :aria-label="t('dashboard.pendingPayment')"
            @click="goOrders(['pending'])"
            @keydown.enter.prevent="goOrders(['pending'])"
            @keydown.space.prevent="goOrders(['pending'])"
          >
            <div class="stats-content">
              <div class="stats-value">
                <CountUp :value="overviewStats.pendingPayment || 0" />
              </div>
              <div class="stats-label">{{ t('dashboard.pendingPayment') }}</div>
              <div v-if="overviewStats.pendingPayment" class="stats-action-hint">
                {{ t('dashboard.goHandle') }}
                <el-icon><ArrowRight /></el-icon>
              </div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#F56C6C"><Wallet /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="8" :lg="4">
          <el-card
            class="stats-card stats-card--action admin-stagger"
            shadow="hover"
            :style="{ '--ui-stagger-index': 8 }"
            :class="{ 'stats-card--zero': !overviewStats.lowStock }"
            role="button"
            tabindex="0"
            :aria-label="t('dashboard.lowStock')"
            @click="goProducts('low')"
            @keydown.enter.prevent="goProducts('low')"
            @keydown.space.prevent="goProducts('low')"
          >
            <div class="stats-content">
              <div class="stats-value">
                <CountUp :value="overviewStats.lowStock || 0" />
              </div>
              <div class="stats-label">{{ t('dashboard.lowStock') }}</div>
              <div v-if="overviewStats.lowStock" class="stats-action-hint">
                {{ t('dashboard.goHandle') }}
                <el-icon><ArrowRight /></el-icon>
              </div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#F56C6C"><Box /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="8" :lg="4">
          <el-card
            class="stats-card stats-card--action admin-stagger"
            shadow="hover"
            :style="{ '--ui-stagger-index': 9 }"
            :class="{ 'stats-card--zero': !overviewStats.outOfStock }"
            role="button"
            tabindex="0"
            :aria-label="t('dashboard.outOfStock')"
            @click="goProducts('out')"
            @keydown.enter.prevent="goProducts('out')"
            @keydown.space.prevent="goProducts('out')"
          >
            <div class="stats-content">
              <div class="stats-value">
                <CountUp :value="overviewStats.outOfStock || 0" />
              </div>
              <div class="stats-label">{{ t('dashboard.outOfStock') }}</div>
              <div v-if="overviewStats.outOfStock" class="stats-action-hint">
                {{ t('dashboard.goHandle') }}
                <el-icon><ArrowRight /></el-icon>
              </div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#909399"><Warning /></el-icon>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </section>

    <div class="stats-section">
      <div class="section-heading">
        <h2 class="section-title">{{ t('dashboard.allTime') }}</h2>
      </div>
      <el-row :gutter="20">
        <el-col :xs="12" :sm="12" :md="6" :lg="6">
          <el-card class="stats-card admin-stagger" shadow="hover" :style="{ '--ui-stagger-index': 0 }">
            <div class="stats-content">
              <div class="stats-value">
                <CountUp :value="overviewStats.totalOrders || 0" />
              </div>
              <div class="stats-label">{{ t('dashboard.totalOrders') }}</div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#409EFF"><TrendCharts /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="12" :md="6" :lg="6">
          <el-card class="stats-card admin-stagger" shadow="hover" :style="{ '--ui-stagger-index': 1 }">
            <div class="stats-content">
              <div class="stats-value stats-value--amount">{{ t('common.currency') }}{{ overviewStats.totalAmount || '0.00' }}</div>
              <div class="stats-label">{{ t('dashboard.totalAmount') }}</div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#67C23A"><Coin /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="12" :md="6" :lg="6">
          <el-card class="stats-card admin-stagger" shadow="hover" :style="{ '--ui-stagger-index': 2 }">
            <div class="stats-content">
              <div class="stats-value">
                <CountUp :value="overviewStats.totalUsers || 0" />
              </div>
              <div class="stats-label">{{ t('dashboard.totalUsers') }}</div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#E6A23C"><User /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="12" :md="6" :lg="6">
          <el-card class="stats-card admin-stagger" shadow="hover" :style="{ '--ui-stagger-index': 3 }">
            <div class="stats-content">
              <div class="stats-value">
                <CountUp :value="overviewStats.activeUsers || 0" />
              </div>
              <div class="stats-label">{{ t('dashboard.activeUsers') }}</div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#F56C6C"><UserFilled /></el-icon>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- 趋势图表 -->
    <div class="charts-section">
      <el-row :gutter="20">
        <!-- 七天订单趋势 -->
        <el-col :span="12">
          <el-card class="chart-card" shadow="hover">
            <template #header>
              <div class="chart-header">
                <h3>{{ t('dashboard.orderTrend') }}</h3>
                <span class="chart-subtitle">{{ t('dashboard.orderTrendSubtitle') }}</span>
              </div>
            </template>
            <div class="chart-container">
              <v-chart 
                v-if="orderTrendData.length > 0"
                class="chart" 
                :option="orderTrendOption"
                :loading="chartsLoading"
              />
              <div v-else class="no-data">{{ t('dashboard.noData') }}</div>
            </div>
          </el-card>
        </el-col>

        <!-- 七天注册用户趋势 -->
        <el-col :span="12">
          <el-card class="chart-card" shadow="hover">
            <template #header>
              <div class="chart-header">
                <h3>{{ t('dashboard.userTrend') }}</h3>
                <span class="chart-subtitle">{{ t('dashboard.userTrendSubtitle') }}</span>
              </div>
            </template>
            <div class="chart-container">
              <v-chart 
                v-if="userTrendData.length > 0"
                class="chart" 
                :option="userTrendOption"
                :loading="chartsLoading"
              />
              <div v-else class="no-data">{{ t('dashboard.noData') }}</div>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAutoRefresh } from '../composables/useAutoRefresh.js'
import { ElMessage } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import {
  TrendCharts, Coin, User, UserFilled, Refresh,
  Calendar, Van, Wallet, Box, Warning, ArrowRight
} from '@element-plus/icons-vue'
import CountUp from '../components/CountUp.vue'

// 国际化
const { t } = useI18n()
const router = useRouter()
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, BarChart } from 'echarts/charts'
import {
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent
} from 'echarts/components'
import VChart from 'vue-echarts'

// 注册 ECharts 组件
use([
  CanvasRenderer,
  LineChart,
  BarChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent
])

// 响应式数据
const loading = ref(false)
const chartsLoading = ref(false)

// 统计数据
const overviewStats = reactive({
  totalOrders: 0,
  totalAmount: '0.00',
  totalUsers: 0,
  activeUsers: 0,
  todayOrders: 0,
  todayAmount: '0.00',
  pendingShipment: 0,
  pendingPayment: 0,
  lowStock: 0,
  outOfStock: 0
})

/**
 * 待办卡深链：点一下直接进到**已经筛好**的列表。
 *
 * 卡上的数字和列表里的条数必须对得上 —— 否则用户会以为系统漏单。
 * 所以：
 *   待发货 = paid + shipping（两个状态一起筛，后端支持逗号分隔的多状态）
 *   待支付 = pending
 *   低库存 = 商品页 stockStatus=low（0 < stock <= 10）
 *   缺货   = 商品页 stockStatus=out（stock = 0）
 */
const goOrders = (statuses) => {
  router.push({ name: 'Orders', query: { status: statuses.join(',') } })
}

const goProducts = (stockStatus) => {
  router.push({ name: 'Products', query: { stockStatus } })
}

const orderTrendData = ref([])
const userTrendData = ref([])

// 订单趋势图表配置
const orderTrendOption = computed(() => ({
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'cross'
    }
  },
  legend: {
    data: [t('dashboard.orderCount'), t('dashboard.orderAmount')]
  },
  xAxis: {
    type: 'category',
    data: orderTrendData.value.map(item => item.dateLabel)
  },
  yAxis: [
    {
      type: 'value',
      name: t('dashboard.orderCount'),
      position: 'left'
    },
    {
      type: 'value',
      name: t('dashboard.orderAmountUnit'),
      position: 'right'
    }
  ],
  series: [
    {
      name: t('dashboard.orderCount'),
      type: 'bar',
      data: orderTrendData.value.map(item => item.count),
      itemStyle: {
        color: '#409EFF'
      }
    },
    {
      name: t('dashboard.orderAmount'),
      type: 'line',
      yAxisIndex: 1,
      data: orderTrendData.value.map(item => parseFloat(item.amount)),
      itemStyle: {
        color: '#67C23A'
      },
      lineStyle: {
        width: 3
      }
    }
  ]
}))

// 用户注册趋势图表配置
const userTrendOption = computed(() => ({
  tooltip: {
    trigger: 'axis'
  },
  xAxis: {
    type: 'category',
    data: userTrendData.value.map(item => item.dateLabel)
  },
  yAxis: {
    type: 'value',
    name: t('dashboard.newUsers')
  },
  series: [
    {
      name: t('dashboard.newUsers'),
      type: 'line',
      data: userTrendData.value.map(item => item.count),
      itemStyle: {
        color: '#E6A23C'
      },
      lineStyle: {
        width: 3
      },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [{
            offset: 0, color: 'rgba(230, 162, 60, 0.3)'
          }, {
            offset: 1, color: 'rgba(230, 162, 60, 0.1)'
          }]
        }
      }
    }
  ]
}))

// 加载统计数据
const loadStatistics = async () => {
  try {
    loading.value = true
    chartsLoading.value = true
    
    // 使用管理员store的apiRequest方法
    const { useAdminStore } = await import('../stores/admin.js')
    const adminStore = useAdminStore()
    
    const response = await adminStore.apiRequest('/api/admin/statistics/comprehensive', {
      method: 'GET'
    })
    
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        // 更新总览数据
        Object.assign(overviewStats, data.data.overview)
        
        // 更新趋势数据
        orderTrendData.value = data.data.orderTrend || []
        userTrendData.value = data.data.userTrend || []
      } else {
        ElMessage.error(data.message || t('dashboard.loadDataFailed'))
      }
    } else {
      const errorData = await response.json()
      ElMessage.error(errorData.message || t('dashboard.loadDataFailed'))
    }
  } catch (error) {
    console.error('加载统计数据失败:', error)
    ElMessage.error(t('dashboard.loadDataFailed'))
  } finally {
    loading.value = false
    chartsLoading.value = false
  }
}

// 组件挂载时加载数据
/**
 * 面板自动刷新（60s）。
 *
 * 面板上有"今日营收""今日订单"—— 开着面板等人下单时，这些数字不会自己变，
 * 商家看到的是**十分钟前的营业额**，容易误判（"今天怎么一单都没有"）。
 *
 * 比订单页慢（数字没有订单列表那么急）。
 */
useAutoRefresh(loadStatistics, { intervalMs: 60_000 })

onMounted(() => {
  loadStatistics()
})
</script>

<style scoped>
.dashboard {
  padding: 0;
}

.stats-section {
  margin-bottom: 20px;
}

/* 今日待办：比"累计数据"更重要，所以放在更上面 */
.todo-section {
  margin-bottom: 24px;
}

.section-heading {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}

.section-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.section-hint {
  font-size: 12px;
  color: #909399;
}

/* 可点击的待办卡：鼠标形状 + 焦点环，键盘也能用 */
.stats-card--action {
  cursor: pointer;
}

.stats-card--action:focus-visible {
  outline: 2px solid #409eff;
  outline-offset: 2px;
}

.stats-action-hint {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-top: 6px;
  font-size: 12px;
  color: #409eff;
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
}

.stats-card--action:hover .stats-action-hint,
.stats-card--action:focus-visible .stats-action-hint {
  opacity: 1;
  transform: translateX(0);
}

/* 数字为 0 时淡化 —— 一眼看出"今天没待办"，而不是以为没加载出来 */
.stats-card--zero .stats-value,
.stats-card--zero .stats-label {
  color: #c0c4cc;
}

.stats-card--zero .stats-icon {
  opacity: 0.35;
}

/* 金额位数多，字号小一点免得溢出 */
.stats-value--amount {
  font-size: 24px;
}

/* 极简高级风：stagger 入场（克制感） */
@keyframes admin-slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.admin-stagger {
  animation: admin-slide-up 300ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
  animation-delay: calc(var(--ui-stagger-index, 0) * 60ms);
}

.stats-card {
  position: relative;
  cursor: pointer;
  transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1);
  /* 用 min-height 而不是固定 height —— 待办卡多一行"去处理"提示，别把内容挤出去 */
  min-height: 120px;
}
.stats-card:hover {
  transform: translateY(-2px);
}

.stats-card:hover {
  transform: translateY(-2px);
}

.stats-card :deep(.el-card__body) {
  padding: 20px;
  display: flex;
  align-items: center;
}

.stats-content {
  flex: 1;
}

.stats-value {
  font-size: 28px;
  font-weight: 600;
  color: #303133;
  line-height: 1;
  margin-bottom: 8px;
}

.stats-label {
  font-size: 14px;
  color: #909399;
}

.stats-icon {
  opacity: 0.8;
}

/* 图表区域 */
.charts-section {
  margin-bottom: 20px;
}

.chart-card {
  height: 400px;
}

.chart-card :deep(.el-card__body) {
  padding: 0;
  height: calc(100% - 60px);
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chart-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.chart-subtitle {
  font-size: 12px;
  color: #909399;
}

.chart-container {
  height: 100%;
  padding: 20px;
}

.chart {
  height: 100%;
  width: 100%;
}

.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #909399;
  font-size: 14px;
}

/* 响应式设计 */
@media (max-width: 1200px) {
  .stats-card {
    margin-bottom: 20px;
  }
  
  .charts-section .el-col {
    margin-bottom: 20px;
  }
}

@media (max-width: 768px) {
  .stats-value {
    font-size: 24px;
  }
  
  .chart-card {
    height: 300px;
  }
}
</style>