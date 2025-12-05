
// ============= middleware/validateRequest.js =============
const { validationResult } = require('express-validator');
const Joi = require('joi');

exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }
  next();
};

exports.validateSchema = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors
      });
    }
    
    next();
  };
};

// Common Joi schemas
exports.schemas = {
  signup: Joi.object({
    name: Joi.string().min(2).max(50).required(),
    email: Joi.string().email().optional(),
    phone: Joi.string().pattern(/^\+\d{7,15}$/).required(),
    password: Joi.string().min(6).optional(),
    role: Joi.string().valid('user', 'provider', 'shop').default('user')
  }),
  
  login: Joi.object({
    identifier: Joi.string().required(),
    password: Joi.string().when('loginType', {
      is: 'password',
      then: Joi.required(),
      otherwise: Joi.optional()
    }),
    loginType: Joi.string().valid('password', 'otp').default('password')
  }),
  
  verifyOTP: Joi.object({
    identifier: Joi.string().required(),
    otp: Joi.string().length(6).required()
  }),
  
  createBooking: Joi.object({
    service: Joi.string().required(),
    provider: Joi.string().optional(),
    scheduledDate: Joi.date().min(new Date().setHours(0,0,0,0)).required(),
    scheduledTime: Joi.string().required(),
    address: Joi.object({
      addressLine1: Joi.string().required(),
      addressLine2: Joi.string().optional(),
      city: Joi.string().required(),
      state: Joi.string().required(),
      pincode: Joi.string().required(),
      location: Joi.object({
        coordinates: Joi.array().items(Joi.number()).length(2)
      })
    }).required(),
    products: Joi.array().items(Joi.object({
      product: Joi.string().required(),
      shop: Joi.string().required(),
      quantity: Joi.number().min(1).required()
    })).optional(),
    notes: Joi.string().max(500).optional()
  })
};
