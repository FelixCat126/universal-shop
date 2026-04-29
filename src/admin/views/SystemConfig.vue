<template>
  <div class="system-config">
    <div class="admin-module-toolbar">
      <el-button type="primary" @click="loadConfigs" :loading="loading">
        <el-icon><Refresh /></el-icon>
        {{ t('systemConfig.refreshConfig') }}
      </el-button>
    </div>

    <div class="config-sections">
      <!-- 多币种汇算（相对门户商品泰铢标价）— 放首屏便于查找 -->
      <el-card class="config-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <h3>{{ t('systemConfig.exchangeRates') }}</h3>
            <span class="card-subtitle">{{ t('systemConfig.exchangeRatesSubtitle') }}</span>
          </div>
        </template>
        
        <div class="config-content">
          <div class="exchange-rate-section">
            <el-alert
              type="info"
              :closable="false"
              show-icon
              class="exchange-rates-intro-alert"
            >
              {{ t('systemConfig.exchangeRatesIntro') }}
            </el-alert>

            <div class="fx-grid">
              <div class="fx-item">
                <div class="fx-item-labels">
                  <span class="fx-item-title">{{ t('systemConfig.fxUSD') }}</span>
                </div>
                <el-input-number
                  v-model="exchangeRatesUsd"
                  :min="0"
                  :precision="2"
                  :step="0.01"
                  class="fx-item-input"
                />
              </div>
              <div class="fx-item">
                <div class="fx-item-labels">
                  <span class="fx-item-title">{{ t('systemConfig.fxCNY') }}</span>
                </div>
                <el-input-number
                  v-model="exchangeRatesCny"
                  :min="0"
                  :precision="2"
                  :step="0.01"
                  class="fx-item-input"
                />
              </div>
              <div class="fx-item">
                <div class="fx-item-labels">
                  <span class="fx-item-title">{{ t('systemConfig.fxMYR') }}</span>
                </div>
                <el-input-number
                  v-model="exchangeRatesMyr"
                  :min="0"
                  :precision="2"
                  :step="0.01"
                  class="fx-item-input"
                />
              </div>
            </div>

            <div class="exchange-rate-input" style="margin-top: 16px">
              <el-button type="primary" @click="saveExchangeRates">{{ t('systemConfig.saveExchangeRates') }}</el-button>
              <el-button @click="resetExchangeRates">{{ t('systemConfig.resetExchangeRates') }}</el-button>
            </div>

            <div class="exchange-rate-tips">
              <p>{{ t('systemConfig.exchangeRatesTips.base') }}</p>
              <p>{{ t('systemConfig.exchangeRatesTips.range') }}</p>
              <p>{{ t('systemConfig.exchangeRatesTips.precision') }}</p>
              <p>{{ t('systemConfig.exchangeRatesTips.usdt') }}</p>
            </div>
          </div>
        </div>
      </el-card>

      <!-- 首页长图配置 -->
      <el-card class="config-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <h3>{{ t('systemConfig.homeBanner') }}</h3>
            <span class="card-subtitle">{{ t('systemConfig.homeBannerSubtitle') }}</span>
          </div>
        </template>
        
        <div class="config-content">
          <div class="current-image" v-if="homeBanner">
            <h4>{{ t('systemConfig.currentImage') }}</h4>
            <div class="image-preview">
              <img :src="getImageUrl(homeBanner)" alt="首页长图" />
              <div class="image-actions">
                <el-button type="danger" size="small" @click="deleteHomeBanner" :loading="deleting.homeBanner">
                  <el-icon><Delete /></el-icon>
                  {{ t('systemConfig.deleteImage') }}
                </el-button>
              </div>
            </div>
          </div>
          
          <div class="upload-section">
            <h4>{{ homeBanner ? t('systemConfig.replaceImage') : t('systemConfig.uploadImage') }}</h4>
            <el-upload
              class="upload-demo"
              :action="uploadUrl + '/upload/home-banner'"
              :headers="uploadHeaders"
              :show-file-list="false"
              :before-upload="beforeHomeBannerUpload"
              :on-success="handleHomeBannerSuccess"
              :on-error="handleHomeBannerError"
              name="banner"
            >
              <el-button type="primary" :loading="uploading.homeBanner">
                <el-icon><Upload /></el-icon>
                {{ uploading.homeBanner ? t('systemConfig.uploading') : t('systemConfig.selectImage') }}
              </el-button>
            </el-upload>
            <div class="upload-tips">
              <p>{{ t('systemConfig.uploadTips.bannerSize') }}</p>
              <p>{{ t('systemConfig.uploadTips.bannerFormat') }}</p>
              <p>{{ t('systemConfig.uploadTips.bannerFileSize') }}</p>
              <p>{{ t('systemConfig.uploadTips.bannerDisplay') }}</p>
            </div>
          </div>
        </div>
      </el-card>

      <!-- 支付二维码配置 -->
      <el-card class="config-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <h3>{{ t('systemConfig.paymentQR') }}</h3>
            <span class="card-subtitle">{{ t('systemConfig.paymentQRSubtitle') }}</span>
          </div>
        </template>
        
        <div class="config-content">
          <div class="current-image" v-if="paymentQR">
            <h4>{{ t('systemConfig.currentQR') }}</h4>
            <div class="image-preview qr-preview">
              <img :src="getImageUrl(paymentQR)" alt="支付二维码" />
              <div class="image-actions">
                <el-button type="danger" size="small" @click="deletePaymentQR" :loading="deleting.paymentQR">
                  <el-icon><Delete /></el-icon>
                  {{ t('systemConfig.deleteQR') }}
                </el-button>
              </div>
            </div>
          </div>
          
          <div class="upload-section">
            <h4>{{ paymentQR ? t('systemConfig.replaceQR') : t('systemConfig.uploadQR') }}</h4>
            <el-upload
              class="upload-demo"
              :action="uploadUrl + '/upload/payment-qr'"
              :headers="uploadHeaders"
              :show-file-list="false"
              :before-upload="beforePaymentQRUpload"
              :on-success="handlePaymentQRSuccess"
              :on-error="handlePaymentQRError"
              name="qrcode"
            >
              <el-button type="primary" :loading="uploading.paymentQR">
                <el-icon><Upload /></el-icon>
                {{ uploading.paymentQR ? t('systemConfig.uploading') : t('systemConfig.selectQR') }}
              </el-button>
            </el-upload>
            <div class="upload-tips">
              <p>{{ t('systemConfig.uploadTips.qrSize') }}</p>
              <p>{{ t('systemConfig.uploadTips.qrFormat') }}</p>
              <p>{{ t('systemConfig.uploadTips.qrFileSize') }}</p>
              <p>{{ t('systemConfig.uploadTips.qrDisplay') }}</p>
            </div>
          </div>
        </div>
      </el-card>

      <!-- 货币单位（全站统一） -->
      <el-card class="config-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <h3>{{ t('systemConfig.currencyUnit') }}</h3>
            <span class="card-subtitle">{{ t('systemConfig.currencyUnitSubtitle') }}</span>
          </div>
        </template>
        <div class="config-content">
          <div class="currency-unit-section">
            <el-select
              v-model="currencyCode"
              style="width: 280px"
            >
              <el-option value="THB" :label="t('systemConfig.currencyOptions.THB')" />
              <el-option value="USD" :label="t('systemConfig.currencyOptions.USD')" />
              <el-option value="CNY" :label="t('systemConfig.currencyOptions.CNY')" />
            </el-select>
            <el-button
              type="primary"
              style="margin-left: 12px"
              @click="saveCurrencyUnit"
            >
              {{ t('systemConfig.saveCurrencyUnit') }}
            </el-button>
            <div class="exchange-rate-tips" style="margin-top: 12px">
              <p>{{ t('systemConfig.currencyUnitTips') }}</p>
            </div>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload, Delete, Refresh } from '@element-plus/icons-vue'
