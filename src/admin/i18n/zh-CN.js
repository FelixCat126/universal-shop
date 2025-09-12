export default {
  // 页面标题
  title: {
    main: '商城管理系统',
    login: '登录 - 商城管理系统',
    dashboard: '统计总览 - 商城管理系统',
    products: '产品管理 - 商城管理系统',
    orders: '订单管理 - 商城管理系统',
    users: '用户管理 - 商城管理系统',
    operators: '操作员管理 - 商城管理系统',
    systemConfig: '系统配置 - 商城管理系统',
    operationLogs: '操作日志 - 商城管理系统'
  },

  // 通用
  common: {
    confirm: '确认',
    cancel: '取消',
    save: '保存',
    startDate: '开始日期',
    endDate: '结束日期',
    actions: '操作',
    notSet: '未设置',
    none: '无',
    updateTime: '更新时间',
    close: '关闭',
    today: '今天',
    unknown: '未知',
    paymentMethod: '支付方式',
    cod: '货到付款',
    online: '在线付款',
    currency: '¥',
    currencyName: '人民币',
    createTime: '创建时间',
    confirm: '确认',
    cancel: '取消',
    delete: '删除',
    edit: '编辑',
    add: '添加',
    search: '搜索',
    reset: '重置',
    submit: '提交',
    back: '返回',
    loading: '加载中...',
    success: '操作成功',
    error: '操作失败',
    pleaseSelect: '请选择',
    pleaseInput: '请输入'
  },

  // 登录相关
  login: {
    title: '商城管理系统',
    subtitle: '请使用管理员账户登录',
    username: '用户名',
    password: '密码',
    usernamePlaceholder: '请输入管理员用户名',
    passwordPlaceholder: '请输入密码',
    rememberMe: '记住我',
    loginButton: '立即登录',
    loggingIn: '登录中...',
    loginSuccess: '登录成功！',
    loginFailed: '登录失败',
    networkError: '网络错误，请稍后重试',
    pleaseComplete: '请完善登录信息',
    defaultAccount: '默认管理员账户',
    defaultUsername: '用户名:',
    defaultPassword: '密码:',
    changePasswordWarning: '首次登录后请立即修改密码',
    copyright: '© 2024 商城管理系统. All rights reserved.'
  },

  // 表单验证
  validation: {
    usernameRequired: '请输入用户名',
    usernameLength: '用户名长度在 2 到 50 个字符',
    passwordRequired: '请输入密码',
    passwordLength: '密码长度在 6 到 50 个字符'
  },

  // 语言选择
  language: {
    chinese: '中文',
    thai: 'ไทย',
    english: 'English',
    switchLanguage: '切换语言',
    switchSuccess: '语言切换成功'
  },

  // 导航菜单
  menu: {
    dashboard: '统计总览',
    products: '产品管理',
    orders: '订单管理',
    users: '用户管理',
    operators: '操作员管理',
    system: '系统管理',
    operationLogs: '操作日志',
    systemConfig: '系统配置',
    logout: '退出登录'
  },

  // 产品管理
  product: {
    name: '产品名称',
    nameTh: '产品名称(泰文)',
    description: '产品描述',
    descriptionTh: '产品描述(泰文)',
    price: '价格',
    stock: '库存',
    category: '分类',
    image: '产品图片',
    status: '状态',
    createTime: '创建时间',
    updateTime: '更新时间',
    addProduct: '添加产品',
    editProduct: '编辑产品',
    deleteProduct: '删除产品',
    lowStock: '库存不足',
    outOfStock: '缺货',
    uploadImage: '上传图片'
  },

  // 订单管理
  order: {
    orderId: '订单号',
    userId: '用户ID',
    userName: '用户名',
    totalAmount: '订单金额',
    status: '订单状态',
    createTime: '下单时间',
    deliveryMode: '配送方式',
    orderItems: '订单商品'
  },

  // 用户管理
  user: {
    username: '用户名',
    email: '邮箱',
    phone: '手机号',
    registerTime: '注册时间',
    referralCode: '推荐码',
    referredBy: '推荐人'
  },

  // 操作员管理
  operator: {
    operatorName: '操作员名称',
    role: '角色',
    createTime: '创建时间',
    lastLogin: '最后登录',
    addOperator: '添加操作员'
  },

  // 角色
  role: {
    superAdmin: '超级管理员',
    admin: '管理员',
    operator: '操作员',
    unknown: '未知角色'
  },

  // 消息
  message: {
    logoutSuccess: '已退出登录'
  },

  // 统计分析页面
  dashboard: {
    title: '统计总览',
    description: '查看系统整体运营数据和趋势分析',
    totalOrders: '总订单数',
    totalAmount: '总金额数',
    totalUsers: '总用户数',
    activeUsers: '近七天活跃用户',
    orderTrend: '七天订单趋势',
    orderTrendSubtitle: '订单数量和金额变化',
    userTrend: '七天注册用户趋势',
    userTrendSubtitle: '新用户注册数量变化',
    noData: '暂无数据',
    refreshData: '刷新数据',
    orderCount: '订单数量',
    orderAmount: '订单金额',
    orderAmountUnit: '订单金额 (¥)',
    newUsers: '新用户',
    loadDataFailed: '加载数据失败'
  },

  // 系统配置页面
  systemConfig: {
    title: '系统配置',
    description: '配置系统全局设置，仅超级管理员可访问',
    homeBanner: '首页长图配置',
    homeBannerSubtitle: '设置门户端商城首页显示的长图',
    paymentQR: '支付二维码配置',
    paymentQRSubtitle: '设置在线支付时显示的二维码',
    currentImage: '当前长图',
    currentQR: '当前二维码',
    uploadImage: '上传长图',
    uploadQR: '上传二维码',
    replaceImage: '更换长图',
    replaceQR: '更换二维码',
    deleteImage: '删除长图',
    deleteQR: '删除二维码',
    selectImage: '选择图片',
    selectQR: '选择二维码',
    uploading: '上传中...',
    refreshConfig: '刷新配置',
    
    // 汇算比例配置
    exchangeRate: '汇算比例配置',
    exchangeRateSubtitle: '设置商品价格的汇率换算比例',
    currentExchangeRate: '当前汇算比例',
    exchangeRateValue: '汇算比例',
    saveExchangeRate: '保存配置',
    resetExchangeRate: '重置',
    exchangeRateTips: {
      range: '• 仅允许输入不小于0的数值',
      precision: '• 支持最多两位小数',
      purpose: '• 用于商品价格汇率换算',
      example: '• 例如：1.00 表示无汇率转换，1.50 表示价格乘以1.5倍'
    },
    
    uploadTips: {
      bannerSize: '• 建议尺寸：1200x300px 或更大',
      bannerFormat: '• 支持格式：JPG、PNG、GIF、WebP',
      bannerFileSize: '• 文件大小：不超过5MB',
      bannerDisplay: '• 图片将显示在搜索栏上方，与搜索栏同宽并自适应窗口大小',
      qrSize: '• 建议尺寸：300x300px 正方形',
      qrFormat: '• 支持格式：JPG、PNG',
      qrFileSize: '• 文件大小：不超过5MB',
      qrDisplay: '• 二维码将在用户选择"在线付款"时弹窗显示'
    },
    messages: {
      uploadSuccess: '上传成功',
      uploadFailed: '上传失败',
      deleteSuccess: '删除成功',
      deleteFailed: '删除失败',
      loadConfigFailed: '加载配置失败',
      confirmDelete: '确定要删除此项吗？',
      fileTooLarge: '文件大小超出限制',
      invalidFileFormat: '文件格式不正确',
      exchangeRateSaveSuccess: '汇算比例保存成功',
      exchangeRateSaveFailed: '汇算比例保存失败',
      invalidExchangeRate: '请输入有效的汇算比例（≥0，最多两位小数）'
    }
  },

  // 操作员管理页面
  operators: {
    title: '操作员管理',
    description: '管理系统管理员和操作员账户',
    refresh: '刷新',
    addOperator: '新增操作员',
    editOperator: '编辑操作员',
    deleteOperator: '删除操作员',
    username: '用户名',
    role: '角色',
    realName: '姓名',
    email: '邮箱',
    status: '状态',
    createTime: '创建时间',
    lastLogin: '最后登录',
    enabled: '启用',
    disabled: '禁用',
    never: '从未',
    actions: '操作',
    edit: '编辑',
    delete: '删除',
    resetPassword: '重置密码',
    createOperator: '创建操作员',
    updateOperator: '更新操作员',
    password: '密码',
    confirmPassword: '确认密码',
    optional: '选填',
    enterUsername: '请输入用户名',
    enterRealName: '请输入姓名',
    enterEmail: '请输入邮箱',
    enterPassword: '请输入密码',
    enterConfirmPassword: '请确认密码',
    selectRole: '请选择角色',
    usernameLength: '用户名长度为2-50个字符',
    realNameLength: '姓名长度为2-50个字符',
    emailFormat: '邮箱格式不正确',
    passwordLength: '密码至少6个字符',
    passwordMismatch: '两次密码不一致',
    messages: {
      loadFailed: '加载列表失败',
      createSuccess: '创建成功',
      createFailed: '创建失败',
      updateSuccess: '更新成功',
      updateFailed: '更新失败',
      deleteSuccess: '删除成功',
      deleteFailed: '删除失败',
      confirmDelete: '确定要删除此操作员吗？',
      cannotDeleteSelf: '不能删除自己的账户',
      cannotDeleteSuperAdmin: '不能删除超级管理员账户',
      confirmToggleStatus: '确定要更改此操作员的状态吗？',
      toggleSuccess: '状态更改成功',
      toggleFailed: '状态更改失败',
      resetPasswordSuccess: '密码重置成功',
      resetPasswordFailed: '密码重置失败',
      operationFailed: '操作失败'
    }
  },

  // 操作日志页面
  operationLogs: {
    title: '操作日志',
    refresh: '刷新',
    administrator: '管理员',
    allAdmins: '全部管理员',
    operationType: '操作类型',
    allOperations: '全部操作',
    resourceType: '资源类型',
    allResources: '全部资源',
    dateRange: '日期范围',
    selectDateRange: '选择日期范围',
    id: 'ID',
    time: '时间',
    admin: '管理员',
    operation: '操作',
    resource: '资源',
    details: '详情',
    ipAddress: 'IP地址',
    userAgent: '用户代理',
    actions: {
      login: '登录',
      create: '创建',
      update: '更新',
      delete: '删除',
      upload: '上传',
      create_administrator: '创建管理员',
      update_administrator: '更新管理员',
      delete_administrator: '删除管理员',
      reset_password: '重置密码',
      create_order: '创建订单',
      update_order: '更新订单',
      delete_order: '删除订单',
      update_order_status: '更新订单状态',
      create_product: '创建商品',
      update_product: '更新商品',
      delete_product: '删除商品',
      upload_product_image: '上传商品图片',
      view: '查看'
    },
    resources: {
      administrator: '管理员',
      order: '订单',
      user: '用户',
      product: '商品',
      system_config: '系统配置',
      home_banner: '首页横幅',
      banner: '横幅',
      image: '图片',
      file: '文件'
    },
    messages: {
      loadFailed: '加载日志失败',
      noData: '暂无数据'
    },
    viewDetails: '查看详情'
  },

  // 用户管理页面
  users: {
    title: '用户管理',
    description: '管理所有注册用户，支持搜索和筛选',
    email: '邮箱',
    phone: '手机号',
    countryCode: '国家区号',
    referralCode: '推荐码',
    enterEmail: '请输入邮箱',
    enterPhone: '请输入手机号',
    enterReferralCode: '请输入推荐码',
    search: '搜索',
    reset: '重置',
    exportUsers: '导出用户',
    totalUsers: '总用户数',
    activeUsers: '活跃用户',
    newUsersToday: '今日新用户',
    newUsersThisWeek: '本周新用户',
    newUsersThisMonth: '本月新用户',
    id: 'ID',
    nickname: '昵称',
    registrationTime: '注册时间',
    lastLogin: '最后登录',
    status: '状态',
    actions: '操作',
    active: '活跃',
    inactive: '非活跃',
    viewDetails: '查看详情',
    ban: '封禁',
    unban: '解封',
    never: '从未',
    userDetails: '用户详情',
    basicInfo: '基本信息',
    accountInfo: '账户信息',
    orderStats: '订单统计',
    totalOrders: '总订单数',
    totalSpent: '总消费',
    avgOrderValue: '平均订单价值',
    referralInfo: '推荐信息',
    referredBy: '推荐人',
    referralCount: '推荐人数',
    messages: {
      loadFailed: '加载用户数据失败',
      exportFailed: '导出数据失败',
      exportSuccess: '导出数据成功',
      exporting: '正在导出用户数据...',
      banSuccess: '封禁用户成功',
      banFailed: '封禁用户失败',
      unbanSuccess: '解封用户成功',
      unbanFailed: '解封用户失败',
      confirmBan: '确定要封禁此用户吗？',
      confirmUnban: '确定要解封此用户吗？'
    }
  },

  // 订单管理页面
  orders: {
    title: '订单管理',
    description: '管理所有订单信息，支持搜索和筛选',
    status: '订单状态',
    selectStatus: '请选择状态',
    search: '搜索',
    searchPlaceholder: '订单号/姓名/电话',
    startDate: '开始日期',
    endDate: '结束日期',
    selectStartDate: '选择开始日期',
    selectEndDate: '选择结束日期',
    reset: '重置',
    export: '导出',
    totalOrders: '总订单数',
    todayOrders: '今日订单',
    totalRevenue: '总营收',
    avgOrderValue: '平均订单价值',
    orderNumber: '订单号',
    customer: '客户',
    amount: '金额',
    orderDate: '下单日期',
    actions: '操作',
    viewDetails: '查看详情',
    updateStatus: '更新状态',
    orderDetails: '订单详情',
    customerInfo: '客户信息',
    orderInfo: '订单信息',
    shippingInfo: '配送信息',
    productList: '商品列表',
    productName: '商品名称',
    price: '价格',
    quantity: '数量',
    subtotal: '小计',
    orderSummary: '订单汇总',
    totalAmount: '总金额',
    contactName: '联系人',
    contactPhone: '联系电话',
    address: '地址',
    province: '省份',
    city: '城市',
    district: '区县',
    detailedAddress: '详细地址',
    deliveryMode: '配送方式',
    // 订单状态
    statusOptions: {
      completed: '已完成',
      pending: '待处理',
      cancelled: '已取消',
      processing: '处理中',
      shipped: '已发货'
    },
    // 配送方式
    deliveryModes: {
      pickup: '到店自取',
      delivery: '配送到家'
    },
    messages: {
      loadFailed: '加载订单数据失败',
      exportFailed: '导出数据失败',
      exportSuccess: '导出数据成功',
      exporting: '正在导出订单数据...',
      statusUpdateSuccess: '状态更新成功',
      statusUpdateFailed: '状态更新失败',
      confirmStatusUpdate: '确定要更新此订单状态吗？',
      confirmDelete: '确定要删除此订单吗？',
      deleteSuccess: '订单删除成功',
      deleteFailed: '订单删除失败'
    }
  },

  // 产品管理页面
  products: {
    title: '产品管理',
    description: '管理所有产品信息、库存和状态',
    addProduct: '添加产品',
    updateProduct: '更新产品',
    searchName: '搜索产品名称',
    selectCategory: '选择分类',
    stockStatus: '库存状态',
    name: '产品名称',
    description: '产品描述',
    category: '分类',
    price: '价格',
    stock: '库存',
    status: '状态',
    actions: '操作',
    edit: '编辑',
    delete: '删除',
    view: '查看',
    adjustStock: '调整库存',
    // 分类选项
    categories: {
      electronics: '电子产品',
      clothing: '服装',
      home: '家居用品',
      sports: '运动户外',
      others: '其他'
    },
    // 库存状态
    stockOptions: {
      normal: '正常库存',
      low: '库存不足',
      out: '缺货'
    },
    // 表单验证消息
    validation: {
      nameRequired: '请输入产品名称',
      categoryRequired: '请选择产品分类',
      priceRequired: '请输入产品价格',
      stockRequired: '请输入库存数量'
    },
    // 表单占位符
    placeholders: {
      enterName: '请输入产品名称',
      enterDescription: '请输入产品描述',
      enterPrice: '请输入产品价格',
      enterStock: '请输入库存数量'
    },
    // 消息提示
    messages: {
      addSuccess: '产品添加成功',
      updateSuccess: '产品更新成功',
      deleteSuccess: '产品删除成功',
      saveFailed: '保存产品失败',
      confirmDelete: '确定要删除此产品吗？',
      confirmAdd: '确定要添加这个产品吗？',
      confirmUpdate: '确定要更新这个产品吗？'
    },
    // 库存调整
    stockAdjustment: {
      title: '调整库存',
      currentStock: '当前库存',
      adjustType: '调整方式',
      quantity: '数量',
      preview: '预览结果',
      setTo: '设置为',
      increase: '增加',
      decrease: '减少',
      confirm: '确认调整'
    },
    // 图片相关
    image: {
      loadFailed: '加载失败',
      clearImage: '清除图片',
      uploadTips: '支持 JPG、PNG 格式，文件大小不超过 2MB',
      productImage: '产品图片',
      uploadFailed: '图片上传失败',
      onlyImageAllowed: '只能上传图片文件!',
      imageTooLarge: '图片大小不能超过 2MB!'
    },
    // 折扣相关
    discount: {
      label: '折扣',
      placeholder: '折扣百分比'
    }
  }
}