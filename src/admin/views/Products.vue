<template>
  <div class="products">
    <!-- 页面标题和操作栏 -->
    <div class="header-section">
      <div class="title-section">
        <h1>{{ t('products.title') }}</h1>
        <p>{{ t('products.description') }}</p>
      </div>
      <div class="action-section">
        <el-button type="primary" @click="showAddDialog">
          <el-icon><Plus /></el-icon>
          {{ t('products.addProduct') }}
        </el-button>
      </div>
    </div>

    <!-- 搜索和筛选栏 -->
    <div class="search-section">
      <el-row :gutter="20">
        <el-col :span="6">
          <el-input
            v-model="searchForm.name"
            :placeholder="t('products.searchName')"
            prefix-icon="Search"
            clearable
            @input="handleSearch"
          />
        </el-col>
        <el-col :span="4">
          <el-select
            v-model="searchForm.category"
            :placeholder="t('products.selectCategory')"
            clearable
            @change="handleSearch"
          >
            <el-option :label="t('products.categories.electronics')" value="electronics" />
            <el-option :label="t('products.categories.clothing')" value="clothing" />
            <el-option :label="t('products.categories.home')" value="home" />
            <el-option :label="t('products.categories.sports')" value="sports" />
            <el-option :label="t('products.categories.others')" value="others" />
          </el-select>
        </el-col>
        <el-col :span="4">
          <el-select
            v-model="searchForm.stockStatus"
            :placeholder="t('products.stockStatus')"
            clearable
            @change="handleSearch"
          >
            <el-option :label="t('products.stockOptions.normal')" value="normal" />
            <el-option :label="t('products.stockOptions.low')" value="low" />
            <el-option :label="t('products.stockOptions.out')" value="out" />
          </el-select>
        </el-col>
        <el-col :span="3">
          <el-button @click="resetSearch">{{ t('common.reset') }}</el-button>
        </el-col>
      </el-row>
    </div>

    <!-- 产品表格 -->
    <div class="table-section">
      <el-table 
        :data="filteredProducts" 
        style="width: 100%" 
        v-loading="loading"
        row-key="id"
        border
      >
        <el-table-column prop="id" label="ID" width="80" />
        
        <el-table-column :label="t('products.image.productImage')" width="120" align="center">
          <template #default="scope">
            <el-image
              :src="scope.row.image || defaultImage"
              :preview-src-list="[scope.row.image || defaultImage]"
              class="product-image"
              fit="cover"
              :lazy="true"
              loading="lazy"
            >
              <template #loading>
                <div class="image-loading">
                  <el-icon class="is-loading"><Loading /></el-icon>
                </div>
              </template>
              <template #error>
                <div class="image-error">
                  <el-icon><Picture /></el-icon>
                  <div class="error-text">{{ t('products.image.loadFailed') }}</div>
                </div>
              </template>
            </el-image>
          </template>
        </el-table-column>

        <el-table-column :label="t('products.name')" width="280" min-width="250">
          <template #default="scope">
            <div class="product-name-container">
              <div class="product-name" :title="scope.row.name">{{ scope.row.name }}</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="category" :label="t('products.category')" width="140" min-width="120">
          <template #default="scope">
            <el-tag>{{ getCategoryLabel(scope.row.category) }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="price" :label="t('products.price')" width="180" min-width="160" align="right">
          <template #default="scope">
            <div class="price-container">
              <!-- 有折扣时显示折扣价 -->
              <div v-if="scope.row.discount && scope.row.discount > 0" class="price-with-discount">
                <span class="discount-price">{{ t('common.currency') }}{{ getDiscountPrice(scope.row) }}</span>
                <span class="original-price">{{ t('common.currency') }}{{ scope.row.price }}</span>
                <el-tag type="danger" size="small" class="discount-tag">{{ scope.row.discount }}%</el-tag>
              </div>
              <!-- 无折扣时显示正常价格 -->
              <div v-else class="price-normal">
                <span class="price">{{ t('common.currency') }}{{ scope.row.price }}</span>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="stock" :label="t('products.stock')" width="160" min-width="140">
          <template #default="scope">
            <div class="stock-info-inline">
              <span :class="{
                'stock-normal': scope.row.stock > 10,
                'stock-low': scope.row.stock > 0 && scope.row.stock <= 10,
                'stock-out': scope.row.stock === 0
              }" class="stock-number">
                {{ scope.row.stock }}
              </span>
              <el-tag
                v-if="scope.row.stock <= 10 && scope.row.stock > 0"
                type="warning"
                size="small"
                class="stock-tag"
              >
                {{ t('products.stockOptions.low') }}
              </el-tag>
              <el-tag
                v-if="scope.row.stock === 0"
                type="danger"
                size="small"
                class="stock-tag"
              >
                {{ t('products.stockOptions.out') }}
              </el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column :label="t('common.createTime')" width="160" min-width="140">
          <template #default="scope">
            <span class="create-time">{{ formatDate(scope.row.created_at) }}</span>
          </template>
        </el-table-column>

        <el-table-column :label="t('products.actions')" width="280" min-width="260" fixed="right">
          <template #default="scope">
            <div class="action-buttons">
              <el-button
                size="small"
                @click="editProduct(scope.row)"
              >
                {{ t('products.edit') }}
              </el-button>
              <el-button
                size="small"
                type="warning"
                @click="showStockDialog(scope.row)"
              >
                {{ t('products.adjustStock') }}
              </el-button>
              <el-button
                size="small"
                type="danger"
                @click="deleteProduct(scope.row)"
              >
                {{ t('products.delete') }}
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-section">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="totalProducts"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
        />
      </div>
    </div>

    <!-- 添加/编辑产品对话框 -->
    <el-dialog
      :title="isEditing ? t('products.edit') + ' ' + t('products.name') : t('products.addProduct')"
      v-model="showProductDialog"
      width="800px"
      top="3vh"
      class="product-dialog"
      @close="resetProductForm"
    >
      <div class="dialog-content">
        <el-form
          :model="productForm"
          :rules="productRules"
          ref="productFormRef"
          label-width="120px"
        >
        <el-form-item :label="t('products.name')" prop="name">
          <el-input v-model="productForm.name" :placeholder="t('products.placeholders.enterName')" />
        </el-form-item>

        <el-form-item :label="t('products.description')" prop="description">
          <el-input
            type="textarea"
            v-model="productForm.description"
            :placeholder="t('products.placeholders.enterDescription')"
            :rows="3"
          />
        </el-form-item>

        <!-- 第一行：分类和价格 -->
        <el-row :gutter="20" class="form-row">
          <el-col :span="12">
            <el-form-item :label="t('products.category')" prop="category">
              <el-select v-model="productForm.category" :placeholder="t('products.selectCategory')">
                <el-option :label="t('products.categories.electronics')" value="electronics" />
                <el-option :label="t('products.categories.clothing')" value="clothing" />
                <el-option :label="t('products.categories.home')" value="home" />
                <el-option :label="t('products.categories.sports')" value="sports" />
                <el-option :label="t('products.categories.others')" value="others" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="t('products.price')" prop="price">
              <el-input-number
                v-model="productForm.price"
                :min="0"
                :precision="2"
                :step="0.01"
                :placeholder="t('products.placeholders.enterPrice')"
                style="width: 100%"
              >
                <template #prepend>{{ t('common.currency') }}</template>
              </el-input-number>
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 第二行：折扣和库存 -->
        <el-row :gutter="20" class="form-row">
          <el-col :span="12">
            <el-form-item :label="t('products.discount.label')" prop="discount">
              <el-input-number
                v-model="productForm.discount"
                :min="0"
                :max="100"
                :placeholder="t('products.discount.placeholder')"
                style="width: 100%"
              >
                <template #append>%</template>
              </el-input-number>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="t('products.stock')" prop="stock">
              <el-input-number
                v-model="productForm.stock"
                :min="0"
                :placeholder="t('products.placeholders.enterStock')"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item :label="t('products.image.productImage')">
          <el-upload
            class="image-uploader"
            action="/api/upload/product-image"
            :show-file-list="false"
            :on-success="handleImageSuccess"
            :on-error="handleImageError"
            :before-upload="beforeImageUpload"
            accept="image/*"
            name="image"
          >
            <img v-if="productForm.imagePreview" :src="productForm.imagePreview" class="image-preview" />
            <el-icon v-else class="image-uploader-icon"><Plus /></el-icon>
          </el-upload>
          <div class="image-tips">{{ t('products.image.uploadTips') }}</div>
          <div class="image-actions" v-if="productForm.imagePreview">
            <el-button size="small" @click="clearImage">{{ t('products.image.clearImage') }}</el-button>
          </div>
        </el-form-item>
        </el-form>
      </div>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showProductDialog = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" @click="saveProduct">
            {{ isEditing ? t('products.updateProduct') : t('products.addProduct') }}
          </el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 库存调整对话框 -->
    <el-dialog :title="t('products.stockAdjustment.title')" v-model="showStockAdjustDialog" width="400px">
      <el-form :model="stockForm" label-width="100px">
        <el-form-item :label="t('products.stockAdjustment.currentStock')">
          <span class="current-stock">{{ stockForm.currentStock }}</span>
        </el-form-item>
        <el-form-item :label="t('products.stockAdjustment.adjustType')">
          <el-radio-group v-model="stockForm.adjustType">
            <el-radio label="set">{{ t('products.stockAdjustment.setTo') }}</el-radio>
            <el-radio label="add">{{ t('products.stockAdjustment.increase') }}</el-radio>
            <el-radio label="subtract">{{ t('products.stockAdjustment.decrease') }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="t('products.stockAdjustment.quantity')">
          <el-input-number
            v-model="stockForm.quantity"
            :min="stockForm.adjustType === 'set' ? 0 : 1"
            :placeholder="t('products.placeholders.enterStock')"
          />
        </el-form-item>
        <el-form-item :label="t('products.stockAdjustment.preview')">
          <span class="stock-preview">{{ getStockPreview() }}</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="showStockAdjustDialog = false">{{ t('common.cancel') }}</el-button>
          <el-button type="primary" @click="adjustStock">{{ t('products.stockAdjustment.confirm') }}</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Search, Loading, Picture, Delete, Edit } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import { productAPI } from '../api/products.js'