import { useAdminStore } from '../stores/admin.js'
import { normalizeCurrencyCode, mergeCurrencyCodeIntoLocales } from '../../utils/currencyI18n.js'

// 国际化
const { t, mergeLocaleMessage } = useI18n()

// 使用store
const adminStore = useAdminStore()

// 响应式数据
const loading = ref(false)
const homeBanner = ref(null)
const paymentQR = ref(null)
const exchangeRatesUsd = ref(0)
const exchangeRatesCny = ref(0)
const exchangeRatesMyr = ref(0)
const currencyCode = ref('THB')

const uploading = reactive({
  homeBanner: false,
  paymentQR: false
})

const deleting = reactive({
  homeBanner: false,
  paymentQR: false
})

// 上传配置
const uploadUrl = `${window.location.protocol}//${window.location.hostname}:3000/api/system-config`
const uploadHeaders = {
  'Authorization': `Bearer ${adminStore.token}`
}

// 获取完整的图片URL
const getImageUrl = (imagePath) => {
  if (!imagePath) return null
  
  // 如果已经是完整URL，直接返回
  if (imagePath.startsWith('http')) {
    return imagePath
  }
  
  // 构建完整URL
  const baseUrl = `${window.location.protocol}//${window.location.hostname}:3000`
  return `${baseUrl}${imagePath}`
}

