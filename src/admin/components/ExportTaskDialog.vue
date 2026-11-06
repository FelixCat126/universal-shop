<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('exportTasks.title')"
    width="720px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
    @open="handleOpen"
  >
    <!-- 提交栏 -->
    <div class="export-task-submit">
      <el-select v-model="type" style="width: 200px">
        <el-option :label="t('exportTasks.typeUsers')" value="users" />
        <el-option :label="t('exportTasks.typeOrders')" value="orders" />
      </el-select>
      <el-button type="primary" :loading="submitting" @click="submit">
        <el-icon><Download /></el-icon>
        {{ t('exportTasks.submit') }}
      </el-button>
      <el-button :loading="loading" @click="load">
        <el-icon><Refresh /></el-icon>
      </el-button>
    </div>

    <el-alert
      v-if="notice"
      :title="notice"
      type="info"
      :closable="false"
      show-icon
      class="export-task-notice"
    />

    <!-- 任务列表 -->
    <el-table v-loading="loading" :data="jobs" size="small" empty-text=" ">
      <el-table-column :label="t('exportTasks.colType')" width="100">
        <template #default="{ row }">
          {{ row.type === 'orders' ? t('exportTasks.typeOrders') : t('exportTasks.typeUsers') }}
        </template>
      </el-table-column>
      <el-table-column :label="t('exportTasks.colStatus')" width="110">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">
            {{ t(`exportTasks.status.${row.status}`) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('exportTasks.colRows')" width="100">
        <template #default="{ row }">
          {{ row.row_count ?? '-' }}
        </template>
      </el-table-column>
      <el-table-column :label="t('exportTasks.colSize')" width="110">
        <template #default="{ row }">
          {{ formatSize(row.file_size) }}
        </template>
      </el-table-column>
      <el-table-column :label="t('exportTasks.colFilters')" min-width="140">
        <template #default="{ row }">
          <span v-if="!hasFilters(row)">{{ t('exportTasks.noFilters') }}</span>
          <span v-else class="export-task-filters">{{ describeFilters(row.params) }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="t('exportTasks.colCreated')" min-width="160">
        <template #default="{ row }">
          {{ formatTime(row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column :label="t('exportTasks.colActions')" width="150" align="right">
        <template #default="{ row }">
          <el-button
            v-if="row.downloadable"
            type="primary"
            link
            :loading="downloadingId === row.id"
            @click="download(row)"
          >
            {{ t('exportTasks.download') }}
          </el-button>
          <el-button
            v-if="row.status === 'failed'"
            type="warning"
            link
            @click="retry(row)"
          >
            {{ t('exportTasks.retry') }}
          </el-button>
          <el-button
            type="danger"
            link
            @click="remove(row)"
          >
            {{ t('exportTasks.delete') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <span class="export-task-footer">
        <el-text v-if="polling" type="info" size="small">
          {{ t('exportTasks.pollingHint') }}
        </el-text>
      </span>
      <el-button @click="emit('update:modelValue', false)">
        {{ t('common.close') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
/**
 * 异步导出任务对话框
 *
 * 用法：父组件用 v-model 控制显隐，并在 open 时通过 props 预设导出类型。
 * 任务在后台生成，这里只负责：提交 → 轮询状态 → 下载。
 */
import { ref, watch, onUnmounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import { Download, Refresh } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import {
  createExportJob,
  listExportJobs,
  deleteExportJob,
  downloadExportJob,
  parseDownloadFilename
} from '../api/exportJobs.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // 打开时的默认类型：'users' | 'orders'
  defaultType: { type: String, default: 'users' },
  // 当前列表页的筛选条件 —— 导出结果应与列表所见一致
  params: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['update:modelValue'])

const { t } = useI18n()

const type = ref(props.defaultType)
const jobs = ref([])
const loading = ref(false)
const submitting = ref(false)
const downloadingId = ref(null)
const notice = ref('')
const polling = ref(false)

let timer = null

// 有任务在跑就要继续轮询，全部结束就停
const hasActive = computed(() =>
  jobs.value.some(j => j.status === 'pending' || j.status === 'running')
)

watch(() => props.modelValue, (open) => {
  if (!open) stopPolling()
})

watch(() => props.defaultType, (val) => {
  if (props.modelValue) type.value = val
})

/** 该任务是否带筛选条件 */
function hasFilters (row) {
  return row?.params && Object.keys(row.params).length > 0
}

/** 把筛选条件拼成一句可读描述 */
function describeFilters (params = {}) {
  const labels = {
    status: t('exportTasks.colStatus'),
    keyword: t('exportTasks.colKeyword'),
    email: t('exportTasks.colEmail'),
    phone: t('exportTasks.colPhone'),
    referral_code: t('exportTasks.colReferral'),
    startDate: t('exportTasks.colStartDate'),
    endDate: t('exportTasks.colEndDate')
  }
  return Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map(k => `${labels[k] || k}=${params[k]}`)
    .join(', ')
}

function statusType (status) {
  if (status === 'done') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'running') return 'warning'
  return 'info'
}

function formatSize (bytes) {
  if (!bytes && bytes !== 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime (value) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString()
}

async function handleOpen () {
  type.value = props.defaultType
  await load()
  startPolling()
}

async function load () {
  loading.value = true
  try {
    const res = await listExportJobs()
    jobs.value = res?.data?.data?.jobs || []
    if (hasActive.value) {
      startPolling()
    } else {
      stopPolling()
    }
  } catch (error) {
    ElMessage.error(error?.response?.data?.message || t('exportTasks.loadFailed'))
  } finally {
    loading.value = false
  }
}

function startPolling () {
  if (timer) return
  polling.value = true
  timer = setInterval(async () => {
    try {
      const res = await listExportJobs()
      jobs.value = res?.data?.data?.jobs || []
    } catch {
      // 轮询失败不打扰用户，等下一轮
    }
    if (!hasActive.value) stopPolling()
  }, 3000)
}

function stopPolling () {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  polling.value = false
}

onUnmounted(stopPolling)

async function submit () {
  submitting.value = true
  try {
    const res = await createExportJob(type.value, { ...props.params })
    const job = res?.data?.data?.job
    if (res?.data?.data?.reused) {
      notice.value = t('exportTasks.reusedNotice')
    } else {
      notice.value = ''
    }
    ElMessage.success(job ? t('exportTasks.submitSuccess') : t('exportTasks.submitSuccess'))
    await load()
    startPolling()
  } catch (error) {
    ElMessage.error(error?.response?.data?.message || t('exportTasks.submitFailed'))
  } finally {
    submitting.value = false
  }
}

async function download (row) {
  downloadingId.value = row.id
  try {
    const res = await downloadExportJob(row.id)
    const blob = new Blob([res.data])
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = parseDownloadFilename(res.headers, row.file_name || 'export.xlsx')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  } catch (error) {
    ElMessage.error(error?.response?.data?.message || t('exportTasks.downloadFailed'))
  } finally {
    downloadingId.value = null
  }
}

async function retry (row) {
  try {
    await createExportJob(row.type, { ...props.params })
    ElMessage.success(t('exportTasks.submitSuccess'))
    await load()
    startPolling()
  } catch (error) {
    ElMessage.error(error?.response?.data?.message || t('exportTasks.submitFailed'))
  }
}

async function remove (row) {
  try {
    await ElMessageBox.confirm(
      t('exportTasks.deleteConfirm'),
      t('exportTasks.deleteTitle'),
      { type: 'warning', confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel') }
    )
  } catch {
    return
  }
  try {
    await deleteExportJob(row.id)
    ElMessage.success(t('exportTasks.deleteSuccess'))
    await load()
  } catch (error) {
    ElMessage.error(error?.response?.data?.message || t('exportTasks.deleteFailed'))
  }
}
</script>

<style scoped>
.export-task-submit {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}

.export-task-notice {
  margin-bottom: 12px;
}

.export-task-footer {
  float: left;
  line-height: 32px;
}

.export-task-filters {
  font-size: 12px;
  color: #909399;
  word-break: break-all;
}
</style>
