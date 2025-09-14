export default {
  // 页面标题
  title: {
    main: 'Mall Management System',
    login: 'Login - Mall Management System',
    dashboard: 'Dashboard - Mall Management System',
    products: 'Product Management - Mall Management System',
    orders: 'Order Management - Mall Management System',
    users: 'User Management - Mall Management System',
    operators: 'Operator Management - Mall Management System',
    systemConfig: 'System Configuration - Mall Management System',
    operationLogs: 'Operation Logs - Mall Management System'
  },

  // Common
  common: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    save: 'Save',
    startDate: 'Start Date',
    endDate: 'End Date',
    actions: 'Actions',
    notSet: 'Not Set',
    none: 'None',
    updateTime: 'Update Time',
    close: 'Close',
    today: 'Today',
    unknown: 'Unknown',
    paymentMethod: 'Payment Method',
    cod: 'Cash on Delivery',
    online: 'Online Payment',
    currency: '$',
    currencyName: 'USD',
    createTime: 'Create Time',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    search: 'Search',
    reset: 'Reset',
    submit: 'Submit',
    back: 'Back',
    loading: 'Loading...',
    success: 'Operation Successful',
    error: 'Operation Failed',
    pleaseSelect: 'Please Select',
    pleaseInput: 'Please Input'
  },

  // Login
  login: {
    title: 'Mall Management System',
    subtitle: 'Please login with administrator account',
    username: 'Username',
    password: 'Password',
    usernamePlaceholder: 'Enter admin username',
    passwordPlaceholder: 'Enter password',
    rememberMe: 'Remember Me',
    loginButton: 'Login Now',
    loggingIn: 'Logging in...',
    loginSuccess: 'Login successful!',
    loginFailed: 'Login failed',
    networkError: 'Network error, please try again later',
    pleaseComplete: 'Please complete the login information',
    defaultAccount: 'Default Admin Account',
    defaultUsername: 'Username:',
    defaultPassword: 'Password:',
    changePasswordWarning: 'Please change password immediately after first login',
    copyright: '© 2024 Mall Management System. All rights reserved.'
  },

  // Form validation
  validation: {
    usernameRequired: 'Please enter username',
    usernameLength: 'Username length should be 2 to 50 characters',
    passwordRequired: 'Please enter password',
    passwordLength: 'Password length should be 6 to 50 characters'
  },

  // Language selection
  language: {
    chinese: '中文',
    thai: 'ไทย',
    english: 'English',
    switchLanguage: 'Switch Language',
    switchSuccess: 'Language switched successfully'
  },

  // Navigation menu
  menu: {
    dashboard: 'Dashboard',
    products: 'Product Management',
    orders: 'Order Management',
    users: 'User Management',
    operators: 'Operator Management',
    system: 'System Management',
    operationLogs: 'Operation Logs',
    systemConfig: 'System Configuration',
    logout: 'Logout'
  },

  // Product management
  product: {
    name: 'Product Name',
    nameTh: 'Product Name (Thai)',
    description: 'Product Description',
    descriptionTh: 'Product Description (Thai)',
    price: 'Price',
    stock: 'Stock',
    category: 'Category',
    image: 'Product Image',
    status: 'Status',
    createTime: 'Create Time',
    updateTime: 'Update Time',
    addProduct: 'Add Product',
    editProduct: 'Edit Product',
    deleteProduct: 'Delete Product',
    lowStock: 'Low Stock',
    outOfStock: 'Out of Stock',
    uploadImage: 'Upload Image'
  },

  // Order management
  order: {
    orderId: 'Order ID',
    userId: 'User ID',
    userName: 'Username',
    totalAmount: 'Order Amount',
    status: 'Order Status',
    createTime: 'Order Time',
    deliveryMode: 'Delivery Mode',
    orderItems: 'Order Items'
  },

  // User management
  user: {
    username: 'Username',
    email: 'Email',
    phone: 'Phone',
    registerTime: 'Register Time',
    referralCode: 'Referral Code',
    referredBy: 'Referred By'
  },

  // Operator management
  operator: {
    operatorName: 'Operator Name',
    role: 'Role',
    createTime: 'Create Time',
    lastLogin: 'Last Login',
    addOperator: 'Add Operator'
  },

  // Roles
  role: {
    superAdmin: 'Super Admin',
    admin: 'Admin',
    operator: 'Operator',
    unknown: 'Unknown Role'
  },

  // Messages
  message: {
    logoutSuccess: 'Logged out successfully'
  },

  // Dashboard
  dashboard: {
    title: 'Dashboard',
    description: 'View overall system operational data and trend analysis',
    totalOrders: 'Total Orders',
    totalAmount: 'Total Amount',
    totalUsers: 'Total Users',
    activeUsers: 'Active Users (Last 7 Days)',
    orderTrend: '7-Day Order Trend',
    orderTrendSubtitle: 'Changes in order quantity and amount',
    userTrend: '7-Day User Registration Trend',
    userTrendSubtitle: 'Changes in new user registrations',
    noData: 'No Data',
    refreshData: 'Refresh Data',
    orderCount: 'Order Count',
    orderAmount: 'Order Amount',
    orderAmountUnit: 'Order Amount ($)',
    newUsers: 'New Users',
    loadDataFailed: 'Failed to load data'
  },

  // System configuration
  systemConfig: {
    title: 'System Configuration',
    description: 'Configure global system settings, accessible only to super administrators',
    homeBanner: 'Homepage Banner Configuration',
    homeBannerSubtitle: 'Set the banner image displayed on the portal homepage',
    paymentQR: 'Payment QR Code Configuration',
    paymentQRSubtitle: 'Set the QR code displayed during online payment',
    currentImage: 'Current Banner',
    currentQR: 'Current QR Code',
    uploadImage: 'Upload Banner',
    uploadQR: 'Upload QR Code',
    replaceImage: 'Replace Banner',
    replaceQR: 'Replace QR Code',
    deleteImage: 'Delete Banner',
    deleteQR: 'Delete QR Code',
    selectImage: 'Select Image',
    selectQR: 'Select QR Code',
    uploading: 'Uploading...',
    refreshConfig: 'Refresh Configuration',
    
    // Exchange Rate Configuration
    exchangeRate: 'Exchange Rate Configuration',
    exchangeRateSubtitle: 'Set the exchange rate for product price conversion',
    currentExchangeRate: 'Current Exchange Rate',
    exchangeRateValue: 'Exchange Rate',
    saveExchangeRate: 'Save Configuration',
    resetExchangeRate: 'Reset',
    exchangeRateTips: {
      range: '• Only allows input of values ≥ 0',
      precision: '• Supports up to two decimal places',
      purpose: '• Used for product price exchange rate conversion',
      example: '• Example: 1.00 means no conversion, 1.50 means multiply price by 1.5'
    },
    
    uploadTips: {
      bannerSize: '• Recommended size: 1200x300px or larger',
      bannerFormat: '• Supported formats: JPG, PNG, GIF, WebP',
      bannerFileSize: '• File size: no more than 5MB',
      bannerDisplay: '• Image will be displayed above the search bar, same width as search bar and responsive to window size',
      qrSize: '• Recommended size: 300x300px square',
      qrFormat: '• Supported formats: JPG, PNG',
      qrFileSize: '• File size: no more than 5MB',
      qrDisplay: '• QR code will be displayed in a popup when user selects "Online Payment"'
    },
    messages: {
      uploadSuccess: 'Upload successful',
      uploadFailed: 'Upload failed',
      deleteSuccess: 'Delete successful',
      deleteFailed: 'Delete failed',
      loadConfigFailed: 'Failed to load configuration',
      confirmDelete: 'Are you sure you want to delete this item?',
      fileTooLarge: 'File size exceeds limit',
      invalidFileFormat: 'Invalid file format',
      exchangeRateSaveSuccess: 'Exchange rate saved successfully',
      exchangeRateSaveFailed: 'Failed to save exchange rate',
      invalidExchangeRate: 'Please enter a valid exchange rate (≥0, up to 2 decimal places)'
    }
  },

  // Operator management
  operators: {
    title: 'Operator Management',
    description: 'Manage system administrator and operator accounts',
    refresh: 'Refresh',
    addOperator: 'Add Operator',
    editOperator: 'Edit Operator',
    deleteOperator: 'Delete Operator',
    username: 'Username',
    role: 'Role',
    realName: 'Real Name',
    email: 'Email',
    status: 'Status',
    createTime: 'Create Time',
    lastLogin: 'Last Login',
    enabled: 'Enabled',
    disabled: 'Disabled',
    never: 'Never',
    actions: 'Actions',
    edit: 'Edit',
    delete: 'Delete',
    resetPassword: 'Reset Password',
    createOperator: 'Create Operator',
    updateOperator: 'Update Operator',
    password: 'Password',
    confirmPassword: 'Confirm Password',
    optional: 'Optional',
    enterUsername: 'Please enter username',
    enterRealName: 'Please enter real name',
    enterEmail: 'Please enter email',
    enterPassword: 'Please enter password',
    enterConfirmPassword: 'Please confirm password',
    selectRole: 'Please select role',
    usernameLength: 'Username length should be 2-50 characters',
    realNameLength: 'Real name length should be 2-50 characters',
    emailFormat: 'Invalid email format',
    passwordLength: 'Password should be at least 6 characters',
    passwordMismatch: 'Passwords do not match',
    messages: {
      loadFailed: 'Failed to load list',
      createSuccess: 'Created successfully',
      createFailed: 'Creation failed',
      updateSuccess: 'Updated successfully',
      updateFailed: 'Update failed',
      deleteSuccess: 'Deleted successfully',
      deleteFailed: 'Deletion failed',
      confirmDelete: 'Are you sure you want to delete this operator?',
      cannotDeleteSelf: 'Cannot delete your own account',
      cannotDeleteSuperAdmin: 'Cannot delete super admin account',
      confirmToggleStatus: 'Are you sure you want to change this operator\'s status?',
      toggleSuccess: 'Status changed successfully',
      toggleFailed: 'Status change failed',
      resetPasswordSuccess: 'Password reset successfully',
      resetPasswordFailed: 'Password reset failed',
      operationFailed: 'Operation failed'
    }
  },

  // Operation logs
  operationLogs: {
    title: 'Operation Logs',
    refresh: 'Refresh',
    administrator: 'Administrator',
    allAdmins: 'All Administrators',
    operationType: 'Operation Type',
    allOperations: 'All Operations',
    resourceType: 'Resource Type',
    allResources: 'All Resources',
    dateRange: 'Date Range',
    selectDateRange: 'Select Date Range',
    id: 'ID',
    time: 'Time',
    admin: 'Administrator',
    operation: 'Operation',
    resource: 'Resource',
    details: 'Details',
    ipAddress: 'IP Address',
    userAgent: 'User Agent',
    actions: {
      login: 'Login',
      create: 'Create',
      update: 'Update',
      delete: 'Delete',
      upload: 'Upload',
      create_administrator: 'Create Administrator',
      update_administrator: 'Update Administrator',
      delete_administrator: 'Delete Administrator',
      reset_password: 'Reset Password',
      create_order: 'Create Order',
      update_order: 'Update Order',
      delete_order: 'Delete Order',
      update_order_status: 'Update Order Status',
      create_product: 'Create Product',
      update_product: 'Update Product',
      delete_product: 'Delete Product',
      upload_product_image: 'Upload Product Image',
      view: 'View'
    },
    resources: {
      administrator: 'Administrator',
      order: 'Order',
      user: 'User',
      product: 'Product',
      system_config: 'System Configuration',
      home_banner: 'Home Banner',
      banner: 'Banner',
      image: 'Image',
      file: 'File'
    },
    messages: {
      loadFailed: 'Failed to load logs',
      noData: 'No Data'
    },
    viewDetails: 'View Details'
  },

  // User management
  users: {
    title: 'User Management',
    description: 'Manage all registered users with search and filter support',
    email: 'Email',
    phone: 'Phone',
    countryCode: 'Country Code',
    referralCode: 'Referral Code',
    enterEmail: 'Please enter email',
    enterPhone: 'Please enter phone',
    enterReferralCode: 'Please enter referral code',
    search: 'Search',
    reset: 'Reset',
    exportUsers: 'Export Users',
    totalUsers: 'Total Users',
    activeUsers: 'Active Users',
    newUsersToday: 'New Users Today',
    newUsersThisWeek: 'New Users This Week',
    newUsersThisMonth: 'New Users This Month',
    id: 'ID',
    nickname: 'Nickname',
    registrationTime: 'Registration Time',
    lastLogin: 'Last Login',
    status: 'Status',
    actions: 'Actions',
    active: 'Active',
    inactive: 'Inactive',
    viewDetails: 'View Details',
    ban: 'Ban',
    unban: 'Unban',
    never: 'Never',
    userDetails: 'User Details',
    addresses: 'Delivery Addresses',
    noAddresses: 'No delivery addresses',
    addressCount: 'Address Count',
    contactName: 'Contact Name',
    contactPhone: 'Contact Phone',
    fullAddress: 'Full Address',
    defaultAddress: 'Default Address',
    addressType: 'Address Type',
    home: 'Home',
    office: 'Office',
    other: 'Other',
    postalCode: 'Postal Code',
    basicInfo: 'Basic Information',
    accountInfo: 'Account Information',
    orderStats: 'Order Statistics',
    totalOrders: 'Total Orders',
    totalSpent: 'Total Spent',
    avgOrderValue: 'Average Order Value',
    referralInfo: 'Referral Information',
    referredBy: 'Referred By',
    referralCount: 'Referral Count',
    messages: {
      loadFailed: 'Failed to load user data',
      exportFailed: 'Export failed',
      exportSuccess: 'Export successful',
      exporting: 'Exporting user data...',
      banSuccess: 'User banned successfully',
      banFailed: 'Failed to ban user',
      unbanSuccess: 'User unbanned successfully',
      unbanFailed: 'Failed to unban user',
      confirmBan: 'Are you sure you want to ban this user?',
      confirmUnban: 'Are you sure you want to unban this user?'
    }
  },

  // Order management
  orders: {
    title: 'Order Management',
    description: 'Manage all order information with search and filter support',
    status: 'Order Status',
    selectStatus: 'Please select status',
    search: 'Search',
    searchPlaceholder: 'Order No./Name/Phone',
    startDate: 'Start Date',
    endDate: 'End Date',
    selectStartDate: 'Select start date',
    selectEndDate: 'Select end date',
    reset: 'Reset',
    export: 'Export',
    totalOrders: 'Total Orders',
    todayOrders: 'Today\'s Orders',
    totalRevenue: 'Total Revenue',
    avgOrderValue: 'Average Order Value',
    orderNumber: 'Order Number',
    customer: 'Customer',
    amount: 'Amount',
    orderDate: 'Order Date',
    actions: 'Actions',
    viewDetails: 'View Details',
    updateStatus: 'Update Status',
    orderDetails: 'Order Details',
    customerInfo: 'Customer Information',
    orderInfo: 'Order Information',
    shippingInfo: 'Shipping Information',
    productList: 'Product List',
    productName: 'Product Name',
    price: 'Price',
    quantity: 'Quantity',
    subtotal: 'Subtotal',
    orderSummary: 'Order Summary',
    totalAmount: 'Total Amount',
    contactName: 'Contact Name',
    contactPhone: 'Contact Phone',
    address: 'Address',
    province: 'Province',
    city: 'City',
    district: 'District',
    detailedAddress: 'Detailed Address',
    deliveryMode: 'Delivery Mode',
    // Order status
    statusOptions: {
      completed: 'Completed',
      pending: 'Pending',
      cancelled: 'Cancelled',
      processing: 'Processing',
      shipped: 'Shipped'
    },
    // Delivery modes
    deliveryModes: {
      pickup: 'Store Pickup',
      delivery: 'Home Delivery'
    },
    messages: {
      loadFailed: 'Failed to load order data',
      exportFailed: 'Export failed',
      exportSuccess: 'Export successful',
      exporting: 'Exporting order data...',
      statusUpdateSuccess: 'Status updated successfully',
      statusUpdateFailed: 'Status update failed',
      confirmStatusUpdate: 'Are you sure you want to update this order status?',
      confirmDelete: 'Are you sure you want to delete this order?',
      deleteSuccess: 'Order deleted successfully',
      deleteFailed: 'Order deletion failed'
    }
  },

  // Product management
  products: {
    title: 'Product Management',
    description: 'Manage all product information, inventory and status',
    addProduct: 'Add Product',
    updateProduct: 'Update Product',
    searchName: 'Search product name',
    selectCategory: 'Select category',
    stockStatus: 'Stock Status',
    name: 'Product Name',
    description: 'Product Description',
    category: 'Category',
    price: 'Price',
    stock: 'Stock',
    status: 'Status',
    actions: 'Actions',
    edit: 'Edit',
    delete: 'Delete',
    view: 'View',
    adjustStock: 'Adjust Stock',
    // Category options
    categories: {
      electronics: 'Electronics',
      clothing: 'Clothing',
      home: 'Home & Garden',
      sports: 'Sports & Outdoors',
      others: 'Others'
    },
    // Stock status
    stockOptions: {
      normal: 'Normal Stock',
      low: 'Low Stock',
      out: 'Out of Stock'
    },
    // Form validation messages
    validation: {
      nameRequired: 'Please enter product name',
      categoryRequired: 'Please select product category',
      priceRequired: 'Please enter product price',
      stockRequired: 'Please enter stock quantity'
    },
    // Form placeholders
    placeholders: {
      enterName: 'Please enter product name',
      enterDescription: 'Please enter product description',
      enterPrice: 'Please enter product price',
      enterStock: 'Please enter stock quantity'
    },
    // Messages
    messages: {
      addSuccess: 'Product added successfully',
      updateSuccess: 'Product updated successfully',
      deleteSuccess: 'Product deleted successfully',
      saveFailed: 'Failed to save product',
      confirmDelete: 'Are you sure you want to delete this product?',
      confirmAdd: 'Are you sure you want to add this product?',
      confirmUpdate: 'Are you sure you want to update this product?'
    },
    // Stock adjustment
    stockAdjustment: {
      title: 'Adjust Stock',
      currentStock: 'Current Stock',
      adjustType: 'Adjustment Type',
      quantity: 'Quantity',
      preview: 'Preview Result',
      setTo: 'Set To',
      increase: 'Increase',
      decrease: 'Decrease',
      confirm: 'Confirm Adjustment'
    },
    // Image related
    image: {
      loadFailed: 'Load Failed',
      clearImage: 'Clear Image',
      uploadTips: 'Support JPG, PNG formats, file size no more than 2MB',
      productImage: 'Product Image',
      uploadFailed: 'Image upload failed',
      onlyImageAllowed: 'Only image files are allowed!',
      imageTooLarge: 'Image size cannot exceed 2MB!'
    },
    // Discount related
    discount: {
      label: 'Discount',
      placeholder: 'Discount percentage'
    }
  }
}
