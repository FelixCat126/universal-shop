import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../api/index.js'
import { useUserStore } from './user.js'

export const useCartStore = defineStore('cart', () => {
  // 状态
  const items = ref([])
  const isLoading = ref(false)

  // 计算属性
  const itemCount = computed(() => {
    return items.value.reduce((total, item) => total + item.quantity, 0)
  })

  const totalAmount = computed(() => {
    return items.value.reduce((total, item) => {
      return total + (item.price * item.quantity)
    }, 0)
  })

  const isEmpty = computed(() => items.value.length === 0)

  // 计算商品实际价格（考虑折扣）
  const getActualPrice = (product) => {
    if (!product.discount || product.discount <= 0) {
      return product.price
    }
    const discountPrice = product.price * (1 - product.discount / 100)
    return parseFloat(discountPrice.toFixed(2))
  }

  // 加载购物车
  const loadCart = async () => {
    try {
      isLoading.value = true
      const userStore = useUserStore()
      
      if (userStore.isLoggedIn) {
        // 已登录用户：从服务器加载购物车
        const response = await api.get('/cart')
        
        if (response.data.success) {
          // 重新计算价格以确保使用最新的折扣价格
          items.value = response.data.data.map(item => ({
            ...item,
            price: getActualPrice(item.product)
          }))
        } else {
          console.error('加载购物车失败:', response.data.message)
          items.value = []
        }
      } else {
        // 游客用户：从localStorage加载购物车
        const guestCart = localStorage.getItem('guest_cart')
        if (guestCart) {
          try {
            const guestItems = JSON.parse(guestCart)
            // 重新计算价格以确保使用最新的折扣价格
            items.value = guestItems.map(item => ({
              ...item,
              price: getActualPrice(item.product)
            }))
            // 保存更新后的价格
            saveGuestCart()
          } catch (e) {
            console.error('解析游客购物车失败:', e)
            items.value = []
            localStorage.removeItem('guest_cart')
          }
        } else {
          items.value = []
        }
      }
    } catch (error) {
      console.error('Load cart error:', error)
      items.value = []
    } finally {
      isLoading.value = false
    }
  }

  // 添加商品到购物车
  const addToCart = async (product, quantity = 1) => {
    try {
      isLoading.value = true
      const userStore = useUserStore()
      
      // 检查是否已存在该商品
      const existingItem = items.value.find(item => item.product_id === product.id)
      
      if (existingItem) {
        // 如果存在，更新数量
        const result = await updateQuantity(existingItem.id || existingItem.product_id, existingItem.quantity + quantity)
        return result
      } else {
        if (userStore.isLoggedIn) {
          // 已登录用户：调用API添加到服务器购物车
          const response = await api.post('/cart', {
            product_id: product.id,
            quantity
          })
          
          if (response.data.success) {
            const newItem = {
              id: response.data.data.id,
              product_id: product.id,
              product: product,
              quantity,
              price: getActualPrice(product)
            }
            items.value.push(newItem)
            return { success: true, message: 'addSuccess' }
          } else {
            return { success: false, message: 'addFailed' }
          }
        } else {
          // 游客用户：添加到localStorage
          const newItem = {
            id: `guest_${Date.now()}_${product.id}`, // 游客商品使用临时ID
            product_id: product.id,
            product: product,
            quantity,
            price: getActualPrice(product)
          }
          items.value.push(newItem)
          saveGuestCart()
          return { success: true, message: 'addSuccess' }
        }
      }
    } catch (error) {
      console.error('Add to cart error:', error)
      return { 
        success: false, 
        message: 'addFailed' 
      }
    } finally {
      isLoading.value = false
    }
  }

  // 更新商品数量
  const updateQuantity = async (itemId, newQuantity) => {
    try {
      if (newQuantity <= 0) {
        return await removeFromCart(itemId)
      }

      const userStore = useUserStore()
      const itemIndex = items.value.findIndex(item => item.id === itemId)
      
      if (itemIndex === -1) {
        return { success: false, message: 'itemNotFound' }
      }

      if (userStore.isLoggedIn && !itemId.toString().startsWith('guest_')) {
        // 已登录用户：调用API更新服务器购物车
        const response = await api.put(`/cart/${itemId}`, {
          quantity: newQuantity
        })
        
        if (response.data.success) {
          items.value[itemIndex].quantity = newQuantity
          return { success: true, message: 'updateSuccess' }
        } else {
          return { success: false, message: 'updateFailed' }
        }
      } else {
        // 游客用户：直接更新localStorage
        items.value[itemIndex].quantity = newQuantity
        saveGuestCart()
        return { success: true, message: 'updateSuccess' }
      }
    } catch (error) {
      console.error('Update quantity error:', error)
      return { 
        success: false, 
        message: 'updateFailed' 
      }
    }
  }

  // 从购物车移除商品
  const removeFromCart = async (itemId) => {
    try {
      const userStore = useUserStore()
      const itemIndex = items.value.findIndex(item => item.id === itemId)
      
      if (itemIndex === -1) {
        return { success: false, message: 'itemNotFound' }
      }

      if (userStore.isLoggedIn && !itemId.toString().startsWith('guest_')) {
        // 已登录用户：调用API从服务器购物车移除
        const response = await api.delete(`/cart/${itemId}`)
        
        if (response.data.success) {
          items.value.splice(itemIndex, 1)
          return { success: true, message: 'removeSuccess' }
        } else {
          return { success: false, message: 'removeFailed' }
        }
      } else {
        // 游客用户：直接从localStorage移除
        items.value.splice(itemIndex, 1)
        saveGuestCart()
        return { success: true, message: '商品已移除' }
      }
    } catch (error) {
      console.error('Remove from cart error:', error)
      return { 
        success: false, 
        message: 'removeFailed' 
      }
    }
  }

  // 清空购物车
  const clearCart = async () => {
    try {
      isLoading.value = true
      const userStore = useUserStore()
      
      if (userStore.isLoggedIn) {
        // 已登录用户：调用API清空服务器购物车
        const response = await api.delete('/cart')
        
        if (response.data.success) {
          items.value = []
          return { success: true, message: 'clearSuccess' }
        } else {
          return { success: false, message: 'clearFailed' }
        }
      } else {
        // 游客用户：清空localStorage
        items.value = []
        clearGuestCart()
        return { success: true, message: 'clearSuccess' }
      }
    } catch (error) {
      console.error('Clear cart error:', error)
      return { 
        success: false, 
        message: 'clearFailed' 
      }
    } finally {
      isLoading.value = false
    }
  }

  // 检查商品库存
  const checkStock = async () => {
    try {
      const productIds = items.value.map(item => item.product_id)
      const response = await api.post('/products/check-stock', { productIds })
      
      if (response.data.success) {
        const stockInfo = response.data.data
        
        // 更新购物车中商品的库存信息
        items.value.forEach(item => {
          const stock = stockInfo.find(s => s.id === item.product_id)
          if (stock) {
            item.product.stock = stock.stock
            // 如果库存不足，调整数量
            if (item.quantity > stock.stock) {
              item.quantity = stock.stock
            }
          }
        })
        
        // 移除没有库存的商品
        items.value = items.value.filter(item => item.product.stock > 0)
      }
      
      return { success: true }
    } catch (error) {
      console.error('Check stock error:', error)
      return { success: false, message: '库存检查失败' }
    }
  }

  // 获取商品在购物车中的数量
  const getItemQuantity = (productId) => {
    const item = items.value.find(item => item.product_id === productId)
    return item ? item.quantity : 0
  }

  // 检查商品是否在购物车中
  const isInCart = (productId) => {
    return items.value.some(item => item.product_id === productId)
  }

  // 保存游客购物车到localStorage
  const saveGuestCart = () => {
    try {
      localStorage.setItem('guest_cart', JSON.stringify(items.value))
    } catch (error) {
      console.error('保存游客购物车失败:', error)
    }
  }

  // 清空游客购物车
  const clearGuestCart = () => {
    localStorage.removeItem('guest_cart')
  }

  return {
    // 状态
    items,
    isLoading,
    
    // 计算属性
    itemCount,
    totalAmount,
    isEmpty,
    
    // 方法
    loadCart,
    addToCart,
    updateQuantity,
    removeFromCart,
    clearCart,
    checkStock,
    getItemQuantity,
    isInCart,
    saveGuestCart,
    clearGuestCart
  }
})