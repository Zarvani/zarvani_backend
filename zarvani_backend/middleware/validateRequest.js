// ============= middleware/validateRequest.js =============
const { validationResult } = require("express-validator");
const Joi = require("joi");

// -----------------------------
// Global Express-Validator handler
// -----------------------------
exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    });
  }
  next();
};

// -----------------------------
// Universal Joi Validator Wrapper
// -----------------------------
exports.validateSchema = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      }));

      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors,
      });
    }

    next();
  };
};

// -----------------------------
// ALL JOI SCHEMAS HERE (MERGED)
// -----------------------------
exports.schemas = {
  // ----------------------------
  // 🔹 USER SIGNUP
  // ----------------------------
  signup: Joi.object({
    name: Joi.string().min(2).max(50).required(),
    email: Joi.string().email(),
    phone: Joi.string().pattern(/^\+\d{7,15}$/).required(),
    password: Joi.string().min(6),
    role: Joi.string().valid("user", "provider", "shop").default("user"),
  }),

  // ----------------------------
  // 🔹 LOGIN
  // ----------------------------
  login: Joi.object({
    identifier: Joi.string().required(),
    password: Joi.string().when("loginType", {
      is: "password",
      then: Joi.required(),
    }),
    loginType: Joi.string().valid("password", "otp").default("password"),
  }),

  // ----------------------------
  // 🔹 VERIFY OTP
  // ----------------------------
  verifyOTP: Joi.object({
    identifier: Joi.string().required(),
    otp: Joi.string().length(6).required(),
  }),

  // ----------------------------
  // 🔹 CREATE BOOKING
  // ----------------------------
  createBooking: Joi.object({
    service: Joi.string().required(),
    provider: Joi.string(),
    scheduledDate: Joi.date()
      .min(new Date().setHours(0, 0, 0, 0))
      .required(),
    scheduledTime: Joi.string().required(),
    address: Joi.object({
      addressLine1: Joi.string().required(),
      addressLine2: Joi.string(),
      city: Joi.string().required(),
      state: Joi.string().required(),
      pincode: Joi.string().required(),
      location: Joi.object({
        coordinates: Joi.array().items(Joi.number()).length(2),
      }),
    }).required(),
    products: Joi.array().items(
      Joi.object({
        product: Joi.string().required(),
        shop: Joi.string().required(),
        quantity: Joi.number().min(1).required(),
      })
    ),
    notes: Joi.string().max(500),
  }),

  // =========================================================
  // 🔥 NEW VALIDATION ADDED (Order, Shop, Product)
  // =========================================================

  // ----------------------------
  // 🔹 ORDER VALIDATION
  // ----------------------------
  order: Joi.object({
    shopId: Joi.string().required(),
    items: Joi.array()
      .items(
        Joi.object({
          productId: Joi.string().required(),
          quantity: Joi.number().integer().min(1).required(),
          variant: Joi.string(),
          addons: Joi.array().items(
            Joi.object({
              name: Joi.string().required(),
              price: Joi.number().min(0).required(),
              quantity: Joi.number().integer().min(1).required(),
            })
          ),
        })
      )
      .min(1)
      .required(),

    deliveryAddressId: Joi.string().required(),

    deliveryType: Joi.string().valid("standard", "express", "scheduled"),

    deliverySlot: Joi.object({
      start: Joi.date(),
      end: Joi.date(),
    }),

    deliveryInstructions: Joi.string().max(500),

    paymentMethod: Joi.string()
      .valid("cod", "online", "wallet")
      .required(),

    couponCode: Joi.string(),
    tip: Joi.number().min(0),
    notes: Joi.string().max(500),
  }),

  // ----------------------------
  // 🔹 SHOP REGISTRATION
  // ----------------------------
  shop: Joi.object({
    name: Joi.string().min(3).max(100).required(),
    email: Joi.string().email(),
    phone: Joi.string().pattern(/^\+\d{7,15}$/).required(),
    password: Joi.string().min(6).required(),
    ownerName: Joi.string().required(),

    address: Joi.object({
      addressLine1: Joi.string().required(),
      addressLine2: Joi.string(),
      city: Joi.string().required(),
      state: Joi.string().required(),
      pincode: Joi.string().required(),
      country: Joi.string().default("India"),
    }).required(),
  }),

  // ----------------------------
  // 🔹 PRODUCT CREATION
  // ----------------------------
  product: Joi.object({
    name: Joi.string().min(3).max(200).required(),
    description: Joi.string().max(2000),
    category: Joi.string().required(),
    subcategory: Joi.string(),

    price: Joi.object({
      mrp: Joi.number().min(0).required(),
      sellingPrice: Joi.number().min(0).required(),
    }).required(),

    stock: Joi.object({
      quantity: Joi.number().integer().min(0).required(),
      unit: Joi.string().default("piece"),
      lowStockThreshold: Joi.number().integer().min(0),
    }).required(),

    brand: Joi.string(),
    specifications: Joi.array().items(
      Joi.object({
        key: Joi.string().required(),
        value: Joi.string().required(),
      })
    ),

    tags: Joi.array().items(Joi.string()),

    weight: Joi.number().min(0),
    expiryDate: Joi.date(),
  }),
};
