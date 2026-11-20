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
      <!--
        禁用条件要**看模式**：
        strict 模式下有错误行就不能导（整批会失败）；
        skip 模式下错误行会被跳过 —— 这正是这个模式存在的意义，
        还按 strict 的规则禁用按钮，就等于"跳过错误行"这个模式根本没法用。
      -->
      <el-button
        v-else
        type="primary"
        :disabled="(importMode === 'strict' && preview.invalidCount > 0) || preview.validCount === 0"
        :loading="importing"
        @click="doImport"
      >
        {{ importing ? t('csv.importing') : t('csv.doImport') }}
      </el-button>
    </template>
  </el-dialog>

  <!--
    初始密码展示（第 45 轮补上）。

    批量导入用户/合作方时，系统会给每个新账号生成一个**初始密码**，
    后端只在导入结果里返回一次（"初始密码只在这里出现一次，运营要线下告知用户"）。
    之前前端把整个导入结果丢掉了（@imported 只用来刷新列表）
    → **运营根本拿不到这些密码** → 导入的账号谁也登不进去，
    只能一个个"重置密码"。

    所以这里必须把它显示出来，并且支持一键复制。
  -->
  <el-dialog
    v-model="passwordVisible"
    :title="t('csv.initialPasswordTitle')"
    width="560px"
    data-testid="csv-initial-password-dialog"
  >
    <p class="text-sm text-gray-600 mb-3">{{ t('csv.initialPasswordHint') }}</p>
    <div class="max-h-80 overflow-y-auto border border-gray-200 rounded">
      <table class="w-full text-sm">
        <thead class="bg-gray-50 text-gray-600">
          <tr>
            <th class="text-left px-3 py-2">{{ t('csv.nickname') }}</th>
            <th class="text-left px-3 py-2">{{ t('csv.username') }}</th>
            <th class="text-left px-3 py-2">{{ t('csv.initialPassword') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="acc in createdAccounts" :key="acc.rowNumber" class="border-t border-gray-100">
            <td class="px-3 py-2 text-gray-900">{{ acc.nickname }}</td>
            <td class="px-3 py-2 text-gray-600">{{ acc.username }}</td>
            <td class="px-3 py-2 font-mono text-gray-900 select-all">{{ acc.initialPassword }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <template #footer>
      <el-button @click="copyPasswords">{{ t('csv.copyPasswords') }}</el-button>
      <el-button type="primary" @click="passwordVisible = false">{{ t('common.confirm') }}</el-button>
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

// 初始密码（第 45 轮）：导入结果里带初始密码的新账号
const passwordVisible = ref(false)
const createdAccounts = ref([])

const props = defineProps({
  /**
   * 导入类型：决定调哪个接口、显示哪些列。
   *   products —— 商品（/products/import）
   *   partners —— 合作方（/admin/partners/import）
   *   users    —— 用户（/admin/users/import）
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

/**
 * 导入接口路径。
 *
 * ⚠️ 三种类型必须**逐个列出来** —— 之前只分 partners / 其它，
 * 于是 `type="users"` 落到了商品接口 `/products/import`：
 * 用户 CSV 没有 name/price 列 → 必然 400「CSV 缺少必填列」，
 * 用户批量导入**完全不可用**；更糟的是若 CSV 里碰巧有 name/price 两列，
 * 用户数据会被当成商品写进商品表。
 */
const endpoint = computed(() => {
  if (props.type === 'partners') return '/admin/partners/import'
  if (props.type === 'users') return '/admin/users/import'
  return '/products/import'
})

/** 模板的表头 + 一行示例 */
const template = computed(() => {
  if (props.type === 'partners') {
    return {
      header: 'id,login,display_name,account_kind,discount_percent,is_active',
      sample: ',shop_example,示例店铺,dealer,10,true'
    }
  }
  if (props.type === 'users') {
    return {
      header: 'id,nickname,username,email,phone,country_code,referral_code,is_active',
      sample: ',示例用户,,user@example.com,812345678,+66,,true'
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
      /**
       * 第 45 轮：把**初始密码**显示出来。
       * 后端只在导入结果里返回一次，丢了就再也拿不到 →
       * 导入的账号谁也登不进去（只能逐个重置密码）。
       */
      const withPassword = (res.data.data?.created || []).filter(c => c.initialPassword)
      if (withPassword.length > 0) {
        createdAccounts.value = withPassword
        passwordVisible.value = true
      }
    } else {
      ElMessage.error(res?.data?.message || t('common.error'))
    }
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || t('common.error'))
  } finally {
    importing.value = false
  }
}

/** 复制全部初始密码（运营要发给用户） */
const copyPasswords = async () => {
  const text = createdAccounts.value
    .map(a => `${a.nickname}\t${a.username}\t${a.initialPassword}`)
    .join('\n')
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(t('csv.copyPasswordsDone'))
  } catch {
    ElMessage.warning(t('csv.copyPasswordsFailed'))
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