// 加载配置
const loadConfigs = async () => {
  try {
    loading.value = true
    
    const response = await adminStore.apiRequest('/api/system-config/', {
      method: 'GET'
    })
    
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        const configs = data.data
        homeBanner.value = configs.home_banner?.value || null
        paymentQR.value = configs.payment_qrcode?.value || null
        const xr = configs.exchange_rates?.value
        if (xr && typeof xr === 'object') {
          exchangeRatesUsd.value = parseFloat(xr.USD ?? '0')
          exchangeRatesCny.value = parseFloat(xr.CNY ?? '0')
          exchangeRatesMyr.value = parseFloat(xr.MYR ?? '0')
        } else {
          const legacy = parseFloat(configs.exchange_rate?.value || '0')
          const v = Number.isFinite(legacy) ? legacy : 0
          exchangeRatesUsd.value = v
          exchangeRatesCny.value = 0
          exchangeRatesMyr.value = 0
        }
        currencyCode.value = normalizeCurrencyCode(configs.currency_unit?.value)
        mergeCurrencyCodeIntoLocales(mergeLocaleMessage, currencyCode.value)
      } else {
        ElMessage.error(data.message || t('systemConfig.messages.loadConfigFailed'))
      }
    } else {
      ElMessage.error(t('systemConfig.messages.loadConfigFailed'))
    }
  } catch (error) {
    console.error('加载配置失败:', error)
    ElMessage.error(t('systemConfig.messages.loadConfigFailed'))
  } finally {
    loading.value = false
  }
}

// 首页长图上传前验证
const beforeHomeBannerUpload = (file) => {
  const isImage = file.type.startsWith('image/')
  const isLt5M = file.size / 1024 / 1024 < 5

  if (!isImage) {
    ElMessage.error(t('systemConfig.messages.invalidFileFormat'))
    return false
  }
  if (!isLt5M) {
    ElMessage.error(t('systemConfig.messages.fileTooLarge'))
    return false
  }
  
  uploading.homeBanner = true
  return true
}

// 支付二维码上传前验证
const beforePaymentQRUpload = (file) => {
  const isImage = file.type.startsWith('image/')
  const isLt5M = file.size / 1024 / 1024 < 5

  if (!isImage) {
    ElMessage.error(t('systemConfig.messages.invalidFileFormat'))
    return false
  }
  if (!isLt5M) {
    ElMessage.error(t('systemConfig.messages.fileTooLarge'))
    return false
  }
  
  uploading.paymentQR = true
  return true
}

// 首页长图上传成功
const handleHomeBannerSuccess = (response) => {
  uploading.homeBanner = false
  if (response.success) {
    homeBanner.value = response.data.imageUrl
    ElMessage.success(t('systemConfig.messages.uploadSuccess'))
  } else {
    ElMessage.error(response.message || t('systemConfig.messages.uploadFailed'))
  }
}

// 支付二维码上传成功
const handlePaymentQRSuccess = (response) => {
  uploading.paymentQR = false
  if (response.success) {
    paymentQR.value = response.data.imageUrl
    ElMessage.success(t('systemConfig.messages.uploadSuccess'))
  } else {
    ElMessage.error(response.message || t('systemConfig.messages.uploadFailed'))
  }
}

// 首页长图上传失败
const handleHomeBannerError = (error) => {
  uploading.homeBanner = false
  console.error('首页长图上传失败:', error)
  ElMessage.error(t('systemConfig.messages.uploadFailed'))
}

// 支付二维码上传失败
const handlePaymentQRError = (error) => {
  uploading.paymentQR = false
  console.error('支付二维码上传失败:', error)
  ElMessage.error(t('systemConfig.messages.uploadFailed'))
}

