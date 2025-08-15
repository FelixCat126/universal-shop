<template>
  <div class="dashboard">
    <!-- 页面标题 -->
    <div class="page-header">
      <h2 class="page-title">{{ t('dashboard.title') }}</h2>
      <p class="page-description">{{ t('dashboard.description') }}</p>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-section">
      <el-row :gutter="20">
        <el-col :span="6">
          <el-card class="stats-card" shadow="hover">
            <div class="stats-content">
              <div class="stats-value">{{ overviewStats.totalOrders || 0 }}</div>
              <div class="stats-label">{{ t('dashboard.totalOrders') }}</div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#409EFF"><TrendCharts /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stats-card" shadow="hover">
            <div class="stats-content">
              <div class="stats-value">{{ t('common.currency') }}{{ overviewStats.totalAmount || '0.00' }}</div>
              <div class="stats-label">{{ t('dashboard.totalAmount') }}</div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#67C23A"><Coin /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stats-card" shadow="hover">
            <div class="stats-content">
              <div class="stats-value">{{ overviewStats.totalUsers || 0 }}</div>
              <div class="stats-label">{{ t('dashboard.totalUsers') }}</div>
            </div>
            <div class="stats-icon">
              <el-icon size="32" color="#E6A23C"><User /></el-icon>
            </div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stats-card" shadow="hover">
            <div class="stats-content">
              <div class="stats-value">{{ overviewStats.activeUsers || 0 }}</div>
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

    <!-- 刷新按钮 -->
    <div class="refresh-section">
      <el-button 
        type="primary" 
        :loading="loading" 
        @click="loadStatistics"
        size="large"
      >
        <el-icon><Refresh /></el-icon>
        {{ t('dashboard.refreshData') }}
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { TrendCharts, Coin, User, UserFilled, Refresh } from '@element-plus/icons-vue'

// 国际化
const { t } = useI18n()
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
  activeUsers: 0
})

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
        
        ElMessage.success(t('common.success'))
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
onMounted(() => {
  loadStatistics()
})
</script>

<style scoped>
.dashboard {
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

/* 统计卡片 */
.stats-section {
  margin-bottom: 20px;
}

.stats-card {
  position: relative;
  cursor: pointer;
  transition: all 0.3s;
  height: 120px;
}

.stats-card:hover {
  transform: translateY(-2px);
}

.stats-card :deep(.el-card__body) {
  padding: 20px;
  height: 100%;
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

/* 刷新按钮 */
.refresh-section {
  text-align: center;
  padding: 20px 0;
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
  
  .page-header {
    padding: 16px;
  }
}
</style>