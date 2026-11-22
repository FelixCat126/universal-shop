<template>
  <div class="audit-logs">
    <el-card class="filter-card" shadow="never">
      <el-form :model="filters" class="filter-form">
        <el-row :gutter="20">
          <el-col :span="6">
            <el-form-item :label="t('auditLogs.actorType')">
              <el-select
                v-model="filters.actor_type"
                :placeholder="t('auditLogs.allActorTypes')"
                clearable
                style="width: 100%"
                @change="handleFilterChange"
              >
                <el-option :label="t('auditLogs.actorUser')" value="user" />
                <el-option :label="t('auditLogs.actorPartner')" value="partner" />
                <el-option :label="t('auditLogs.actorSystem')" value="system" />
                <el-option :label="t('auditLogs.actorAnonymous')" value="anonymous" />
              </el-select>
            </el-form-item>
          </el-col>

          <el-col :span="6">
            <el-form-item :label="t('auditLogs.event')">
              <el-input
                v-model="filters.event"
                :placeholder="t('auditLogs.eventPlaceholder')"
                clearable
                @keyup.enter="handleFilterChange"
              />
            </el-form-item>
          </el-col>

          <el-col :span="6">
            <el-form-item :label="t('auditLogs.resource')">
              <el-input
                v-model="filters.resource"
                :placeholder="t('auditLogs.resourcePlaceholder')"
                clearable
                @keyup.enter="handleFilterChange"
              />
            </el-form-item>
          </el-col>

          <el-col :span="6">
            <el-form-item :label="t('auditLogs.dateRange')">
              <el-date-picker
                v-model="dateRange"
                type="daterange"
                value-format="YYYY-MM-DD"
                range-separator="~"
                start-placeholder="start"
                end-placeholder="end"
                style="width: 100%"
                @change="handleFilterChange"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <div class="filter-actions">
          <el-button type="primary" @click="loadLogs" :loading="loading">
            <el-icon><Refresh /></el-icon>
            {{ t('common.search') }}
          </el-button>
          <el-button @click="resetFilters">
            <el-icon><RefreshLeft /></el-icon>
            {{ t('common.reset') }}
          </el-button>
        </div>
      </el-form>
    </el-card>

    <el-card class="table-card" shadow="never">
      <template #header>
        <div class="table-header">
          <span>{{ t('auditLogs.title') }}</span>
          <span class="table-info">{{ t('auditLogs.total') }} {{ pagination.total }}</span>
        </div>
      </template>

      <el-table
        :data="logs"
        v-loading="loading"
        border
        stripe
        style="width: 100%"
        row-key="id"
      
            :empty-text="t('common.noData')">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column :label="t('auditLogs.actor')" min-width="150">
          <template #default="{ row }">
            <el-tag :type="actorTagType(row.actor_type)" size="small">
              {{ actorTypeText(row.actor_type) }}
            </el-tag>
            <span class="ml-2 text-sm text-gray-700">{{ row.actor_label || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="event" :label="t('auditLogs.event')" min-width="220" show-overflow-tooltip />
        <el-table-column :label="t('auditLogs.resource')" min-width="150">
          <template #default="{ row }">
            <span v-if="row.resource">{{ row.resource }}<span v-if="row.resource_id" class="text-gray-400">#{{ row.resource_id }}</span></span>
            <span v-else class="text-gray-400">-</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('auditLogs.result')" width="90">
          <template #default="{ row }">
            <el-tag :type="row.success ? 'success' : 'danger'" size="small">
              {{ row.success ? t('auditLogs.success') : t('auditLogs.failed') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('auditLogs.ip')" width="140">
          <template #default="{ row }">
            <span class="text-xs text-gray-600">{{ row.ip_address || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('auditLogs.time')" width="180">
          <template #default="{ row }">
            <span class="text-xs text-gray-600">{{ formatTime(row.created_at) }}</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :page-sizes="[20, 50, 100]"
          :total="pagination.total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="loadLogs"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import { Refresh, RefreshLeft } from '@element-plus/icons-vue'
import { auditLogAPI } from '../api/auditLogs.js'

const { t, locale } = useI18n()

const logs = ref([])
const loading = ref(false)
const dateRange = ref([])
const filters = reactive({ actor_type: '', event: '', resource: '' })
const pagination = reactive({ page: 1, pageSize: 50, total: 0 })

const actorTypeText = (type) => ({
  user: t('auditLogs.actorUser'),
  partner: t('auditLogs.actorPartner'),
  system: t('auditLogs.actorSystem'),
  anonymous: t('auditLogs.actorAnonymous')
}[type] || type || '-')

const actorTagType = (type) => ({
  user: 'primary',
  partner: 'success',
  system: 'info',
  anonymous: 'warning'
}[type] || 'info')

const formatTime = (dateString) => {
  if (!dateString) return '-'
  const d = new Date(dateString)
  if (Number.isNaN(d.getTime())) return String(dateString)
  return d.toLocaleString(locale.value)
}

const loadLogs = async () => {
  if (loading.value) return
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      limit: pagination.pageSize,
      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v))
    }
    if (dateRange.value && dateRange.value.length === 2) {
      params.start_date = dateRange.value[0]
      params.end_date = dateRange.value[1]
    }
    const res = await auditLogAPI.list(params)
    const data = res.data
    if (data.success) {
      logs.value = data.data.logs || []
      pagination.total = data.data.total || 0
    } else {
      ElMessage.error(data.message || t('auditLogs.messages.loadFailed'))
    }
  } catch (error) {
    console.error('加载行为审计日志失败:', error)
    ElMessage.error(t('auditLogs.messages.loadFailed'))
  } finally {
    loading.value = false
  }
}

const handleFilterChange = () => {
  pagination.page = 1
  loadLogs()
}

const handleSizeChange = () => {
  pagination.page = 1
  loadLogs()
}

const resetFilters = () => {
  filters.actor_type = ''
  filters.event = ''
  filters.resource = ''
  dateRange.value = []
  pagination.page = 1
  loadLogs()
}

onMounted(loadLogs)
</script>