// 删除首页长图
const deleteHomeBanner = async () => {
  try {
    await ElMessageBox.confirm(
      t('systemConfig.messages.confirmDelete'),
      t('common.confirm'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    
    deleting.homeBanner = true
    
    const response = await adminStore.apiRequest('/api/system-config/home-banner', {
      method: 'DELETE'
    })
    
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        homeBanner.value = null
        ElMessage.success(t('systemConfig.messages.deleteSuccess'))
        if (data.warning) {
          console.warn('删除警告:', data.warning)
        }
      } else {
        console.error('删除首页长图失败 - 服务器响应:', data)
        ElMessage.error(data.message || t('systemConfig.messages.deleteFailed'))
      }
    } else {
      console.error('删除首页长图失败 - HTTP状态:', response.status, response.statusText)
      try {
        const errorData = await response.json()
        console.error('错误详情:', errorData)
        ElMessage.error(errorData.message || t('systemConfig.messages.deleteFailed'))
      } catch (e) {
        ElMessage.error(`${t('systemConfig.messages.deleteFailed')} (HTTP ${response.status})`)
      }
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除首页长图失败:', error)
      ElMessage.error(t('systemConfig.messages.deleteFailed'))
    }
  } finally {
    deleting.homeBanner = false
  }
}

// 删除支付二维码
const deletePaymentQR = async () => {
  try {
    await ElMessageBox.confirm(
      t('systemConfig.messages.confirmDelete'),
      t('common.confirm'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    
    deleting.paymentQR = true
    
    const response = await adminStore.apiRequest('/api/system-config/payment-qr', {
      method: 'DELETE'
    })
    
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        paymentQR.value = null
        ElMessage.success(t('systemConfig.messages.deleteSuccess'))
        if (data.warning) {
          console.warn('删除警告:', data.warning)
        }
      } else {
        console.error('删除支付二维码失败 - 服务器响应:', data)
        ElMessage.error(data.message || t('systemConfig.messages.deleteFailed'))
      }
    } else {
      console.error('删除支付二维码失败 - HTTP状态:', response.status, response.statusText)
      try {
        const errorData = await response.json()
        console.error('错误详情:', errorData)
        ElMessage.error(errorData.message || t('systemConfig.messages.deleteFailed'))
      } catch (e) {
        ElMessage.error(`${t('systemConfig.messages.deleteFailed')} (HTTP ${response.status})`)
      }
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除支付二维码失败:', error)
      ElMessage.error(t('systemConfig.messages.deleteFailed'))
    }
  } finally {
    deleting.paymentQR = false
  }
}

const saveExchangeRates = async () => {
  try {
    const usd = Number(exchangeRatesUsd.value)
    const cny = Number(exchangeRatesCny.value)
    const myr = Number(exchangeRatesMyr.value)
    if ([usd, cny, myr].some((n) => !Number.isFinite(n) || n < 0)) {
      ElMessage.error(t('systemConfig.messages.invalidExchangeRate'))
      return
    }

    const value = {
      USD: usd.toFixed(2),
      CNY: cny.toFixed(2),
      MYR: myr.toFixed(2)
    }

    const response = await adminStore.apiRequest('/api/system-config/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        key: 'exchange_rates',
        value,
        type: 'json',
        description: '多币种汇算 USD|CNY|MYR'
      })
    })

    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        exchangeRatesUsd.value = parseFloat(value.USD)
        exchangeRatesCny.value = parseFloat(value.CNY)
        exchangeRatesMyr.value = parseFloat(value.MYR)
        ElMessage.success(t('systemConfig.messages.exchangeRateSaveSuccess'))
      } else {
        ElMessage.error(data.message || t('systemConfig.messages.exchangeRateSaveFailed'))
      }
    } else {
      ElMessage.error(t('systemConfig.messages.exchangeRateSaveFailed'))
    }
  } catch (error) {
    console.error('保存汇率失败:', error)
    ElMessage.error(t('systemConfig.messages.exchangeRateSaveFailed'))
  }
}

const resetExchangeRates = async () => {
  exchangeRatesUsd.value = 0
  exchangeRatesCny.value = 0
  exchangeRatesMyr.value = 0
  await saveExchangeRates()
}