export default {
  name: 'Products',
  components: {
    Plus,
    Search,
    Loading,
    Picture,
    Delete,
    Edit
  },
  setup() {
    const { t } = useI18n()
    
    // 默认图片（与门户端保持一致）
    const defaultImage = 'data:image/svg+xml,%3Csvg width="400" height="400" viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg"%3E%3Crect width="400" height="400" fill="%23F3F4F6"/%3E%3Cpath d="M120 140c0-8.284 6.716-15 15-15h130c8.284 0 15 6.716 15 15v120c0 8.284-6.716 15-15 15H135c-8.284 0-15-6.716-15-15V140z" fill="%23D1D5DB"/%3E%3Ccircle cx="160" cy="170" r="15" fill="%23909090"/%3E%3Cpath d="M120 230l40-50 40 25 60-70 80 95V140H120v90z" fill="%23909090"/%3E%3Ctext x="200" y="320" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="%23666"%E6%97%A0%E5%9B%BE%E7%89%87%3C/text%3E%3C/svg%3E'

    // 响应式数据
    const loading = ref(false)
    const showProductDialog = ref(false)
    const showStockAdjustDialog = ref(false)
    const isEditing = ref(false)
    const currentPage = ref(1)
    const pageSize = ref(20)
    const totalProducts = ref(0)
    const productFormRef = ref(null)


    // 搜索表单
    const searchForm = reactive({
      name: '',
      category: '',
      stockStatus: ''
    })

    // 产品表单
    const productForm = reactive({
      id: null,
      name: '',
      description: '',
      category: '',
      price: 0,
      discount: null,
      stock: 0,
      image: '',
      imagePreview: '' // 用于预览显示
    })

    // 库存调整表单
    const stockForm = reactive({
      productId: null,
      currentStock: 0,
      adjustType: 'set',
      quantity: 0
    })

    // 产品数据
    const products = ref([])
    const originalProducts = ref([]) // 用于存储完整的产品列表

    // 表单验证规则
    const productRules = {
      name: [
        { required: true, message: t('products.validation.nameRequired'), trigger: 'blur' }
      ],
      category: [
        { required: true, message: t('products.validation.categoryRequired'), trigger: 'change' }
      ],
      price: [
        { required: true, message: t('products.validation.priceRequired'), trigger: 'blur' }
      ],
      stock: [
        { required: true, message: t('products.validation.stockRequired'), trigger: 'blur' }
      ]
    }

    // 计算属性
    const filteredProducts = computed(() => {
      return products.value
    })

    // 方法
    const getCategoryLabel = (category) => {
      const categoryMap = {
        electronics: t('products.categories.electronics'),
        clothing: t('products.categories.clothing'),
        home: t('products.categories.home'),
        sports: t('products.categories.sports'),
        others: t('products.categories.others')
      }
      return categoryMap[category] || category
    }

    // 计算折扣价格
    const getDiscountPrice = (product) => {
      if (!product.discount || product.discount <= 0) {
        return product.price
      }
      const discountPrice = product.price * (1 - product.discount / 100)
      return discountPrice.toFixed(2)
    }

    const formatDate = (date) => {
      if (!date) return '-'
      return new Date(date).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    }

    const showAddDialog = () => {
      isEditing.value = false
      // 先清空表单数据
      resetProductForm()
      // 使用nextTick确保数据清空后再显示对话框
      setTimeout(() => {
        showProductDialog.value = true
      }, 10)
    }

    const editProduct = (product) => {
      isEditing.value = true
      Object.assign(productForm, {
        ...product,
        imagePreview: product.image || '' // 显示现有图片
      })
      showProductDialog.value = true
    }

    const resetProductForm = () => {
      // 先重置表单验证状态
      if (productFormRef.value) {
        productFormRef.value.resetFields()
        productFormRef.value.clearValidate()
      }
      
      // 清理预览URL避免内存泄漏
      if (productForm.imagePreview && productForm.imagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(productForm.imagePreview)
      }
      
      // 深度清空所有表单数据
      productForm.id = null
      productForm.name = ''
      productForm.description = ''
      productForm.category = ''
      productForm.price = null
      productForm.discount = null
      productForm.stock = null
      productForm.image = ''
      productForm.imagePreview = ''
      
      // 确保在下一个tick中再次清理验证状态
      setTimeout(() => {
        if (productFormRef.value) {
          productFormRef.value.clearValidate()
        }
      }, 50)
    }

    const saveProduct = async () => {
      if (!productFormRef.value) return
      
      try {
        await productFormRef.value.validate()
        
        // 添加确认对话框
        const confirmMessage = isEditing.value 
          ? t('products.messages.confirmUpdate')
          : t('products.messages.confirmAdd')
        
        await ElMessageBox.confirm(
          confirmMessage,
          t('common.confirm'),
          {
            confirmButtonText: t('common.confirm'),
            cancelButtonText: t('common.cancel'),
            type: 'warning',
          }
        )
        
        if (isEditing.value) {
          // 更新产品
          const response = await productAPI.updateProduct(productForm.id, productForm)
          if (response.data.success) {
            ElMessage.success(t('products.messages.updateSuccess'))
            loadProducts() // 重新加载产品列表
          }
        } else {
          // 添加产品
          const response = await productAPI.createProduct(productForm)
          if (response.data.success) {
            ElMessage.success(t('products.messages.addSuccess'))
            loadProducts() // 重新加载产品列表
          }
        }
        
        showProductDialog.value = false
        resetProductForm()
      } catch (error) {
        if (error === 'cancel') {
          return // 用户取消操作
        }
        console.error('保存产品失败:', error)
        ElMessage.error(t('products.messages.saveFailed') + ': ' + (error.response?.data?.message || error.message))
      }
    }

    const deleteProduct = async (product) => {
      try {
        await ElMessageBox.confirm(
          t('products.messages.confirmDelete'),
          t('common.confirm'),
          {
            confirmButtonText: t('common.confirm'),
            cancelButtonText: t('common.cancel'),
            type: 'warning'
          }
        )
        
        const response = await productAPI.deleteProduct(product.id)
        if (response.data.success) {
          ElMessage.success(t('products.messages.deleteSuccess'))
          loadProducts() // 重新加载产品列表
        }
      } catch (error) {
        if (error === 'cancel') {
          return // 用户取消操作
        }
        if (error.response) {
          ElMessage.error(t('products.messages.saveFailed') + ': ' + (error.response?.data?.message || error.message))
        }
      }
    }

    const showStockDialog = (product) => {
      stockForm.productId = product.id
      stockForm.currentStock = product.stock
      stockForm.adjustType = 'set'
      stockForm.quantity = product.stock
      showStockAdjustDialog.value = true
    }

    const getStockPreview = () => {
      const current = stockForm.currentStock
      const quantity = stockForm.quantity || 0
      
      switch (stockForm.adjustType) {
        case 'set':
          return quantity
        case 'add':
          return current + quantity
        case 'subtract':
          return Math.max(0, current - quantity)
        default:
          return current
      }
    }

    const adjustStock = async () => {
      try {
        const response = await productAPI.adjustStock(stockForm.productId, {
          type: stockForm.adjustType,
          quantity: stockForm.quantity
        })
        
        if (response.data.success) {
          ElMessage.success('库存调整成功')
          showStockAdjustDialog.value = false
          loadProducts() // 重新加载产品列表
        }
      } catch (error) {
        console.error('库存调整失败:', error)
        ElMessage.error('库存调整失败: ' + (error.response?.data?.message || error.message))
      }
    }

    const handleSearch = () => {
      currentPage.value = 1
      loadProducts()
    }

    const resetSearch = () => {
      Object.assign(searchForm, {
        name: '',
        category: '',
        stockStatus: ''
      })
      currentPage.value = 1
      loadProducts()
    }

    const handleSizeChange = (val) => {
      pageSize.value = val
      currentPage.value = 1
      loadProducts()
    }

    const handleCurrentChange = (val) => {
      currentPage.value = val
      loadProducts()
    }

    const handleImageSuccess = (response, file) => {
      if (response.success) {
        // 使用服务器返回的图片URL
        productForm.image = response.data.url
        productForm.imagePreview = response.data.url
        ElMessage.success('图片上传成功')
      } else {
        ElMessage.error(response.message || t('products.image.uploadFailed'))
      }
    }

    const handleImageError = (error, file) => {
      console.error('图片上传失败:', error)
      ElMessage.error(t('products.image.uploadFailed') + '，请重试')
    }

    const clearImage = () => {
      productForm.image = ''
      productForm.imagePreview = ''
      ElMessage.info('图片已清除')
    }

    const beforeImageUpload = (file) => {
      const isJPGOrPNG = file.type === 'image/jpeg' || file.type === 'image/png'
      const isLt2M = file.size / 1024 / 1024 < 2

      if (!isJPGOrPNG) {
        ElMessage.error(t('products.image.onlyImageAllowed'))
        return false
      }
      if (!isLt2M) {
        ElMessage.error(t('products.image.imageTooLarge'))
        return false
      }
      return true
    }

    // 加载产品数据
    const loadProducts = async () => {
      try {
        loading.value = true
        const params = {
          page: currentPage.value,
          pageSize: pageSize.value,
          name: searchForm.name,
          category: searchForm.category,
          stockStatus: searchForm.stockStatus
        }
        
        const response = await productAPI.getProducts(params)
        if (response.data.success) {
          products.value = response.data.data.products
          totalProducts.value = response.data.data.total
        }
      } catch (error) {
        console.error('加载产品数据失败:', error)
        ElMessage.error('加载产品数据失败: ' + (error.response?.data?.message || error.message))
      } finally {
        loading.value = false
      }
    }

    // 监听搜索条件变化
    watch(
      () => [searchForm.name, searchForm.category, searchForm.stockStatus],
      () => {
        // 防抖处理
        clearTimeout(searchTimeout.value)
        if (searchForm.name) {
          searchTimeout.value = setTimeout(() => {
            handleSearch()
          }, 500)
        }
      },
      { deep: true }
    )

    const searchTimeout = ref(null)

    onMounted(() => {
      loadProducts()
    })

    return {
      // 国际化
      t,
      // 数据
      defaultImage,
      loading,
      showProductDialog,
      showStockAdjustDialog,
      isEditing,
      currentPage,
      pageSize,
      totalProducts,
      productFormRef,
      searchForm,
      productForm,
      stockForm,
      productRules,
      filteredProducts,
      
      // 方法
      getCategoryLabel,
      getDiscountPrice,
      formatDate,
      showAddDialog,
      editProduct,
      resetProductForm,
      saveProduct,
      deleteProduct,
      showStockDialog,
      getStockPreview,
      adjustStock,
      handleSearch,
      resetSearch,
      handleSizeChange,
      handleCurrentChange,
      handleImageSuccess,
      handleImageError,
      clearImage,
      beforeImageUpload,
      loadProducts
    }
  }
}
</script>

