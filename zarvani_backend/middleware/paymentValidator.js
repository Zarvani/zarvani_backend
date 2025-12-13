const Joi = require('joi');
const ResponseHandler = require('../utils/responseHandler');

const paymentSchemas = {
  // Create QR Payment
 createQR: Joi.object({
  bookingId: Joi.string()
    .hex()
    .length(24)
    .allow(null, '')
    .empty(['', null])
    .optional(),

  orderId: Joi.string()
    .hex()
    .length(24)
    .allow(null, '')
    .empty(['', null])
    .optional(),

  amount: Joi.number().positive().required(),

  paymentDestination: Joi.string()
    .valid('company_account', 'personal_account')
    .default('company_account'),

  providerId: Joi.string()
    .hex()
    .length(24)
    .allow(null, '')
    .empty(['', null])
    .optional(),

  shopId: Joi.string()
    .hex()
    .length(24)
    .allow(null, '')
    .empty(['', null])
    .optional(),
})
.xor('bookingId', 'orderId')  // EXACTLY one required
.messages({
  'object.xor': 'Send ONLY bookingId (service) OR ONLY orderId (shop)'
}),  
  // Collection QR
  collectionQR: Joi.object({
    paymentId: Joi.string().hex().length(24).required(),
    destination: Joi.string().valid('company_account', 'personal_account').required()
  }),
  
  // Razorpay Order
  createRazorpayOrder: Joi.object({
  bookingId: Joi.string()
    .hex()
    .length(24)
    .allow(null, '')
    .empty(['', null])
    .optional(),

  orderId: Joi.string()
    .hex()
    .length(24)
    .allow(null, '')
    .empty(['', null])
    .optional(),

  amount: Joi.number().positive().required(),

  paymentDestination: Joi.string()
    .valid('company_account', 'personal_account')
    .default('company_account'),

  providerId: Joi.string()
    .hex()
    .length(24)
    .allow(null, '')
    .empty(['', null])
    .optional(),

  shopId: Joi.string()
    .hex()
    .length(24)
    .allow(null, '')
    .empty(['', null])
    .optional(),
})
.xor('bookingId', 'orderId') // exactly ONE required
.messages({
  'object.xor': 'Send ONLY bookingId OR ONLY orderId'
}),  
  // Verify Payment
 verifyPayment: Joi.object({
  razorpay_order_id: Joi.string().required(),
  razorpay_payment_id: Joi.string().required(),
  razorpay_signature: Joi.string().required(),

  bookingId: Joi.string()
    .hex()
    .length(24)
    .allow(null, '')
    .optional(),

  orderId: Joi.string()
    .hex()
    .length(24)
    .allow(null, '')
    .optional(),

  providerId: Joi.string()
    .hex()
    .length(24)
    .allow(null, '')
    .optional(),

  shopId: Joi.string()
    .hex()
    .length(24)
    .allow(null, '')
    .optional(),
})
.xor('bookingId', 'orderId')  
.messages({
  'object.xor': 'Send ONLY bookingId OR ONLY orderId while verifying'
}),
  
  // Cash Payment
 cashPayment: Joi.object({
  bookingId: Joi.string().hex().length(24).optional(),
  orderId: Joi.string().hex().length(24).optional(),
  paymentDestination: Joi.string().valid('company_account', 'personal_account').default('company_account')
})
.xor('bookingId', 'orderId')
.messages({
  'object.xor': 'Send ONLY bookingId OR ONLY orderId for cash payment'
}),  
  // Refund
 refund: Joi.object({
  reason: Joi.string().min(5).max(500).required(),

  bookingId: Joi.string().hex().length(24).optional(),
  orderId: Joi.string().hex().length(24).optional(),
})
.xor('bookingId', 'orderId')
.messages({
  'object.xor': 'Refund must be for booking OR order'
}),
  
  // Manual Verification
  manualVerification: Joi.object({
    paymentId: Joi.string().hex().length(24).required(),
    transactionId: Joi.string().required(),
    screenshot: Joi.string().uri(),
    notes: Joi.string().max(1000)
  }),
  
  // Mark Commission Paid
  markCommissionPaid: Joi.object({
    paymentId: Joi.string().hex().length(24).required(),
    paymentMethod: Joi.string().valid('upi', 'bank_transfer', 'cash').default('upi'),
    transactionId: Joi.string(),
    screenshotUrl: Joi.string().uri(),
    notes: Joi.string().max(1000)
  }),
  
  // UPI Deep Link
  generateDeepLink: Joi.object({
    upiId: Joi.string().pattern(/^[a-zA-Z0-9.\-_]+@[a-zA-Z]+$/).required(),
    name: Joi.string().max(100),
    amount: Joi.number().positive().required(),
    transactionNote: Joi.string().max(100)
  })
};

const validatePayment = (schemaName) => {
  return (req, res, next) => {
    const schema = paymentSchemas[schemaName];
    if (!schema) {
      return ResponseHandler.error(res, 'Validation schema not found', 500);
    }
    
    const { error } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/"/g, '')
      }));
      
      return ResponseHandler.error(res, 'Validation failed', 400, errors);
    }
    
    next();
  };
};

module.exports = { validatePayment };