// ============= controllers/shopController.js =============
const Shop = require('../models/Shop');
const Product = require("../models/Product")
const ResponseHandler = require('../utils/responseHandler');
const { deleteFromCloudinary } = require('../middleware/uploadMiddleware');
const GeoService = require('../services/geoService');
const logger = require('../utils/logger');

// Get Shop Profile
exports.getProfile = async (req, res) => {
  try {
    const shop = await Shop.findById(req.user._id);
    ResponseHandler.success(res, { shop }, 'Profile fetched successfully');
  } catch (error) {
    logger.error(`Get shop profile error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Update Shop Profile
exports.updateProfile = async (req, res) => {
  try {
    const {
      name, ownerName, email, address, workingHours, categories,
      gstNumber, fssaiLicense, bankDetails, deliverySettings,
      features, sla, isOpen, ownerPhone
    } = req.body;

    const updates = {};

    // Basic info
    if (name) updates.name = name;
    if (ownerName) updates.ownerName = ownerName;

    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return ResponseHandler.error(res, "Invalid email format", 400);
      }
      updates.email = email.toLowerCase();
    }

    if (ownerPhone) {
      // Ensure phone starts with +91
      const phone = ownerPhone.startsWith('+91') ? ownerPhone : `+91${ownerPhone}`;
      updates.ownerPhone = phone;
    }

    // Parse JSON data
    if (address) {
      const parsedAddress = typeof address === 'string' ? JSON.parse(address) : address;
      updates.address = parsedAddress;

      // Geocode address
      if (parsedAddress.addressLine1 && parsedAddress.city) {
        const addressString = [
          parsedAddress.addressLine1,
          parsedAddress.addressLine2,
          parsedAddress.landmark,
          parsedAddress.city,
          parsedAddress.state,
          parsedAddress.pincode,
          parsedAddress.country || 'India'
        ].filter(Boolean).join(', ');

        try {
          const geoResult = await GeoService.getCoordinatesFromAddress(addressString);
          if (geoResult.success) {
            updates['address.location'] = {
              type: 'Point',
              coordinates: geoResult.coordinates
            };
          }
        } catch (geoError) {
          console.warn('Geocoding failed:', geoError.message);
        }
      }
    }

    if (workingHours) {
      updates.workingHours = typeof workingHours === 'string'
        ? JSON.parse(workingHours)
        : workingHours;
    }

    if (categories) {
      updates.categories = typeof categories === 'string'
        ? JSON.parse(categories)
        : categories;
    }

    if (gstNumber) {
      // Basic GST validation
      const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (!gstRegex.test(gstNumber)) {
        return ResponseHandler.error(res, "Invalid GST number format", 400);
      }
      updates.gstNumber = gstNumber;
    }

    if (fssaiLicense) {
      updates.fssaiLicense = fssaiLicense;
    }

    if (bankDetails) {
      const parsedBankDetails = typeof bankDetails === 'string'
        ? JSON.parse(bankDetails)
        : bankDetails;

      // Validate bank details
      if (parsedBankDetails.accountNumber && !/^\d{9,18}$/.test(parsedBankDetails.accountNumber)) {
        return ResponseHandler.error(res, "Account number must be 9-18 digits", 400);
      }

      if (parsedBankDetails.ifscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(parsedBankDetails.ifscCode)) {
        return ResponseHandler.error(res, "Invalid IFSC code format", 400);
      }

      // Validate UPI ID format if provided
      if (parsedBankDetails.upiId && !/^[\w.-]+@[\w.-]+$/i.test(parsedBankDetails.upiId)) {
        return ResponseHandler.error(res, "Invalid UPI ID format (e.g., username@upi)", 400);
      }

      updates.bankDetails = parsedBankDetails;
    }

    if (deliverySettings) {
      updates.deliverySettings = typeof deliverySettings === 'string'
        ? JSON.parse(deliverySettings)
        : deliverySettings;
    }

    if (features) {
      updates.features = typeof features === 'string'
        ? JSON.parse(features)
        : features;
    }

    if (sla) {
      updates.sla = typeof sla === 'string'
        ? JSON.parse(sla)
        : sla;
    }

    if (isOpen !== undefined) {
      updates.isOpen = isOpen === 'true' || isOpen === true;
    }

    // Handle logo upload
    if (req.file) {
      try {
        if (req.user.logo?.publicId) {
          await deleteFromCloudinary(req.user.logo.publicId);
        }

        updates.logo = {
          url: req.file.path,
          publicId: req.file.filename
        };
      } catch (uploadError) {
        logger.error(`Logo upload error: ${uploadError.message}`);
        return ResponseHandler.error(res, "Failed to upload logo", 500);
      }
    }

    // Update the shop
    const shop = await Shop.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      {
        new: true,
        runValidators: true,
        select: '-password -otp -resetPasswordToken -resetPasswordExpire -deliveryBoys.password'
      }
    ).lean();

    if (!shop) {
      return ResponseHandler.error(res, "Shop not found", 404);
    }

    ResponseHandler.success(res, { shop }, 'Profile updated successfully');

  } catch (error) {
    logger.error(`Update shop profile error: ${error.message}`, error);

    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return ResponseHandler.error(res, errors.join(', '), 400);
    }

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return ResponseHandler.error(res, `${field} already exists`, 400);
    }

    ResponseHandler.error(res, "Internal server error", 500);
  }
};

// Upload Documents
exports.uploadDocuments = async (req, res) => {
  try {
    const shop = await Shop.findById(req.user._id);

    if (req.files) {
      if (req.files.businessLicense) {
        if (shop.documents.businessLicense?.publicId) {
          await deleteFromCloudinary(shop.documents.businessLicense.publicId);
        }
        shop.documents.businessLicense = {
          url: req.files.businessLicense[0].path,
          publicId: req.files.businessLicense[0].filename
        };
      }

      if (req.files.gstCertificate) {
        if (shop.documents.gstCertificate?.publicId) {
          await deleteFromCloudinary(shop.documents.gstCertificate.publicId);
        }
        shop.documents.gstCertificate = {
          url: req.files.gstCertificate[0].path,
          publicId: req.files.gstCertificate[0].filename
        };
      }
    }

    await shop.save();

    ResponseHandler.success(res, { documents: shop.documents }, 'Documents uploaded successfully');
  } catch (error) {
    logger.error(`Upload shop documents error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
// Add Delivery Boy
exports.addDeliveryBoy = async (req, res) => {
  try {
    const { name, phone, email, password, vehicle } = req.body;

    // Check if phone already exists in shop's delivery boys
    const shop = await Shop.findById(req.user._id);
    const existingBoy = shop.deliveryBoys.find(boy => boy.phone === phone);

    if (existingBoy) {
      return ResponseHandler.error(res, 'Delivery boy with this phone already exists', 400);
    }

    // Create new delivery boy
    const deliveryBoy = {
      name,
      phone,
      email: email || undefined,
      password,
      vehicle: vehicle || { type: 'bike' },
      status: 'inactive',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    shop.deliveryBoys.push(deliveryBoy);
    await shop.save();

    // Remove password from response
    const addedBoy = shop.deliveryBoys[shop.deliveryBoys.length - 1].toObject();
    delete addedBoy.password;

    ResponseHandler.success(res, { deliveryBoy: addedBoy }, 'Delivery boy added successfully', 201);
  } catch (error) {
    logger.error(`Add delivery boy error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get All Delivery Boys
exports.getDeliveryBoys = async (req, res) => {
  try {
    const { status } = req.query;

    const shop = await Shop.findById(req.user._id);

    let deliveryBoys = shop.deliveryBoys;

    if (status) {
      deliveryBoys = deliveryBoys.filter(boy => boy.status === status);
    }

    // Remove passwords from response
    deliveryBoys = deliveryBoys.map(boy => {
      const boyObj = boy.toObject();
      delete boyObj.password;
      return boyObj;
    });

    ResponseHandler.success(res, { deliveryBoys }, 'Delivery boys fetched successfully');
  } catch (error) {
    logger.error(`Get delivery boys error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Single Delivery Boy
exports.getDeliveryBoy = async (req, res) => {
  try {
    const { id } = req.params;

    const shop = await Shop.findById(req.user._id);
    const deliveryBoy = shop.deliveryBoys.id(id);

    if (!deliveryBoy) {
      return ResponseHandler.error(res, 'Delivery boy not found', 404);
    }

    const boyObj = deliveryBoy.toObject();
    delete boyObj.password;

    ResponseHandler.success(res, { deliveryBoy: boyObj }, 'Delivery boy fetched successfully');
  } catch (error) {
    logger.error(`Get delivery boy error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Update Delivery Boy
exports.updateDeliveryBoy = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const shop = await Shop.findById(req.user._id);
    const deliveryBoy = shop.deliveryBoys.id(id);

    if (!deliveryBoy) {
      return ResponseHandler.error(res, 'Delivery boy not found', 404);
    }

    // Update fields
    if (updates.name) deliveryBoy.name = updates.name;
    if (updates.email) deliveryBoy.email = updates.email;
    if (updates.vehicle) deliveryBoy.vehicle = updates.vehicle;
    if (updates.status) deliveryBoy.status = updates.status;
    if (updates.isActive !== undefined) deliveryBoy.isActive = updates.isActive;

    // Handle password update
    if (updates.password) {
      const salt = await bcrypt.genSalt(10);
      deliveryBoy.password = await bcrypt.hash(updates.password, salt);
    }

    deliveryBoy.updatedAt = new Date();

    await shop.save();

    const boyObj = deliveryBoy.toObject();
    delete boyObj.password;

    ResponseHandler.success(res, { deliveryBoy: boyObj }, 'Delivery boy updated successfully');
  } catch (error) {
    logger.error(`Update delivery boy error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Delete Delivery Boy
exports.deleteDeliveryBoy = async (req, res) => {
  try {
    const { id } = req.params;

    const shop = await Shop.findById(req.user._id);
    const deliveryBoy = shop.deliveryBoys.id(id);

    if (!deliveryBoy) {
      return ResponseHandler.error(res, 'Delivery boy not found', 404);
    }

    // Check if delivery boy has assigned orders
    if (deliveryBoy.assignedOrders && deliveryBoy.assignedOrders.length > 0) {
      return ResponseHandler.error(res, 'Cannot delete delivery boy with assigned orders', 400);
    }

    // Remove delivery boy from array
    shop.deliveryBoys.pull(id);
    await shop.save();

    ResponseHandler.success(res, null, 'Delivery boy deleted successfully');
  } catch (error) {
    logger.error(`Delete delivery boy error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Upload Delivery Boy Documents
exports.uploadDeliveryBoyDocuments = async (req, res) => {
  try {
    const { id } = req.params;
    const { documentType } = req.body; // 'drivingLicense' or 'aadharCard'

    if (!req.file) {
      return ResponseHandler.error(res, 'No file uploaded', 400);
    }

    if (!['drivingLicense', 'aadharCard'].includes(documentType)) {
      return ResponseHandler.error(res, 'Invalid document type', 400);
    }

    const shop = await Shop.findById(req.user._id);
    const deliveryBoy = shop.deliveryBoys.id(id);

    if (!deliveryBoy) {
      return ResponseHandler.error(res, 'Delivery boy not found', 404);
    }

    // Delete old document if exists
    if (deliveryBoy.documents[documentType]?.publicId) {
      await deleteFromCloudinary(deliveryBoy.documents[documentType].publicId);
    }

    // Update document
    deliveryBoy.documents[documentType] = {
      url: req.file.path,
      publicId: req.file.filename,
      verified: false
    };

    await shop.save();

    ResponseHandler.success(
      res,
      { documents: deliveryBoy.documents },
      'Document uploaded successfully'
    );
  } catch (error) {
    logger.error(`Upload delivery boy documents error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Delivery Boy Performance Stats
exports.getDeliveryBoyStats = async (req, res) => {
  try {
    const { id } = req.params;

    // Debug logs removed for production

    const shop = await Shop.findById(req.user._id);

    if (!shop) {
      return ResponseHandler.error(res, "Shop not found", 404);
    }

    // Debug logs removed for production

    const deliveryBoy = shop.deliveryBoys.id(id);

    if (!deliveryBoy) {
      return ResponseHandler.error(res, "Delivery boy not found", 404);
    }

    const stats = {
      totalDeliveries: deliveryBoy.totalDeliveries,
      ratings: deliveryBoy.ratings,
      earnings: deliveryBoy.earnings,
      assignedOrders: deliveryBoy.assignedOrders.length,
      status: deliveryBoy.status,
      vehicle: deliveryBoy.vehicle
    };

    return ResponseHandler.success(
      res,
      { stats },
      "Delivery boy stats fetched successfully"
    );

  } catch (error) {
    console.error("Error:", error);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Add Product
exports.addProduct = async (req, res) => {
  try {
    const { name, description, category, subcategory, price, stock, brand, specifications, tags, sku } = req.body;

    const productData = {
      shop: req.user._id,
      name,
      description,
      category,
      subcategory,
      price,
      stock,
      brand,
      specifications: specifications ? JSON.parse(specifications) : [],
      tags: tags ? JSON.parse(tags) : [],
      sku
    };

    if (req.files && req.files.length > 0) {
      productData.images = req.files.map(file => ({
        url: file.path,
        publicId: file.filename
      }));
    }

    const product = await Product.create(productData);

    ResponseHandler.success(res, { product }, 'Product added successfully', 201);
  } catch (error) {
    logger.error(`Add product error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get My Products
exports.getMyProducts = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, category } = req.query;

    const query = { shop: req.user._id };
    if (search) query.name = { $regex: search, $options: 'i' };
    if (category) query.category = category;

    const products = await Product.find(query)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const count = await Product.countDocuments(query);

    ResponseHandler.paginated(res, products, page, limit, count);
  } catch (error) {
    logger.error(`Get shop products error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Update Product
exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const product = await Product.findOne({ _id: id, shop: req.user._id });

    if (!product) {
      return ResponseHandler.error(res, 'Product not found', 404);
    }

    if (req.files && req.files.length > 0) {
      // Delete old images
      if (product.images && product.images.length > 0) {
        for (const img of product.images) {
          if (img.publicId) {
            await deleteFromCloudinary(img.publicId);
          }
        }
      }

      updates.images = req.files.map(file => ({
        url: file.path,
        publicId: file.filename
      }));
    }

    Object.assign(product, updates);
    await product.save();

    ResponseHandler.success(res, { product }, 'Product updated successfully');
  } catch (error) {
    logger.error(`Update product error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Delete Product
exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findOne({ _id: id, shop: req.user._id });

    if (!product) {
      return ResponseHandler.error(res, 'Product not found', 404);
    }

    // Delete product images from Cloudinary
    if (product.images && product.images.length > 0) {
      for (const img of product.images) {
        if (img.publicId) {
          await deleteFromCloudinary(img.publicId);
        }
      }
    }

    await product.deleteOne();

    ResponseHandler.success(res, null, 'Product deleted successfully');
  } catch (error) {
    logger.error(`Delete product error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Orders
exports.getOrders = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const Booking = require('../models/Booking');

    const query = {
      'products.shop': req.user._id
    };

    if (status) query.status = status;

    const orders = await Booking.find(query)
      .populate('user')
      .populate('products.product')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const count = await Booking.countDocuments(query);

    ResponseHandler.paginated(res, orders, page, limit, count);
  } catch (error) {
    logger.error(`Get shop orders error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Update Order Status
exports.updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const Booking = require('../models/Booking');

    const order = await Booking.findOne({
      _id: id,
      'products.shop': req.user._id
    });

    if (!order) {
      return ResponseHandler.error(res, 'Order not found', 404);
    }

    // Update product order status
    order.products.forEach(product => {
      if (product.shop.toString() === req.user._id.toString()) {
        product.status = status;
      }
    });

    await order.save();

    // Send notification to user
    const PushNotificationService = require('../services/pushNotification');
    await PushNotificationService.sendToUser(
      order.user,
      'Order Status Updated',
      `Your order status has been updated to ${status}`
    );

    ResponseHandler.success(res, { order }, 'Order status updated successfully');
  } catch (error) {
    logger.error(`Update order status error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

