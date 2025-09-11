<template>
  <div class="system-config">
    <!-- 页面标题 -->
    <div class="page-header">
      <h2 class="page-title">{{ t('systemConfig.title') }}</h2>
      <p class="page-description">{{ t('systemConfig.description') }}</p>
    </div>

    <!-- 配置项 -->
    <div class="config-sections">
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

      <!-- 汇算比例配置 -->
      <el-card class="config-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <h3>{{ t('systemConfig.exchangeRate') }}</h3>
            <span class="card-subtitle">{{ t('systemConfig.exchangeRateSubtitle') }}</span>
          </div>
        </template>
        
        <div class="config-content">
          <div class="exchange-rate-section">
            <h4>{{ t('systemConfig.currentExchangeRate') }}: {{ exchangeRate.toFixed(2) }}</h4>
            
            <div class="input-section">
              <h4>{{ t('systemConfig.exchangeRateValue') }}</h4>
              <div class="exchange-rate-input">
                <el-input-number
                  v-model="exchangeRate"
                  :min="0"
                  :precision="2"
                  :step="0.01"
                  :controls="true"
                  size="large"
                  style="width: 200px"
                  @change="saveExchangeRate"
                />
                <el-button 
                  type="primary" 
                  @click="saveExchangeRate(exchangeRate)"
                  style="margin-left: 15px"
                >
                  {{ t('systemConfig.saveExchangeRate') }}
                </el-button>
                <el-button 
                  type="default" 
                  @click="resetExchangeRate"
                  style="margin-left: 10px"
                >
                  {{ t('systemConfig.resetExchangeRate') }}
                </el-button>
              </div>
            </div>
            
            <div class="exchange-rate-tips">
              <p>{{ t('systemConfig.exchangeRateTips.range') }}</p>
              <p>{{ t('systemConfig.exchangeRateTips.precision') }}</p>
              <p>{{ t('systemConfig.exchangeRateTips.purpose') }}</p>
              <p>{{ t('systemConfig.exchangeRateTips.example') }}</p>
            </div>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 操作按钮 -->
    <div class="actions">
      <el-button type="primary" @click="loadConfigs" :loading="loading">
        <el-icon><Refresh /></el-icon>
        {{ t('systemConfig.refreshConfig') }}
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload, Delete, Refresh } from '@element-plus/icons-vue'
import { useAdminStore } from '../stores/admin.js'

// 国际化
const { t } = useI18n()

// 使用store
const adminStore = useAdminStore()

// 响应式数据
const loading = ref(false)
const homeBanner = ref(null)
const paymentQR = ref(null)
const exchangeRate = ref(1.00) // 汇算比例，默认1.00

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
        exchangeRate.value = parseFloat(configs.exchange_rate?.value || '1.00')
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

// 保存汇算比例
const saveExchangeRate = async (value) => {
  try {
    if (value < 0 || isNaN(value)) {
      ElMessage.error(t('systemConfig.messages.invalidExchangeRate'))
      return
    }
    
    // 格式化为两位小数
    const formattedValue = parseFloat(value).toFixed(2)
    
    const response = await adminStore.apiRequest('/api/system-config/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        key: 'exchange_rate',
        value: formattedValue,
        type: 'text',
        description: '汇算比例配置'
      })
    })
    
    if (response.ok) {
      const data = await response.json()
      if (data.success) {
        exchangeRate.value = parseFloat(formattedValue)
        ElMessage.success(t('systemConfig.messages.exchangeRateSaveSuccess'))
      } else {
        ElMessage.error(data.message || t('systemConfig.messages.exchangeRateSaveFailed'))
      }
    } else {
      ElMessage.error(t('systemConfig.messages.exchangeRateSaveFailed'))
    }
  } catch (error) {
    console.error('保存汇算比例失败:', error)
    ElMessage.error(t('systemConfig.messages.exchangeRateSaveFailed'))
  }
}

// 重置汇算比例
const resetExchangeRate = () => {
  exchangeRate.value = 1.00
  saveExchangeRate(1.00)
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

/* 配置区域 */
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
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.card-subtitle {
  font-size: 14px;
  color: #909399;
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

/* 操作按钮 */
.actions {
  text-align: center;
  padding: 20px 0;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .page-header {
    padding: 16px;
  }
  
  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
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
}
</style>