<style scoped>
.products {
  padding: 0;
}

.header-section {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.title-section h1 {
  margin: 0 0 8px 0;
  font-size: 24px;
  color: #303133;
}

.title-section p {
  margin: 0;
  color: #909399;
  font-size: 14px;
}

.search-section {
  background: white;
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  margin-bottom: 20px;
}

.table-section {
  background: white;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.table-section .el-table {
  width: 100%;
}

.table-section .el-table td {
  padding: 12px 8px;
}

.table-section .el-table th {
  padding: 12px 8px;
  background-color: #fafafa;
}

.product-image {
  width: 60px;
  height: 60px;
  border-radius: 4px;
}

.no-image {
  width: 60px;
  height: 60px;
  background: #f5f7fa;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #999;
  border: 1px solid #ebeef5;
}

.no-image-text {
  font-size: 10px;
  margin-top: 2px;
}

.image-loading {
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  border-radius: 4px;
}

.image-error {
  width: 60px;
  height: 60px;
  background: #fef0f0;
  border: 1px solid #fde2e2;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #f56c6c;
}

.error-text {
  font-size: 10px;
  margin-top: 2px;
}

.product-name-container {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.product-name {
  font-weight: 500;
  color: #303133;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 280px;
}

.product-name-th {
  font-size: 12px;
  color: #909399;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 280px;
}

.price {
  font-weight: 600;
  color: #E6A23C;
  white-space: nowrap;
}

.stock-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stock-info-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.stock-number {
  font-weight: 500;
  min-width: 30px;
}

.create-time {
  white-space: nowrap;
  font-size: 13px;
  color: #606266;
}

.stock-normal {
  color: #67C23A;
  font-weight: 500;
}

.stock-low {
  color: #E6A23C;
  font-weight: 500;
}

.stock-out {
  color: #F56C6C;
  font-weight: 500;
}

.stock-tag {
  font-size: 10px;
}

.pagination-section {
  padding: 20px;
  text-align: center;
  border-top: 1px solid #EBEEF5;
}

.image-uploader {
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.image-uploader:hover {
  border-color: #409EFF;
}

.image-uploader-icon {
  font-size: 28px;
  color: #8c939d;
}

.image-preview {
  width: 120px;
  height: 120px;
  object-fit: cover;
}

.image-tips {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
}

.image-actions {
  margin-top: 8px;
  text-align: center;
}

.current-stock {
  font-size: 16px;
  font-weight: 500;
  color: #303133;
}

.stock-preview {
  font-size: 16px;
  font-weight: 500;
  color: #409EFF;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* 价格显示样式 */
.price-container {
  text-align: right;
}

.price-with-discount {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.discount-price {
  font-size: 14px;
  font-weight: 600;
  color: #F56C6C;
}

.original-price {
  font-size: 12px;
  color: #909399;
  text-decoration: line-through;
}

.discount-tag {
  font-size: 10px;
  height: 18px;
  line-height: 16px;
  padding: 0 4px;
}

.price-normal .price {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

/* 产品对话框样式优化 */
.product-dialog .el-dialog {
  margin: 0 auto;
}

.product-dialog .el-dialog__body {
  padding: 24px;
}

.dialog-content {
  /* 移除滚动条，让内容自然显示 */
}

/* 表单项间距优化 */
.product-dialog .el-form-item {
  margin-bottom: 20px;
}

.product-dialog .el-form-item:last-child {
  margin-bottom: 0;
}

/* 表单行间距 */
.product-dialog .form-row {
  margin-bottom: 20px;
}

.product-dialog .form-row:last-of-type {
  margin-bottom: 20px;
}

/* 列内间距 */
.product-dialog .el-col {
  padding-bottom: 0;
}

/* 行内表单项间距调整 */
.product-dialog .form-row .el-form-item {
  margin-bottom: 0;
}

/* 图片上传区域优化 */
.product-dialog .image-uploader {
  width: 150px;
  height: 150px;
}

.product-dialog .image-preview {
  width: 150px;
  height: 150px;
}

/* 输入框宽度优化 */
.product-dialog .el-input {
  width: 100%;
}

.product-dialog .el-select {
  width: 100%;
}

.product-dialog .el-textarea {
  width: 100%;
}

/* 数字输入框特殊处理 - 确保完整显示 */
.product-dialog .el-input-number {
  width: 100%;
}

.product-dialog .el-input-number .el-input__inner {
  text-align: left;
}

.product-dialog .el-input-number .el-input-group__append {
  padding: 0 8px;
}

/* 按钮区域优化 */
.product-dialog .el-dialog__footer {
  padding: 20px 24px;
  border-top: 1px solid #ebeef5;
  background: #fafbfc;
}

/* 操作按钮样式 */
.action-buttons {
  display: flex;
  gap: 8px;
  justify-content: center;
  align-items: center;
  white-space: nowrap;
}

.action-buttons .el-button {
  margin: 0 !important;
  min-width: 60px;
  flex-shrink: 0;
}

/* 响应式优化 */
@media (max-width: 1400px) {
  .action-buttons {
    flex-direction: column;
    gap: 4px;
  }
  
  .action-buttons .el-button {
    width: 100%;
    min-width: auto;
  }
}
</style>