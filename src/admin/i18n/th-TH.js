export default {
  // 页面标题
  title: {
    main: 'ระบบจัดการห้างสรรพสินค้า',
    login: 'เข้าสู่ระบบ - ระบบจัดการห้างสรรพสินค้า',
    dashboard: 'สถิติภาพรวม - ระบบจัดการห้างสรรพสินค้า',
    products: 'จัดการสินค้า - ระบบจัดการห้างสรรพสินค้า',
    orders: 'จัดการคำสั่งซื้อ - ระบบจัดการห้างสรรพสินค้า',
    users: 'จัดการผู้ใช้ - ระบบจัดการห้างสรรพสินค้า',
    operators: 'จัดการผู้ดำเนินการ - ระบบจัดการห้างสรรพสินค้า',
    systemConfig: 'ตั้งค่าระบบ - ระบบจัดการห้างสรรพสินค้า',
    operationLogs: 'บันทึกการดำเนินการ - ระบบจัดการห้างสรรพสินค้า'
  },

  // 通用
  common: {
    confirm: 'ยืนยัน',
    cancel: 'ยกเลิก',
    save: 'บันทึก',
    startDate: 'วันที่เริ่มต้น',
    endDate: 'วันที่สิ้นสุด',
    actions: 'การดำเนินการ',
    notSet: 'ไม่ได้ตั้งค่า',
    none: 'ไม่มี',
    updateTime: 'เวลาอัปเดต',
    close: 'ปิด',
    today: 'วันนี้',
    unknown: 'ไม่ทราบ',
    paymentMethod: 'วิธีการชำระเงิน',
    cod: 'เก็บเงินปลายทาง',
    online: 'ชำระออนไลน์',
    currency: '฿',
    currencyName: 'บาท',
    createTime: 'เวลาสร้าง',
    confirm: 'ยืนยัน',
    cancel: 'ยกเลิก',
    delete: 'ลบ',
    edit: 'แก้ไข',
    add: 'เพิ่ม',
    search: 'ค้นหา',
    reset: 'รีเซ็ต',
    submit: 'ส่ง',
    back: 'กลับ',
    loading: 'กำลังโหลด...',
    success: 'ดำเนินการสำเร็จ',
    error: 'ดำเนินการล้มเหลว',
    pleaseSelect: 'กรุณาเลือก',
    pleaseInput: 'กรุณาใส่'
  },

  // 登录相关
  login: {
    title: 'ระบบจัดการร้านค้า',
    subtitle: 'กรุณาใช้บัญชีผู้ดูแลระบบเพื่อเข้าสู่ระบบ',
    username: 'ชื่อผู้ใช้',
    password: 'รหัสผ่าน',
    usernamePlaceholder: 'กรุณาใส่ชื่อผู้ใช้ผู้ดูแลระบบ',
    passwordPlaceholder: 'กรุณาใส่รหัสผ่าน',
    rememberMe: 'จำฉันไว้',
    loginButton: 'เข้าสู่ระบบ',
    loggingIn: 'กำลังเข้าสู่ระบบ...',
    loginSuccess: 'เข้าสู่ระบบสำเร็จ!',
    loginFailed: 'เข้าสู่ระบบล้มเหลว',
    networkError: 'เกิดข้อผิดพลาดเครือข่าย กรุณาลองใหม่อีกครั้ง',
    pleaseComplete: 'กรุณากรอกข้อมูลการเข้าสู่ระบบให้ครบถ้วน',
    defaultAccount: 'บัญชีผู้ดูแลระบบเริ่มต้น',
    defaultUsername: 'ชื่อผู้ใช้:',
    defaultPassword: 'รหัสผ่าน:',
    changePasswordWarning: 'กรุณาเปลี่ยนรหัสผ่านทันทีหลังจากเข้าสู่ระบบครั้งแรก',
    copyright: '© 2024 ระบบจัดการร้านค้า สงวนลิขสิทธิ์'
  },

  // 表单验证
  validation: {
    usernameRequired: 'กรุณาใส่ชื่อผู้ใช้',
    usernameLength: 'ชื่อผู้ใช้ต้องมีความยาว 2 ถึง 50 ตัวอักษร',
    passwordRequired: 'กรุณาใส่รหัสผ่าน',
    passwordLength: 'รหัสผ่านต้องมีความยาว 6 ถึง 50 ตัวอักษร'
  },

  // 语言选择
  language: {
    chinese: '中文',
    thai: 'ไทย',
    english: 'English',
    switchLanguage: 'เปลี่ยนภาษา',
    switchSuccess: 'เปลี่ยนภาษาสำเร็จ'
  },

  // 导航菜单
  menu: {
    dashboard: 'สถิติภาพรวม',
    products: 'จัดการสินค้า',
    orders: 'จัดการคำสั่งซื้อ',
    users: 'จัดการผู้ใช้',
    operators: 'จัดการผู้ดำเนินการ',
    system: 'จัดการระบบ',
    operationLogs: 'บันทึกการดำเนินการ',
    systemConfig: 'การตั้งค่าระบบ',
    logout: 'ออกจากระบบ'
  },

  // 产品管理
  product: {
    name: 'ชื่อสินค้า',
    nameTh: 'ชื่อสินค้า (ไทย)',
    description: 'รายละเอียดสินค้า',
    descriptionTh: 'รายละเอียดสินค้า (ไทย)',
    price: 'ราคา',
    stock: 'สต็อก',
    category: 'หมวดหมู่',
    image: 'รูปภาพสินค้า',
    status: 'สถานะ',
    createTime: 'เวลาสร้าง',
    updateTime: 'เวลาอัพเดต',
    addProduct: 'เพิ่มสินค้า',
    editProduct: 'แก้ไขสินค้า',
    deleteProduct: 'ลบสินค้า',
    lowStock: 'สต็อกต่ำ',
    outOfStock: 'สินค้าหมด',
    uploadImage: 'อัพโหลดรูปภาพ'
  },

  // 订单管理
  order: {
    orderId: 'หมายเลขคำสั่งซื้อ',
    userId: 'รหัสผู้ใช้',
    userName: 'ชื่อผู้ใช้',
    totalAmount: 'จำนวนเงินรวม',
    status: 'สถานะคำสั่งซื้อ',
    createTime: 'เวลาสั่งซื้อ',
    deliveryMode: 'วิธีการจัดส่ง',
    orderItems: 'รายการสินค้า'
  },

  // 用户管理
  user: {
    username: 'ชื่อผู้ใช้',
    email: 'อีเมล',
    phone: 'หมายเลขโทรศัพท์',
    registerTime: 'เวลาลงทะเบียน',
    referralCode: 'รหัสแนะนำ',
    referredBy: 'ผู้แนะนำ'
  },

  // 操作员管理
  operator: {
    operatorName: 'ชื่อผู้ดำเนินการ',
    role: 'บทบาท',
    createTime: 'เวลาสร้าง',
    lastLogin: 'เข้าสู่ระบบล่าสุด',
    addOperator: 'เพิ่มผู้ดำเนินการ'
  },

  // 角色
  role: {
    superAdmin: 'ผู้ดูแลระบบสูงสุด',
    admin: 'ผู้ดูแลระบบ',
    operator: 'ผู้ดำเนินการ',
    unknown: 'บทบาทไม่ทราบ'
  },

  // 消息
  message: {
    logoutSuccess: 'ออกจากระบบสำเร็จ'
  },

  // 统计分析页面
  dashboard: {
    title: 'สถิติภาพรวม',
    description: 'ดูข้อมูลการดำเนินงานโดยรวมของระบบและการวิเคราะห์แนวโน้ม',
    totalOrders: 'จำนวนคำสั่งซื้อทั้งหมด',
    totalAmount: 'จำนวนเงินทั้งหมด',
    totalUsers: 'จำนวนผู้ใช้ทั้งหมด',
    activeUsers: 'ผู้ใช้งานในช่วง 7 วันที่ผ่านมา',
    orderTrend: 'แนวโน้มคำสั่งซื้อ 7 วัน',
    orderTrendSubtitle: 'การเปลี่ยนแปลงจำนวนและมูลค่าคำสั่งซื้อ',
    userTrend: 'แนวโน้มผู้ใช้ใหม่ 7 วัน',
    userTrendSubtitle: 'การเปลี่ยนแปลงจำนวนผู้ใช้ใหม่ที่ลงทะเบียน',
    noData: 'ไม่มีข้อมูล',
    refreshData: 'รีเฟรชข้อมูล',
    orderCount: 'จำนวนคำสั่งซื้อ',
    orderAmount: 'มูลค่าคำสั่งซื้อ',
    orderAmountUnit: 'มูลค่าคำสั่งซื้อ (บาท)',
    newUsers: 'ผู้ใช้ใหม่',
    loadDataFailed: 'โหลดข้อมูลล้มเหลว'
  },

  // 系统配置页面
  systemConfig: {
    title: 'การตั้งค่าระบบ',
    description: 'กำหนดค่าการตั้งค่าระบบทั่วไป เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่เข้าถึงได้',
    homeBanner: 'การตั้งค่าแบนเนอร์หน้าแรก',
    homeBannerSubtitle: 'ตั้งค่าภาพแบนเนอร์แนวนอนที่แสดงในหน้าแรกของพอร์ทัล',
    paymentQR: 'การตั้งค่า QR Code การชำระเงิน',
    paymentQRSubtitle: 'ตั้งค่า QR Code ที่แสดงเมื่อทำการชำระเงินออนไลน์',
    currentImage: 'ภาพปัจจุบัน',
    currentQR: 'QR Code ปัจจุบัน',
    uploadImage: 'อัปโหลดภาพ',
    uploadQR: 'อัปโหลด QR Code',
    replaceImage: 'เปลี่ยนภาพ',
    replaceQR: 'เปลี่ยน QR Code',
    deleteImage: 'ลบภาพ',
    deleteQR: 'ลบ QR Code',
    selectImage: 'เลือกภาพ',
    selectQR: 'เลือก QR Code',
    uploading: 'กำลังอัปโหลด...',
    refreshConfig: 'รีเฟรชการตั้งค่า',
    
    // การตั้งค่าอัตราแลกเปลี่ยน
    exchangeRate: 'การตั้งค่าอัตราแลกเปลี่ยน',
    exchangeRateSubtitle: 'กำหนดอัตราแลกเปลี่ยนสำหรับการแปลงราคาสินค้า',
    currentExchangeRate: 'อัตราแลกเปลี่ยนปัจจุบัน',
    exchangeRateValue: 'อัตราแลกเปลี่ยน',
    saveExchangeRate: 'บันทึกการตั้งค่า',
    resetExchangeRate: 'รีเซ็ต',
    exchangeRateTips: {
      range: '• อนุญาตให้ใส่ค่าที่มากกว่าหรือเท่ากับ 0 เท่านั้น',
      precision: '• รองรับทศนิยมสูงสุด 2 ตำแหน่ง',
      purpose: '• ใช้สำหรับการแปลงอัตราแลกเปลี่ยนราคาสินค้า',
      example: '• ตัวอย่าง: 1.00 หมายถึงไม่มีการแปลง, 1.50 หมายถึงคูณราคาด้วย 1.5 เท่า'
    },
    
    uploadTips: {
      bannerSize: '• ขนาดแนะนำ: 1200x300px หรือใหญ่กว่า',
      bannerFormat: '• รูปแบบที่รองรับ: JPG, PNG, GIF, WebP',
      bannerFileSize: '• ขนาดไฟล์: ไม่เกิน 5MB',
      bannerDisplay: '• ภาพจะแสดงด้านบนของแถบค้นหา มีความกว้างเท่ากับแถบค้นหาและปรับขนาดตามหน้าต่าง',
      qrSize: '• ขนาดแนะนำ: 300x300px สี่เหลี่ยมจัตุรัส',
      qrFormat: '• รูปแบบที่รองรับ: JPG, PNG',
      qrFileSize: '• ขนาดไฟล์: ไม่เกิน 5MB',
      qrDisplay: '• QR Code จะแสดงในป๊อปอัปเมื่อผู้ใช้เลือก "ชำระเงินออนไลน์"'
    },
    messages: {
      uploadSuccess: 'อัปโหลดสำเร็จ',
      uploadFailed: 'อัปโหลดล้มเหลว',
      deleteSuccess: 'ลบสำเร็จ',
      deleteFailed: 'ลบล้มเหลว',
      loadConfigFailed: 'โหลดการตั้งค่าล้มเหลว',
      confirmDelete: 'คุณแน่ใจหรือไม่ที่จะลบรายการนี้?',
      fileTooLarge: 'ขนาดไฟล์ใหญ่เกินไป',
      invalidFileFormat: 'รูปแบบไฟล์ไม่ถูกต้อง',
      exchangeRateSaveSuccess: 'บันทึกอัตราแลกเปลี่ยนสำเร็จ',
      exchangeRateSaveFailed: 'บันทึกอัตราแลกเปลี่ยนล้มเหลว',
      invalidExchangeRate: 'กรุณาใส่อัตราแลกเปลี่ยนที่ถูกต้อง (≥0, ทศนิยมสูงสุด 2 ตำแหน่ง)'
    }
  },

  // 操作员管理页面
  operators: {
    title: 'จัดการผู้ดำเนินการ',
    description: 'จัดการบัญชีผู้ดูแลระบบและผู้ดำเนินการ',
    refresh: 'รีเฟรช',
    addOperator: 'เพิ่มผู้ดำเนินการ',
    editOperator: 'แก้ไขผู้ดำเนินการ',
    deleteOperator: 'ลบผู้ดำเนินการ',
    username: 'ชื่อผู้ใช้',
    role: 'บทบาท',
    realName: 'ชื่อจริง',
    email: 'อีเมล',
    status: 'สถานะ',
    createTime: 'เวลาสร้าง',
    lastLogin: 'เข้าสู่ระบบล่าสุด',
    enabled: 'เปิดใช้งาน',
    disabled: 'ปิดใช้งาน',
    never: 'ไม่เคย',
    actions: 'การดำเนินการ',
    edit: 'แก้ไข',
    delete: 'ลบ',
    resetPassword: 'รีเซ็ตรหัสผ่าน',
    createOperator: 'สร้างผู้ดำเนินการ',
    updateOperator: 'อัปเดตผู้ดำเนินการ',
    password: 'รหัสผ่าน',
    confirmPassword: 'ยืนยันรหัสผ่าน',
    optional: 'ไม่บังคับ',
    enterUsername: 'กรุณาใส่ชื่อผู้ใช้',
    enterRealName: 'กรุณาใส่ชื่อจริง',
    enterEmail: 'กรุณาใส่อีเมล',
    enterPassword: 'กรุณาใส่รหัสผ่าน',
    enterConfirmPassword: 'กรุณายืนยันรหัสผ่าน',
    selectRole: 'กรุณาเลือกบทบาท',
    usernameLength: 'ชื่อผู้ใช้ต้องมี 2-50 ตัวอักษร',
    realNameLength: 'ชื่อจริงต้องมี 2-50 ตัวอักษร',
    emailFormat: 'รูปแบบอีเมลไม่ถูกต้อง',
    passwordLength: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร',
    passwordMismatch: 'รหัสผ่านไม่ตรงกัน',
    messages: {
      loadFailed: 'โหลดรายการล้มเหลว',
      createSuccess: 'สร้างสำเร็จ',
      createFailed: 'สร้างล้มเหลว',
      updateSuccess: 'อัปเดตสำเร็จ',
      updateFailed: 'อัปเดตล้มเหลว',
      deleteSuccess: 'ลบสำเร็จ',
      deleteFailed: 'ลบล้มเหลว',
      confirmDelete: 'คุณแน่ใจหรือไม่ที่จะลบผู้ดำเนินการนี้?',
      cannotDeleteSelf: 'ไม่สามารถลบบัญชีของตนเองได้',
      cannotDeleteSuperAdmin: 'ไม่สามารถลบผู้ดูแลระบบสูงสุดได้',
      confirmToggleStatus: 'คุณแน่ใจหรือไม่ที่จะเปลี่ยนสถานะของผู้ดำเนินการนี้?',
      toggleSuccess: 'เปลี่ยนสถานะสำเร็จ',
      toggleFailed: 'เปลี่ยนสถานะล้มเหลว',
      resetPasswordSuccess: 'รีเซ็ตรหัสผ่านสำเร็จ',
      resetPasswordFailed: 'รีเซ็ตรหัสผ่านล้มเหลว',
      operationFailed: 'การดำเนินการล้มเหลว'
    }
  },

  // 操作日志页面
  operationLogs: {
    title: 'บันทึกการดำเนินการ',
    refresh: 'รีเฟรช',
    administrator: 'ผู้ดูแลระบบ',
    allAdmins: 'ผู้ดูแลระบบทั้งหมด',
    operationType: 'ประเภทการดำเนินการ',
    allOperations: 'การดำเนินการทั้งหมด',
    resourceType: 'ประเภททรัพยากร',
    allResources: 'ทรัพยากรทั้งหมด',
    dateRange: 'ช่วงวันที่',
    selectDateRange: 'เลือกช่วงวันที่',
    id: 'ID',
    time: 'เวลา',
    admin: 'ผู้ดูแลระบบ',
    operation: 'การดำเนินการ',
    resource: 'ทรัพยากร',
    details: 'รายละเอียด',
    ipAddress: 'IP Address',
    userAgent: 'User Agent',
    actions: {
      login: 'เข้าสู่ระบบ',
      create: 'สร้าง',
      update: 'อัปเดต',
      delete: 'ลบ',
      upload: 'อัปโหลด',
      create_administrator: 'สร้างผู้ดูแลระบบ',
      update_administrator: 'อัปเดตผู้ดูแลระบบ',
      delete_administrator: 'ลบผู้ดูแลระบบ',
      reset_password: 'รีเซ็ตรหัสผ่าน',
      create_order: 'สร้างคำสั่งซื้อ',
      update_order: 'อัปเดตคำสั่งซื้อ',
      delete_order: 'ลบคำสั่งซื้อ',
      update_order_status: 'อัปเดตสถานะคำสั่งซื้อ',
      create_product: 'สร้างสินค้า',
      update_product: 'อัปเดตสินค้า',
      delete_product: 'ลบสินค้า',
      upload_product_image: 'อัปโหลดรูปภาพสินค้า',
      view: 'ดู'
    },
    resources: {
      administrator: 'ผู้ดูแลระบบ',
      order: 'คำสั่งซื้อ',
      user: 'ผู้ใช้',
      product: 'สินค้า',
      system_config: 'การตั้งค่าระบบ',
      home_banner: 'แบนเนอร์หน้าแรก',
      banner: 'แบนเนอร์',
      image: 'รูปภาพ',
      file: 'ไฟล์'
    },
    messages: {
      loadFailed: 'โหลดบันทึกล้มเหลว',
      noData: 'ไม่มีข้อมูล'
    },
    viewDetails: 'ดูรายละเอียด'
  },

  // 用户管理页面
  users: {
    title: 'จัดการผู้ใช้',
    description: 'จัดการผู้ใช้ที่ลงทะเบียนทั้งหมด รองรับการค้นหาและกรอง',
    email: 'อีเมล',
    phone: 'หมายเลขโทรศัพท์',
    referralCode: 'รหัสแนะนำ',
    enterEmail: 'กรุณาใส่อีเมล',
    enterPhone: 'กรุณาใส่หมายเลขโทรศัพท์',
    enterReferralCode: 'กรุณาใส่รหัสแนะนำ',
    search: 'ค้นหา',
    reset: 'รีเซ็ต',
    exportUsers: 'ส่งออกผู้ใช้',
    totalUsers: 'ผู้ใช้ทั้งหมด',
    activeUsers: 'ผู้ใช้ที่ใช้งานอยู่',
    newUsersToday: 'ผู้ใช้ใหม่วันนี้',
    newUsersThisWeek: 'ผู้ใช้ใหม่สัปดาห์นี้',
    newUsersThisMonth: 'ผู้ใช้ใหม่เดือนนี้',
    id: 'ID',
    nickname: 'ชื่อเล่น',
    registrationTime: 'เวลาลงทะเบียน',
    lastLogin: 'เข้าสู่ระบบล่าสุด',
    status: 'สถานะ',
    actions: 'การดำเนินการ',
    active: 'ใช้งานอยู่',
    inactive: 'ไม่ใช้งาน',
    viewDetails: 'ดูรายละเอียด',
    ban: 'ระงับ',
    unban: 'ยกเลิกระงับ',
    never: 'ไม่เคย',
    userDetails: 'รายละเอียดผู้ใช้',
    basicInfo: 'ข้อมูลพื้นฐาน',
    accountInfo: 'ข้อมูลบัญชี',
    orderStats: 'สถิติคำสั่งซื้อ',
    totalOrders: 'คำสั่งซื้อทั้งหมด',
    totalSpent: 'ใช้จ่ายทั้งหมด',
    avgOrderValue: 'มูลค่าเฉลี่ยต่อคำสั่งซื้อ',
    referralInfo: 'ข้อมูลการแนะนำ',
    referredBy: 'แนะนำโดย',
    referralCount: 'จำนวนการแนะนำ',
    messages: {
      loadFailed: 'โหลดข้อมูลผู้ใช้ล้มเหลว',
      exportFailed: 'ส่งออกข้อมูลล้มเหลว',
      exportSuccess: 'ส่งออกข้อมูลสำเร็จ',
      exporting: 'กำลังส่งออกข้อมูลผู้ใช้...',
      banSuccess: 'ระงับผู้ใช้สำเร็จ',
      banFailed: 'ระงับผู้ใช้ล้มเหลว',
      unbanSuccess: 'ยกเลิกระงับผู้ใช้สำเร็จ',
      unbanFailed: 'ยกเลิกระงับผู้ใช้ล้มเหลว',
      confirmBan: 'คุณแน่ใจหรือไม่ที่จะระงับผู้ใช้นี้?',
      confirmUnban: 'คุณแน่ใจหรือไม่ที่จะยกเลิกระงับผู้ใช้นี้?'
    }
  },

  // 订单管理页面
  orders: {
    title: 'จัดการคำสั่งซื้อ',
    description: 'จัดการข้อมูลคำสั่งซื้อทั้งหมด รองรับการค้นหาและกรอง',
    status: 'สถานะคำสั่งซื้อ',
    selectStatus: 'กรุณาเลือกสถานะ',
    search: 'ค้นหา',
    searchPlaceholder: 'หมายเลขคำสั่งซื้อ/ชื่อ/โทรศัพท์',
    startDate: 'วันที่เริ่มต้น',
    endDate: 'วันที่สิ้นสุด',
    selectStartDate: 'เลือกวันที่เริ่มต้น',
    selectEndDate: 'เลือกวันที่สิ้นสุด',
    reset: 'รีเซ็ต',
    export: 'ส่งออก',
    totalOrders: 'คำสั่งซื้อทั้งหมด',
    todayOrders: 'คำสั่งซื้อวันนี้',
    totalRevenue: 'รายได้รวม',
    avgOrderValue: 'มูลค่าเฉลี่ยต่อคำสั่งซื้อ',
    orderNumber: 'หมายเลขคำสั่งซื้อ',
    customer: 'ลูกค้า',
    amount: 'จำนวนเงิน',
    orderDate: 'วันที่สั่งซื้อ',
    actions: 'การดำเนินการ',
    viewDetails: 'ดูรายละเอียด',
    updateStatus: 'อัปเดตสถานะ',
    orderDetails: 'รายละเอียดคำสั่งซื้อ',
    customerInfo: 'ข้อมูลลูกค้า',
    orderInfo: 'ข้อมูลคำสั่งซื้อ',
    shippingInfo: 'ข้อมูลการจัดส่ง',
    productList: 'รายการสินค้า',
    productName: 'ชื่อสินค้า',
    price: 'ราคา',
    quantity: 'จำนวน',
    subtotal: 'ยอดรวมย่อย',
    orderSummary: 'สรุปคำสั่งซื้อ',
    totalAmount: 'ยอดรวมทั้งหมด',
    contactName: 'ชื่อผู้ติดต่อ',
    contactPhone: 'โทรศัพท์ติดต่อ',
    address: 'ที่อยู่',
    province: 'จังหวัด',
    city: 'เมือง',
    district: 'อำเภอ',
    detailedAddress: 'ที่อยู่รายละเอียด',
    deliveryMode: 'วิธีการจัดส่ง',
    // 订单状态
    statusOptions: {
      completed: 'เสร็จสิ้น',
      pending: 'รอดำเนินการ',
      cancelled: 'ยกเลิก',
      processing: 'กำลังดำเนินการ',
      shipped: 'จัดส่งแล้ว'
    },
    // 配送方式
    deliveryModes: {
      pickup: 'รับที่ร้าน',
      delivery: 'จัดส่งถึงบ้าน'
    },
    messages: {
      loadFailed: 'โหลดข้อมูลคำสั่งซื้อล้มเหลว',
      exportFailed: 'ส่งออกข้อมูลล้มเหลว',
      exportSuccess: 'ส่งออกข้อมูลสำเร็จ',
      exporting: 'กำลังส่งออกข้อมูลคำสั่งซื้อ...',
      statusUpdateSuccess: 'อัปเดตสถานะสำเร็จ',
      statusUpdateFailed: 'อัปเดตสถานะล้มเหลว',
      confirmStatusUpdate: 'คุณแน่ใจหรือไม่ที่จะอัปเดตสถานะคำสั่งซื้อนี้?',
      confirmDelete: 'คุณแน่ใจหรือไม่ที่จะลบคำสั่งซื้อนี้?',
      deleteSuccess: 'ลบคำสั่งซื้อสำเร็จ',
      deleteFailed: 'ลบคำสั่งซื้อล้มเหลว'
    }
  },

  // 产品管理页面
  products: {
    title: 'จัดการสินค้า',
    description: 'จัดการข้อมูลสินค้า คลังสินค้า และสถานะทั้งหมด',
    addProduct: 'เพิ่มสินค้า',
    updateProduct: 'อัปเดตสินค้า',
    searchName: 'ค้นหาชื่อสินค้า',
    selectCategory: 'เลือกหมวดหมู่',
    stockStatus: 'สถานะคลังสินค้า',
    name: 'ชื่อสินค้า',
    description: 'คำอธิบายสินค้า',
    category: 'หมวดหมู่',
    price: 'ราคา',
    stock: 'คลังสินค้า',
    status: 'สถานะ',
    actions: 'การดำเนินการ',
    edit: 'แก้ไข',
    delete: 'ลบ',
    view: 'ดู',
    adjustStock: 'ปรับปรุงคลังสินค้า',
    // 分类选项
    categories: {
      electronics: 'อิเล็กทรอนิกส์',
      clothing: 'เสื้อผ้า',
      home: 'ของใช้ในบ้าน',
      sports: 'กีฬาและกิจกรรมกลางแจ้ง',
      others: 'อื่นๆ'
    },
    // 库存状态
    stockOptions: {
      normal: 'คลังสินค้าปกติ',
      low: 'คลังสินค้าต่ำ',
      out: 'สินค้าหมด'
    },
    // 表单验证消息
    validation: {
      nameRequired: 'กรุณากรอกชื่อสินค้า',
      categoryRequired: 'กรุณาเลือกหมวดหมู่สินค้า',
      priceRequired: 'กรุณากรอกราคาสินค้า',
      stockRequired: 'กรุณากรอกจำนวนคลังสินค้า'
    },
    // 表单占位符
    placeholders: {
      enterName: 'กรุณากรอกชื่อสินค้า',
      enterDescription: 'กรุณากรอกคำอธิบายสินค้า',
      enterPrice: 'กรุณากรอกราคาสินค้า',
      enterStock: 'กรุณากรอกจำนวนคลังสินค้า'
    },
    // 消息提示
    messages: {
      addSuccess: 'เพิ่มสินค้าสำเร็จ',
      updateSuccess: 'อัปเดตสินค้าสำเร็จ',
      deleteSuccess: 'ลบสินค้าสำเร็จ',
      saveFailed: 'บันทึกสินค้าล้มเหลว',
      confirmDelete: 'คุณแน่ใจหรือไม่ที่จะลบสินค้านี้?',
      confirmAdd: 'คุณแน่ใจหรือไม่ที่จะเพิ่มสินค้านี้?',
      confirmUpdate: 'คุณแน่ใจหรือไม่ที่จะอัปเดตสินค้านี้?'
    },
    // 库存调整
    stockAdjustment: {
      title: 'ปรับปรุงคลังสินค้า',
      currentStock: 'คลังสินค้าปัจจุบัน',
      adjustType: 'วิธีการปรับปรุง',
      quantity: 'จำนวน',
      preview: 'ดูตัวอย่างผลลัพธ์',
      setTo: 'ตั้งค่าเป็น',
      increase: 'เพิ่ม',
      decrease: 'ลด',
      confirm: 'ยืนยันการปรับปรุง'
    },
    // 图片相关
    image: {
      loadFailed: 'โหลดล้มเหลว',
      clearImage: 'ลบภาพ',
      uploadTips: 'รองรับรูปแบบ JPG, PNG ขนาดไฟล์ไม่เกิน 2MB',
      productImage: 'ภาพสินค้า',
      uploadFailed: 'อัปโหลดภาพล้มเหลว',
      onlyImageAllowed: 'อนุญาตเฉพาะไฟล์ภาพเท่านั้น!',
      imageTooLarge: 'ขนาดภาพต้องไม่เกิน 2MB!'
    },
    // 折扣相关
    discount: {
      label: 'ส่วนลด',
      placeholder: 'เปอร์เซ็นต์ส่วนลด'
    }
  }
}