const saveCurrencyUnit = async () => {
  try {
    const valueToSave = normalizeCurrencyCode(currencyCode.value)
    const response = await adminStore.apiRequest('/api/system-config/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        key: 'currency_unit',
        value: valueToSave,
        type: 'text',
        description: '全站货币代码 THB|USD|CNY'
      })
    })
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        currencyCode.value = valueToSave
        mergeCurrencyCodeIntoLocales(mergeLocaleMessage, valueToSave)
        ElMessage.success(t('systemConfig.messages.currencyUnitSaveSuccess'))
      } else {
        ElMessage.error(data.message || t('systemConfig.messages.currencyUnitSaveFailed'))
      }
    } else {
      ElMessage.error(t('systemConfig.messages.currencyUnitSaveFailed'))
    }
  } catch (error) {
    console.error('保存货币单位失败:', error)
    ElMessage.error(t('systemConfig.messages.currencyUnitSaveFailed'))
  }
}

// 组件挂载时加载配置
onMounted(() => {
  loadConfigs()
})
</script>

<style scoped>
.system-config {
  padding: 0;
}

.config-sections {
  display: grid;
  gap: 20px;
  margin-bottom: 20px;
}

.config-card {
  transition: all 0.3s;
}

.config-card:hover {
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px 20px;
}

.card-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
}

.card-subtitle {
  flex: 1 1 280px;
  min-width: min(100%, 220px);
  max-width: 100%;
  font-size: 14px;
  color: #909399;
  line-height: 1.5;
  text-align: right;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.config-content {
  padding: 20px 0;
}

.config-content h4 {
  margin: 0 0 15px 0;
  font-size: 16px;
  font-weight: 500;
  color: #606266;
}

/* 图片预览 */
.current-image {
  margin-bottom: 30px;
}

.image-preview {
  position: relative;
  display: inline-block;
  border: 2px dashed #dcdfe6;
  border-radius: 8px;
  padding: 10px;
  background: #fafafa;
}

.image-preview img {
  max-width: 100%;
  max-height: 200px;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.qr-preview img {
  max-width: 200px;
  max-height: 200px;
}

.image-actions {
  margin-top: 10px;
  text-align: center;
}

/* 上传区域 */
.upload-section {
  border-top: 1px solid #ebeef5;
  padding-top: 20px;
}

.upload-demo {
  margin-bottom: 15px;
}

.upload-tips {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 6px;
  padding: 15px;
  margin-top: 15px;
}

.upload-tips p {
  margin: 5px 0;
  font-size: 13px;
  color: #6c757d;
}

.upload-tips p:first-child {
  margin-top: 0;
}

.upload-tips p:last-child {
  margin-bottom: 0;
}

/* 汇算比例配置 */
.exchange-rate-section {
  padding: 20px 0;
}

.input-section {
  border-top: 1px solid #ebeef5;
  padding-top: 20px;
  margin-top: 20px;
}

.fx-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 22px 28px;
  align-items: stretch;
}

.fx-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.exchange-rates-intro-alert {
  margin-bottom: 20px;
}

.fx-item-labels {
  display: flex;
  flex-direction: column;
  gap: 4px;
  /* 英文等长句换行时仍与同行其它列输入框顶对齐 */
  flex: 0 0 auto;
  min-height: 3.1em;
}

.fx-item-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  line-height: 1.45;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.fx-item-input {
  width: 200px;
  max-width: 100%;
  align-self: flex-start;
}

.exchange-rate-input {
  display: flex;
  align-items: center;
  margin: 15px 0;
}

.exchange-rate-tips {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 6px;
  padding: 15px;
  margin-top: 15px;
}

.exchange-rate-tips p {
  margin: 5px 0;
  font-size: 13px;
  color: #6c757d;
}

.exchange-rate-tips p:first-child {
  margin-top: 0;
}

.exchange-rate-tips p:last-child {
  margin-bottom: 0;
}

/* 响应式设计 */
@media (max-width: 900px) {
  .card-subtitle {
    flex-basis: 100%;
    text-align: left;
  }
}

@media (max-width: 768px) {
  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
  }

  .card-subtitle {
    flex-basis: auto;
  }
  
  .image-preview img {
    max-height: 150px;
  }
  
  .exchange-rate-input {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  
  .exchange-rate-input .el-input-number {
    width: 100% !important;
  }

  .exchange-rate-section .fx-item-input {
    width: 100% !important;
  }
}
</style>
