<template>
  <el-dialog
    v-model="visible"
    :title="t('csv.importTitle')"
    width="min(920px, 94vw)"
    class="csv-import-dialog"
    :close-on-click-modal="false"
  >
    <!-- 步骤 1：选文件 -->
    <div class="csv-step">
      <el-alert :title="t('csv.tip')" type="info" :closable="false" show-icon />

      <div class="csv-picker">
        <el-upload
          ref="uploadRef"
          :auto-upload="false"
          :show-file-list="false"
          accept=".csv,text/csv"
          :limit="1"
          :on-change="onFileChange"
          :on-exceed="onExceed"
        >
          <el-button type="primary" :icon="Upload">
            {{ file ? t('csv.replaceFile') : t('csv.chooseFile') }}
          </el-button>
        </el-upload>
        <span v-if="file" class="csv-filename">{{ file.name }}</span>
        <span v-else class="csv-filename csv-filename--empty">{{ t('csv.noFile') }}</span>
        <el-button link type="primary" @click="downloadTemplate">{{ t('csv.template') }}</el-button>
      </div>

      <p class="csv-hint">{{ hint }}</p>

      <!-- 导入模式：严格（全有或全无）/ 跳过错误行 -->
      <el-radio-group v-model="importMode" size="small" class="csv-mode">
        <el-radio-button value="strict">{{ t('csv.modeStrict') }}</el-radio-button>
        <el-radio-button value="skip">{{ t('csv.modeSkip') }}</el-radio-button>
      </el-radio-group>
      <p class="csv-mode-hint">{{ importMode === 'strict' ? t('csv.modeStrictHint') : t('csv.modeSkipHint') }}</p>
    </div>

    <!-- 步骤 2：预览结果 -->
    <div v-if="preview" class="csv-preview">
      <el-alert
        :title="preview.invalidCount > 0
          ? t('csv.hasProblems', { count: preview.invalidCount })
          : t('csv.allOk')"
        :type="preview.invalidCount > 0 ? 'warning' : 'success'"
        :closable="false"
        show-icon
      />

      <div class="csv-summary">
        {{ t('csv.summary', {
          total: preview.totalRows,
          valid: preview.validCount,
          create: preview.createCount,
          update: preview.updateCount,
          invalid: preview.invalidCount
        }) }}
      </div>

      <!-- 有问题的行：逐行列出原因（运营要能对着 Excel 找） -->
      <div v-if="preview.invalidCount > 0" class="csv-section">
        <h4 class="csv-section__title">{{ t('csv.invalidRows') }}</h4>
        <el-table :data="preview.invalid" size="small" border max-height="220">
          <el-table-column prop="rowNumber" :label="t('csv.row')" width="70" align="center" />
          <el-table-column :prop="subjectKey" :label="t('csv.subject')" min-width="140" show-overflow-tooltip />
          <el-table-column :label="t('common.error')" min-width="240">
            <template #default="scope">
              <span class="csv-error">{{ scope.row.errors.join('；') }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 可导入的行 -->
      <div v-if="preview.validCount > 0" class="csv-section">
        <el-table :data="preview.valid" size="small" border max-height="260">
          <el-table-column prop="rowNumber" :label="t('csv.row')" width="70" align="center" />
          <el-table-column :label="t('csv.action')" width="90" align="center">
            <template #default="scope">
              <el-tag :type="scope.row.action === 'create' ? 'success' : 'warning'" size="small">
                {{ scope.row.action === 'create' ? t('csv.actionCreate') : t('csv.actionUpdate') }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            v-for="col in validColumns"
            :key="col.key"
            :prop="col.key"
            :label="col.label"
            :width="col.width"
            :min-width="col.minWidth"
            align="right"
            show-overflow-tooltip
          />
        </el-table>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ t('common.cancel') }}</el-button>
      <el-button v-if="!preview" :disabled="!file" :loading="previewing" @click="doPreview">
        {{ previewing ? t('csv.previewing') : t('csv.preview') }}
      </el-button>
      <el-button
        v-else
        type="primary"
        :disabled="preview.invalidCount > 0 || preview.validCount === 0"
        :loading="importing"
        @click="doImport"
      >
        {{ importing ? t('csv.importing') : t('csv.doImport') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import { Upload } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import api from '../api/index.js'

const { t } = useI18n()
const emit = defineEmits(['imported'])

const props = defineProps({
  /**
   * 导入类型：决定调哪个接口、显示哪些列。
   *   products —— 商品（/products/import）
   *   partners —— 合作方（/admin/partners/import）
   */
  type: { type: String, default: 'products' },
  /** 预览表里"可导入行"的列 */
  validColumns: { type: Array, default: () => [] },
  /** 预览表里"有问题的行"的主体字段名（row.name / row.login） */
  subjectKey: { type: String, default: 'name' },
  /** 提示文案 */
  hint: { type: String, default: '' }
})

const visible = ref(false)
const file = ref(null)
const preview = ref(null)
/**
 * 导入模式：
 *   strict（默认）—— 有一行有问题就整批不落库
 *   skip —— 跳过有问题的行，导入其余的，问题行逐条回报
 */
const importMode = ref('strict')
const previewing = ref(false)
const importing = ref(false)
const uploadRef = ref(null)

/** 导入接口路径 */
const endpoint = computed(() =>
  props.type === 'partners' ? '/admin/partners/import' : '/products/import'
)

/** 模板的表头 + 一行示例 */
const template = computed(() => {
  if (props.type === 'partners') {
    return {
      header: 'id,login,display_name,account_kind,discount_percent,is_active',
      sample: ',shop_example,示例店铺,dealer,10,true'
    }
  }
  return {
    header: 'id,name,name_th,category,price,stock,points,description,image',
    sample: ',示例商品,ตัวอย่าง,电子烟,100,50,0,这是一个示例,/uploads/products/example.png'
  }
})

/** 打开对话框（每次都重置状态，避免上一次的预览残留） */
const open = () => {
  file.value = null
  preview.value = null
  previewing.value = false
  importing.value = false
  visible.value = true
}

const onFileChange = (uploadFile) => {
  file.value = uploadFile.raw
  preview.value = null // 换了文件，旧预览作废
}

// 切了导入模式：strict 与 skip 的判定不同，旧预览作废（避免按旧模式的结论去导入）
watch(importMode, () => {
  preview.value = null
})

const onExceed = () => {
  ElMessage.warning(t('csv.replaceFile'))
}

/** 预览：只校验不落库 */
const doPreview = async () => {
  if (!file.value || previewing.value) return
  previewing.value = true
  try {
    const fd = new FormData()
    fd.append('file', file.value)
    fd.append('dry_run', '1')
    fd.append('mode', importMode.value)
    const res = await api.post(endpoint.value, fd, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    if (res?.data?.success) {
      preview.value = res.data.data
      if (res.data.data.invalidCount === 0) {
        ElMessage.success(res.data.message)
      } else {
        ElMessage.warning(res.data.message)
      }
    } else {
      ElMessage.error(res?.data?.message || t('common.error'))
    }
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('common.error'))
  } finally {
    previewing.value = false
  }
}

/** 真正导入 */
const doImport = async () => {
  if (!file.value || importing.value) return
  importing.value = true
  try {
    const fd = new FormData()
    fd.append('file', file.value)
    fd.append('dry_run', 'false')
    fd.append('mode', importMode.value)
    const res = await api.post(endpoint.value, fd, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    if (res?.data?.success) {
      ElMessage.success(res.data.message || t('common.success'))
      visible.value = false
      emit('imported', res.data.data)
    } else {
      ElMessage.error(res?.data?.message || t('common.error'))
    }
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('common.error'))
  } finally {
    importing.value = false
  }
}

/** 下载空白模板（含表头 + 一行示例） */
const downloadTemplate = () => {
  const { header, sample } = template.value
  // BOM：Excel 打开中文不乱码
  const blob = new Blob(['﻿' + header + '\r\n' + sample], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = props.type === 'partners' ? 'partners-template.csv' : 'products-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

defineExpose({ open })
</script>

<style scoped>
.csv-picker {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px 0 8px;
  flex-wrap: wrap;
}

.csv-filename {
  font-size: 13px;
  color: #303133;
}

.csv-filename--empty {
  color: #909399;
}

.csv-mode {
  margin-top: 8px;
}

.csv-mode-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #909399;
}

.csv-hint {
  margin: 0 0 4px;
  font-size: 12px;
  line-height: 1.6;
  color: #606266;
}

.csv-preview {
  margin-top: 16px;
}

.csv-summary {
  margin: 10px 0;
  font-size: 13px;
  color: #303133;
}

.csv-section {
  margin-top: 14px;
}

.csv-section__title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.csv-error {
  color: #f56c6c;
  font-size: 12px;
  line-height: 1.5;
}
</style>
