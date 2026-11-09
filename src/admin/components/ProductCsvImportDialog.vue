<template>
  <el-dialog
    v-model="visible"
    :title="t('products.csvImportTitle')"
    width="min(920px, 94vw)"
    class="csv-import-dialog"
    :close-on-click-modal="false"
  >
    <!-- 步骤 1：选文件 -->
    <div class="csv-step">
      <el-alert :title="t('products.csvDialogTip')" type="info" :closable="false" show-icon />

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
            {{ file ? t('products.csvReplaceFile') : t('products.csvChooseFile') }}
          </el-button>
        </el-upload>
        <span v-if="file" class="csv-filename">{{ file.name }}</span>
        <span v-else class="csv-filename csv-filename--empty">{{ t('products.csvNoFile') }}</span>
        <el-button link type="primary" @click="downloadTemplate">{{ t('products.csvTemplate') }}</el-button>
      </div>

      <p class="csv-hint">{{ t('products.csvHint') }}</p>
    </div>

    <!-- 步骤 2：预览结果 -->
    <div v-if="preview" class="csv-preview">
      <el-alert
        :title="preview.invalidCount > 0
          ? t('products.csvHasProblems', { count: preview.invalidCount })
          : t('products.csvAllOk')"
        :type="preview.invalidCount > 0 ? 'warning' : 'success'"
        :closable="false"
        show-icon
      />

      <div class="csv-summary">
        {{ t('products.csvPreviewSummary', {
          total: preview.totalRows,
          valid: preview.validCount,
          create: preview.createCount,
          update: preview.updateCount,
          invalid: preview.invalidCount
        }) }}
      </div>

      <!-- 有问题的行：逐行列出原因（运营要能对着 Excel 找） -->
      <div v-if="preview.invalidCount > 0" class="csv-section">
        <h4 class="csv-section__title">{{ t('products.csvInvalidRows') }}</h4>
        <el-table :data="preview.invalid" size="small" border max-height="220">
          <el-table-column prop="rowNumber" :label="t('products.csvRow')" width="70" align="center" />
          <el-table-column prop="name" :label="t('products.name')" min-width="140" show-overflow-tooltip />
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
          <el-table-column prop="rowNumber" :label="t('products.csvRow')" width="70" align="center" />
          <el-table-column :label="t('products.csvAction')" width="90" align="center">
            <template #default="scope">
              <el-tag :type="scope.row.action === 'create' ? 'success' : 'warning'" size="small">
                {{ scope.row.action === 'create' ? t('products.csvActionCreate') : t('products.csvActionUpdate') }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="name" :label="t('products.name')" min-width="140" show-overflow-tooltip />
          <el-table-column prop="category_name" :label="t('products.category')" width="120" show-overflow-tooltip />
          <el-table-column prop="price" :label="t('products.price')" width="100" align="right" />
          <el-table-column prop="stock" :label="t('products.stock')" width="90" align="right" />
        </el-table>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">{{ t('common.cancel') }}</el-button>
      <el-button v-if="!preview" :disabled="!file" :loading="previewing" @click="doPreview">
        {{ previewing ? t('products.csvPreviewing') : t('products.csvPreview') }}
      </el-button>
      <el-button
        v-else
        type="primary"
        :disabled="preview.invalidCount > 0 || preview.validCount === 0"
        :loading="importing"
        @click="doImport"
      >
        {{ importing ? t('products.csvImporting') : t('products.csvDoImport') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import { Upload } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { productAPI } from '../api/products.js'

const { t } = useI18n()
const emit = defineEmits(['imported'])

const visible = ref(false)
const file = ref(null)
const preview = ref(null)
const previewing = ref(false)
const importing = ref(false)
const uploadRef = ref(null)

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

const onExceed = () => {
  ElMessage.warning(t('products.csvReplaceFile'))
}

/** 预览：只校验不落库 */
const doPreview = async () => {
  if (!file.value || previewing.value) return
  previewing.value = true
  try {
    const res = await productAPI.importCsv(file.value, true)
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
    const res = await productAPI.importCsv(file.value, false)
    if (res?.data?.success) {
      ElMessage.success(res.data.message || t('products.csvDone', { create: 0, update: 0 }))
      visible.value = false
      // 通知父页面刷新列表
      emit('imported')
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
  const header = 'id,name,name_th,category,price,stock,points,description,image'
  const sample = ',示例商品,ตัวอย่าง,电子烟,100,50,0,这是一个示例,/uploads/products/example.png'
  // BOM：Excel 打开中文不乱码
  const blob = new Blob(['﻿' + header + '\r\n' + sample], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'products-template.csv'
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
