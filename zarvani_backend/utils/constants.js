
// ============= utils/constants.js =============
module.exports = {
  ROLES: {
    USER: 'user',
    PROVIDER: 'provider',
    SHOP: 'shop',
    ADMIN: 'admin',
    SUPER_ADMIN: 'superadmin'
  },
  
  BOOKING_STATUS: {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    ON_THE_WAY: 'on-the-way',
    IN_PROGRESS: 'in-progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    REJECTED: 'rejected'
  },
  
  PAYMENT_STATUS: {
    PENDING: 'pending',
    SUCCESS: 'success',
    FAILED: 'failed',
    REFUNDED: 'refunded'
  },
  
  PAYMENT_METHOD: {
    CASH: 'cash',
    UPI: 'upi',
    CARD: 'card',
    NETBANKING: 'netbanking',
    WALLET: 'wallet'
  },
  
  VERIFICATION_STATUS: {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected'
  },
  
  SERVICE_CATEGORIES: [
    'Home',
    'Beauty',
    'Wellness',
    'Professional',
    'Repair',
    'Cleaning',
    'Other'
  ],
  
  NOTIFICATION_TYPES: {
    BOOKING: 'booking',
    PAYMENT: 'payment',
    PROMOTION: 'promotion',
    REMINDER: 'reminder',
    REVIEW: 'review',
    ALERT: 'alert'
  },
  
  ORDER_STATUS: {
    PENDING: 'pending',
    PACKED: 'packed',
    DISPATCHED: 'dispatched',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled'
  },
  
  DEFAULT_PAGINATION: {
    PAGE: 1,
    LIMIT: 10,
    MAX_LIMIT: 100
  },
  
  OTP_EXPIRY_MINUTES: 10,
  OTP_MAX_ATTEMPTS: 5,
  
  COMMISSION_RATES: {
    SERVICE: 15, // 15% commission on services
    PRODUCT: 10  // 10% commission on products
  },
  
  CANCELLATION_CHARGES: {
    BEFORE_24_HOURS: 0,
    BEFORE_12_HOURS: 25,
    BEFORE_6_HOURS: 50,
    LESS_THAN_6_HOURS: 100
  },
  
  SEARCH_RADIUS_KM: 10,
  
  FILE_SIZE_LIMITS: {
    PROFILE_IMAGE: 5 * 1024 * 1024, // 5MB
    DOCUMENT: 10 * 1024 * 1024, // 10MB
    PRODUCT_IMAGE: 5 * 1024 * 1024 // 5MB
  },
  
  ALLOWED_FILE_TYPES: {
    IMAGE: ['image/jpeg', 'image/jpg', 'image/png'],
    DOCUMENT: ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']
  },
  
  TOKEN_TYPES: {
    ACCESS: 'access',
    REFRESH: 'refresh',
    RESET_PASSWORD: 'reset_password'
  }
};