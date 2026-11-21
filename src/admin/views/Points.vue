<template>
  <div class="points-management">
    <!-- 概览：全局积分资产情况 -->
    <div class="stats-section">
      <el-row :gutter="20">
        <el-col :span="6">
          <el-card class="stats-card">
            <div class="stats-content">
              <div class="stats-value">{{ overview.totalUsers }}</div>
              <div class="stats-label">{{ t('points.totalUsers') }}</div>
            </div>
            <el-icon class="stats-icon"><User /></el-icon>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stats-card">
            <div class="stats-content">
              <div class="stats-value">{{ overview.totalBalance }}</div>
              <div class="stats-label">{{ t('points.totalBalance') }}</div>
            </div>
            <el-icon class="stats-icon"><Coin /></el-icon>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stats-card">
            <div class="stats-content">
              <div class="stats-value">{{ overview.totalGranted }}</div>
              <div class="stats-label">{{ t('points.totalGranted') }}</div>
            </div>
            <el-icon class="stats-icon"><Plus /></el-icon>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stats-card">
            <div class="stats-content">
              <div class="stats-value">{{ overview.totalConsumed }}</div>
              <div class="stats-label">{{ t('points.totalConsumed') }}</div>
            </div>
            <el-icon class="stats-icon"><Minus /></el-icon>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- 搜索和筛选 -->
    <div class="filter-section">
      <el-card>
        <el-form :model="searchForm" inline class="search-form">
          <el-form-item :label="t('points.keyword')">
            <el-input
              v-model="searchForm.keyword"
              :placeholder="t('points.enterKeyword')"
              clearable
              style="width: 240px"
              @keyup.enter="handleSearch"
            />
          </el-form-item>

          <el-form-item :label="t('points.minBalance')">
            <el-input
              v-model="searchForm.min_balance"
              :placeholder="t('points.enterBalance')"
              clearable
              style="width: 140px"
            />
          </el-form-item>

          <el-form-item :label="t('points.maxBalance')">
            <el-input
              v-model="searchForm.max_balance"
              :placeholder="t('points.enterBalance')"
              clearable
              style="width: 140px"
            />
          </el-form-item>

          <el-form-item>
            <el-button type="primary" @click="handleSearch" :loading="isLoading">
              <el-icon><Search /></el-icon>
              {{ t('points.search') }}
            </el-button>
            <el-button @click="resetSearch">
              <el-icon><Refresh /></el-icon>
              {{ t('points.reset') }}
            </el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>

    <!-- 用户积分余额列表 -->
    <div class="table-section">
      <el-card>
        <template #header>
          <div class="table-header">
            <span>{{ t('points.title') }}</span>
            <span class="table-info">{{ t('points.totalCount') }} {{ totalRows }}</span>
          </div>
        </template>

        <div class="table-wrapper">
          <el-table
            :data="balanceList"
            v-loading="isLoading"
            stripe
            border
            style="width: 100%"
            table-layout="fixed"
            class="points-table"
          >
            <el-table-column prop="user_id" :label="t('points.userId')" width="90" align="center" />

            <el-table-column :label="t('points.nickname')" min-width="160">
              <template #default="scope">
                <span>{{ scope.row.user?.nickname || t('common.notSet') }}</span>
              </template>
            </el-table-column>

            <el-table-column :label="t('points.phone')" min-width="150">
              <template #default="scope">
                <span v-if="scope.row.user?.phone">
                  {{ scope.row.user.country_code || '+66' }} {{ scope.row.user.phone }}
                </span>
                <span v-else class="text-gray">{{ t('common.notSet') }}</span>
              </template>
            </el-table-column>

            <el-table-column :label="t('points.balance')" width="130" align="center">
              <template #default="scope">
                <span class="balance-value">{{ scope.row.balance }}</span>
              </template>
            </el-table-column>

            <el-table-column :label="t('points.updateTime')" width="160" align="center">
              <template #default="scope">
                <div class="datetime">{{ formatDateTime(scope.row.updated_at) }}</div>
              </template>
            </el-table-column>

            <el-table-column :label="t('common.actions')" width="190" align="center" fixed="right">
              <template #default="scope">
                <el-button size="small" @click="openTransactions(scope.row)">
                  {{ t('points.viewTransactions') }}
                </el-button>
                <el-button size="small" type="primary" @click="openAdjust(scope.row)">
                  {{ t('points.adjust') }}
                </el-button>
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
            :disabled="isLoading"
            :background="true"
            layout="total, sizes, prev, pager, next, jumper"
            :total="totalRows"
            @size-change="handleSizeChange"
            @current-change="handleCurrentChange"
          />
        </div>
      </el-card>
    </div>

    <!-- 积分流水对话框 -->
    <el-dialog
      v-model="showTransactionDialog"
      :title="t('points.transactionsTitle')"
      width="900px"
    >
      <div class="table-wrapper">
        <el-table
          :data="transactionList"
          v-loading="loadingTransactions"
          stripe
          border
          style="width: 100%"
          table-layout="fixed"
        >
          <el-table-column :label="t('points.type')" width="140">
            <template #default="scope">
              <el-tag :type="typeTagType(scope.row.type)" size="small">
                {{ typeText(scope.row.type) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column :label="t('points.delta')" width="110" align="center">
            <template #default="scope">
              <span :class="scope.row.delta >= 0 ? 'delta-plus' : 'delta-minus'">
                {{ scope.row.delta > 0 ? '+' : '' }}{{ scope.row.delta }}
              </span>
            </template>
          </el-table-column>

          <el-table-column :label="t('points.balanceAfter')" width="120" align="center">
            <template #default="scope">{{ scope.row.balance_after }}</template>
          </el-table-column>

          <el-table-column :label="t('points.note')" min-width="200">
            <template #default="scope">
              <span>{{ scope.row.note || t('common.none') }}</span>
            </template>
          </el-table-column>

          <el-table-column :label="t('points.time')" width="160" align="center">
            <template #default="scope">
              <div class="datetime">{{ formatDateTime(scope.row.created_at) }}</div>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="transactionPage"
          v-model:page-size="transactionPageSize"
          :page-sizes="[10, 20, 50]"
          :small="false"
          :disabled="loadingTransactions"
          :background="true"
          layout="total, sizes, prev, pager, next"
          :total="transactionTotal"
          @size-change="handleTransactionSizeChange"
          @current-change="handleTransactionPageChange"
        />
      </div>

      <template #footer>
        <el-button @click="showTransactionDialog = false">{{ t('common.close') }}</el-button>
      </template>
    </el-dialog>

    <!-- 手工调整对话框 -->
    <el-dialog
      v-model="showAdjustDialog"
      :title="t('points.adjustTitle')"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-alert
        :title="t('points.adjustHint')"
        type="warning"
        :closable="false"
        show-icon
      />

      <el-form :model="adjustForm" label-width="110px" class="adjust-form">
        <el-form-item :label="t('points.adjustUser')">
          <span>{{ currentUserLabel }}</span>
        </el-form-item>
        <el-form-item :label="t('points.currentBalance')">
          <span>{{ currentBalance }}</span>
        </el-form-item>
        <el-form-item :label="t('points.delta')">
          <el-input-number
            v-model="adjustForm.delta"
            :step="10"
            :precision="0"
            controls-position="right"
            style="width: 200px"
          />
        </el-form-item>
        <el-form-item :label="t('points.note')">
          <el-input
            v-model="adjustForm.note"
            type="textarea"
            :rows="3"
            :placeholder="t('points.notePlaceholder')"
            maxlength="255"
            show-word-limit
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showAdjustDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="adjusting" @click="submitAdjust">
          {{ t('points.submitAdjust') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import { Search, Refresh, User, Plus, Minus, Coin } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { pointsAPI } from '../api/points.js'

const { t, locale } = useI18n()

const isLoading = ref(false)
const balanceList = ref([])
const totalRows = ref(0)
const currentPage = ref(1)
const pageSize = ref(20)

const overview = reactive({
  totalUsers: 0,
  totalBalance: 0,
  totalGranted: 0,
  totalConsumed: 0
})

const searchForm = reactive({
  keyword: '',
  min_balance: '',
  max_balance: ''
})

// 流水对话框
const showTransactionDialog = ref(false)
const loadingTransactions = ref(false)
const transactionList = ref([])
const transactionTotal = ref(0)
const transactionPage = ref(1)
const transactionPageSize = ref(20)
const transactionUser = ref(null)

// 手工调整对话框
const showAdjustDialog = ref(false)
const adjusting = ref(false)
const adjustUser = ref(null)
const adjustForm = reactive({
  delta: 0,
  note: ''
})

const currentBalance = computed(() => adjustUser.value?.balance ?? 0)
const currentUserLabel = computed(() => {
  const u = adjustUser.value
  if (!u) return ''
  const name = u.user?.nickname || u.user?.username || `#${u.user_id}`
  return `${name} (${u.user_id})`
})

/** 流水类型 → 展示文案 */
const typeText = (type) => {
  const key = `points.types.${type}`
  const text = t(key)
  // 未知类型直接显示原始值（i18n 缺键时 vue-i18n 会返回 key 本身）
  return text === key ? type : text
}

const typeTagType = (type) => {
  if (type === 'admin_adjust') return 'warning'
  if (type === 'redeem_order' || type === 'revoke_cancel') return 'danger'
  return 'success'
}

/** 加载概览 */
const loadOverview = async () => {
  try {
    const res = await pointsAPI.getOverview()
    if (res?.data?.success) {
      const d = res.data.data || {}
      overview.totalUsers = Number(d.totalUsers) || 0
      overview.totalBalance = Number(d.totalBalance) || 0
      overview.totalGranted = Number(d.totalGranted) || 0
      overview.totalConsumed = Number(d.totalConsumed) || 0
    }
  } catch (error) {
    console.error('加载积分概览失败:', error)
    ElMessage.error(t('points.messages.overviewFailed'))
  }
}

/**
 * 请求序号守卫：连续翻页会并发发起多个请求，
 * 慢的那个后到会覆盖快的 → 表格内容与分页器页码对不上。
 */
let loadSeq = 0

const loadBalances = async () => {
  const seq = ++loadSeq
  try {
    isLoading.value = true
    const params = {
      page: currentPage.value,
      pageSize: pageSize.value,
      keyword: searchForm.keyword || undefined,
      min_balance: searchForm.min_balance || undefined,
      max_balance: searchForm.max_balance || undefined
    }
    const res = await pointsAPI.getUserBalances(params)
    if (seq !== loadSeq) return
    if (res?.data?.success) {
      balanceList.value = res.data.data.items || []
      totalRows.value = res.data.data.total || 0
    } else {
      ElMessage.error(res?.data?.message || t('common.error'))
    }
  } catch (error) {
    console.error('加载积分余额列表失败:', error)
    ElMessage.error(t('points.messages.listFailed'))
  } finally {
    if (seq === loadSeq) isLoading.value = false
  }
}

const handleSearch = () => {
  currentPage.value = 1
  loadBalances()
}

const resetSearch = () => {
  Object.assign(searchForm, { keyword: '', min_balance: '', max_balance: '' })
  currentPage.value = 1
  loadBalances()
}

const handleSizeChange = (size) => {
  pageSize.value = size
  currentPage.value = 1
  loadBalances()
}

const handleCurrentChange = (page) => {
  currentPage.value = page
  loadBalances()
}

/* ---------------- 流水 ---------------- */

const loadTransactions = async () => {
  const userId = transactionUser.value?.user_id
  if (!userId) return
  try {
    loadingTransactions.value = true
    const res = await pointsAPI.getUserTransactions(userId, {
      page: transactionPage.value,
      pageSize: transactionPageSize.value
    })
    if (res?.data?.success) {
      transactionList.value = res.data.data.items || []
      transactionTotal.value = res.data.data.total || 0
    } else {
      ElMessage.error(res?.data?.message || t('common.error'))
    }
  } catch (error) {
    console.error('加载积分流水失败:', error)
    ElMessage.error(t('points.messages.transactionsFailed'))
  } finally {
    loadingTransactions.value = false
  }
}

const openTransactions = (row) => {
  transactionUser.value = row
  transactionPage.value = 1
  transactionList.value = []
  transactionTotal.value = 0
  showTransactionDialog.value = true
  loadTransactions()
}

const handleTransactionSizeChange = (size) => {
  transactionPageSize.value = size
  transactionPage.value = 1
  loadTransactions()
}

const handleTransactionPageChange = (page) => {
  transactionPage.value = page
  loadTransactions()
}

/* ---------------- 手工调整 ---------------- */

const openAdjust = (row) => {
  adjustUser.value = row
  adjustForm.delta = 0
  adjustForm.note = ''
  showAdjustDialog.value = true
}

const submitAdjust = async () => {
  const user = adjustUser.value
  if (!user) return
  const delta = Number(adjustForm.delta)
  if (!Number.isInteger(delta) || delta === 0) {
    ElMessage.error(t('points.messages.invalidDelta'))
    return
  }
  try {
    adjusting.value = true
    const res = await pointsAPI.adjustUserPoints(user.user_id, {
      delta,
      note: adjustForm.note
    })
    if (res?.data?.success) {
      ElMessage.success(t('points.messages.adjustSuccess'))
      showAdjustDialog.value = false
      // 调整后余额变了：概览与列表都要刷新
      await loadOverview()
      await loadBalances()
      // 正在看这个用户的流水时，流水也要刷新
      if (transactionUser.value?.user_id === user.user_id) {
        await loadTransactions()
      }
    } else {
      ElMessage.error(res?.data?.message || t('common.error'))
    }
  } catch (error) {
    ElMessage.error(error?.response?.data?.message || t('points.messages.adjustFailed'))
  } finally {
    adjusting.value = false
  }
}

const formatDateTime = (dateString) => {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale.value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

onMounted(() => {
  loadOverview()
  loadBalances()
})
</script>

<style scoped>
.points-management {
  padding: 0;
}

.filter-section {
  margin-bottom: 20px;
}

.search-form {
  margin: 0;
}

.stats-section {
  margin-bottom: 20px;
}

.stats-card {
  position: relative;
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
  font-size: 32px;
  color: #409EFF;
  opacity: 0.3;
}

.table-section {
  margin-bottom: 20px;
}

.table-wrapper {
  overflow-x: auto;
}

.table-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  color: #303133;
}

.table-info {
  color: #909399;
  font-size: 14px;
}

.points-table {
  font-size: 14px;
}

.points-table .el-table__cell {
  padding: 8px 12px;
}

.balance-value {
  font-family: 'Monaco', 'Consolas', monospace;
  font-weight: 600;
  color: #303133;
}

.delta-plus {
  color: #67c23a;
  font-weight: 600;
}

.delta-minus {
  color: #f56c6c;
  font-weight: 600;
}

.text-gray {
  color: #909399;
}

.datetime {
  font-weight: 500;
  color: #303133;
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 170px;
}

.pagination-wrapper {
  margin-top: 20px;
  text-align: right;
}

.adjust-form {
  margin-top: 18px;
}
</style>
