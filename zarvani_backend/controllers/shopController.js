// ============= controllers/shopController.js =============
const Shop = require('../models/Shop');
const Product = require("../models/Product")
const Order = require('../models/Order');
const ResponseHandler = require('../utils/responseHandler');
const { deleteFromCloudinary } = require('../middleware/uploadMiddleware');
const GeoService = require('../services/geoService');
const CacheService = require('../services/cacheService');
const CacheInvalidationService = require('../services/cacheInvalidationService');
const logger = require('../utils/logger');
const PushNotificationService = require('../services/pushNotification');

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

// ========================== SHOP DASHBOARD ==========================
exports.getDashboard = async (req, res) => {
  try {
    const shopId = req.user._id;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Products counts
    const [totalProducts, activeProducts] = await Promise.all([
      Product.countDocuments({ shop: shopId }),
      Product.countDocuments({ shop: shopId, isAvailable: true })
    ]);

    // Orders counts
    const [pendingOrders, preparingOrders, outForDelivery] = await Promise.all([
      Order.countDocuments({ shop: shopId, status: 'pending' }),
      Order.countDocuments({ shop: shopId, status: 'preparing' }),
      Order.countDocuments({ shop: shopId, status: 'out_for_delivery' })
    ]);

    // Delivered today and today's revenue
    const deliveredTodayAgg = await Order.aggregate([
      { $match: { shop: shopId, status: 'delivered', 'timestamps.deliveredAt': { $gte: todayStart } } },
      { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$pricing.totalAmount' } } }
    ]);

    const deliveredToday = deliveredTodayAgg[0]?.count || 0;
    const totalRevenue = deliveredTodayAgg[0]?.revenue || 0;

    // Average shop rating
    const shop = await Shop.findById(shopId).select('ratings').lean();
    const averageRating = shop?.ratings?.average || 0;

    // Recent orders (latest 8)
    const recentOrdersRaw = await Order.find({ shop: shopId })
      .sort({ 'timestamps.placedAt': -1 })
      .limit(8)
      .select('orderId status customerInfo items pricing')
      .lean();

    const recentOrders = recentOrdersRaw.map(o => ({
      _id: o._id,
      orderId: o.orderId,
      status: o.status,
      customerName: o.customerInfo?.name || '',
      itemsCount: Array.isArray(o.items) ? o.items.length : 0,
      totalAmount: o.pricing?.totalAmount || 0
    }));

    // Top products today (by quantity sold)
    const topProductsAgg = await Order.aggregate([
      { $match: { shop: shopId, 'timestamps.placedAt': { $gte: todayStart } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.product', soldToday: { $sum: '$items.quantity' }, revenue: { $sum: '$items.total' } } },
      { $sort: { soldToday: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      { $project: { _id: '$_id', soldToday: 1, revenue: 1, name: '$product.name', category: '$product.category', image: { $arrayElemAt: ['$product.images.url', 0] } } }
    ]);

    const topProducts = topProductsAgg.map(p => ({
      _id: p._id,
      name: p.name || 'Unknown',
      category: p.category || 'Uncategorized',
      soldToday: p.soldToday || 0,
      revenue: p.revenue || 0,
      image: p.image || null
    }));

    // Delivery boys stats
    const shopDoc = await Shop.findById(shopId).select('deliveryBoys').lean();
    const deliveryBoyStats = (shopDoc?.deliveryBoys || []).map(b => ({
      _id: b._id,
      name: b.name,
      phone: b.phone,
      status: b.status,
      assignedOrders: Array.isArray(b.assignedOrders) ? b.assignedOrders.length : 0
    }));

    const response = {
      stats: {
        totalProducts,
        activeProducts,
        pendingOrders,
        preparingOrders,
        outForDelivery,
        deliveredToday,
        totalRevenue,
        averageRating
      },
      recentOrders,
      topProducts,
      deliveryBoyStats
    };

    ResponseHandler.success(res, response, 'Shop dashboard fetched successfully');
  } catch (error) {
    logger.error(`Get dashboard error: ${error.message}`);
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
    const shopId = req.user._id;

    // Build cache key
    const cacheKey = `shop:${shopId}:products:${search || ''}:${category || ''}:p${page}`;

    // Try cache first
    if (page == 1) {
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        logger.debug(`Cache HIT: Shop products for ${shopId}`);
        return ResponseHandler.success(res, cached, 'Products fetched from cache');
      }
    }

    const query = { shop: shopId };
    if (search) query.name = { $regex: search, $options: 'i' };
    if (category) query.category = category;

    const products = await Product.find(query)
      .lean()
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const count = await Product.countDocuments(query);

    const response = {
      products,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    };

    // Cache for 5 minutes
    if (page == 1) {
      await CacheService.set(cacheKey, response, 300);
    }

    ResponseHandler.success(res, response, 'Products fetched successfully');
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

exports.getOrders = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const shopId = req.user._id;

    // Build cache key
    const cacheKey = `shop:${shopId}:orders:${status || 'all'}:p${page}`;

    // Try cache first (for first page only)
    if (page == 1) {
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        logger.debug(`Cache HIT: Shop orders for ${shopId}`);
        return ResponseHandler.success(res, cached, 'Orders fetched from cache');
      }
    }

    const query = {
      'products.shop': shopId
    };

    if (status) query.status = status;

    const skip = (page - 1) * limit;

    // OPTIMIZATION 1: Use .lean() for faster queries
    const orders = await Booking.find(query)
      .lean()
      .limit(limit * 1)
      .skip(skip)
      .sort({ createdAt: -1 });

    // OPTIMIZATION 2: Batch load users (1 query instead of N)
    await batchLoadAndAttach(
      orders,
      'user',
      User,
      'user',
      'name email phone profilePicture'
    );

    // OPTIMIZATION 3: Batch load products for all orders
    // First, collect all product IDs from all orders
    const allProductIds = [];
    orders.forEach(order => {
      if (order.products && Array.isArray(order.products)) {
        order.products.forEach(p => {
          if (p.product) allProductIds.push(p.product);
        });
      }
    });

    // Batch load all products at once
    if (allProductIds.length > 0) {
      const Product = require('../models/Product');
      const uniqueProductIds = [...new Set(allProductIds.map(id => id.toString()))];
      const products = await Product.find({
        _id: { $in: uniqueProductIds }
      }).lean();

      // Create a map for O(1) lookup
      const productMap = {};
      products.forEach(product => {
        productMap[product._id.toString()] = product;
      });

      // Attach products to orders
      orders.forEach(order => {
        if (order.products && Array.isArray(order.products)) {
          order.products.forEach(p => {
            if (p.product && productMap[p.product.toString()]) {
              p.product = productMap[p.product.toString()];
            }
          });
        }
      });
    }

    const count = await Booking.countDocuments(query);

    const response = {
      orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(count / limit),
        totalItems: count,
        itemsPerPage: parseInt(limit)
      }
    };

    // Cache for 2 minutes (first page only)
    if (page == 1) {
      await CacheService.set(cacheKey, response, 120);
    }

    ResponseHandler.success(res, response, 'Orders fetched successfully');
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

// Cache invalidation now handled by CacheInvalidationService

// ========================== NEARBY SHOPS (Blinkit/Swiggy Style) ==========================
// GET /api/v1/shops/public/nearby?lat=X&lng=Y&radius=5&category=grocery
exports.getNearbyShops = async (req, res) => {
  try {
    const { lat, lng, radius = 5, category, limit = 20 } = req.query;

    if (!lat || !lng) {
      return ResponseHandler.error(res, 'lat and lng query params are required', 400);
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radiusMeters = parseFloat(radius) * 1000;

    // Build cache key
    const cacheKey = `shops:nearby:${latitude.toFixed(3)},${longitude.toFixed(3)}:r${radius}:${category || 'all'}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) {
      return ResponseHandler.success(res, cached, 'Nearby shops fetched from cache');
    }

    const matchStage = {
      isActive: true,
      verificationStatus: 'approved'
    };
    if (category) matchStage.categories = category;

    const shops = await Shop.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [longitude, latitude] },
          distanceField: 'distance',        // distance in metres
          maxDistance: radiusMeters,
          spherical: true,
          query: matchStage
        }
      },
      {
        $addFields: {
          distanceKm: { $divide: ['$distance', 1000] },
          // Estimated delivery time based on distance + shop's own setting
          estimatedDeliveryMin: {
            $add: [
              '$deliverySettings.estimatedDeliveryTime.min',
              { $multiply: [{ $divide: ['$distance', 1000] }, 3] } // +3 min per km
            ]
          }
        }
      },
      { $sort: { distance: 1 } },
      { $limit: parseInt(limit) },
      {
        $project: {
          password: 0,
          otp: 0,
          sessions: 0,
          resetPasswordToken: 0,
          documents: 0,
          'deliveryBoys.password': 0,
          'deliveryBoys.otp': 0
        }
      }
    ]);

    // Tag each shop with open/closed status
    const shopsWithStatus = shops.map(shop => {
      const now = new Date();
      const day = now.toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
      const daySchedule = shop.workingHours?.[day];
      let isOpen = shop.isOpen;

      if (daySchedule && daySchedule.isOpen && daySchedule.start && daySchedule.end) {
        const [sh, sm] = daySchedule.start.split(':').map(Number);
        const [eh, em] = daySchedule.end.split(':').map(Number);
        const current = now.getHours() * 60 + now.getMinutes();
        const start = sh * 60 + sm;
        const end = eh * 60 + em;
        isOpen = current >= start && current <= end;
      }

      return {
        ...shop,
        isCurrentlyOpen: isOpen,
        distanceKm: parseFloat(shop.distanceKm.toFixed(2)),
        estimatedDeliveryMin: Math.ceil(shop.estimatedDeliveryMin || 30)
      };
    });

    const response = { shops: shopsWithStatus, count: shopsWithStatus.length };

    // Cache for 2 minutes (location-sensitive)
    await CacheService.set(cacheKey, response, 120);

    ResponseHandler.success(res, response, 'Nearby shops fetched successfully');
  } catch (error) {
    logger.error(`Get nearby shops error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ========================== JOIN SHOP TRACKING ROOM ==========================
// Allows shop's socket room to be joined so delivery boy positions can be shown on shop dashboard
exports.joinShopTrackingRoom = async (req, res) => {
  try {
    const shopId = req.user._id;
    const io = req.app.get('io');
    if (io) {
      // Emit current delivery boy positions to whoever is on the shop dashboard
      const shop = await Shop.findById(shopId)
        .select('deliveryBoys')
        .lean();

      const activeBoys = (shop?.deliveryBoys || [])
        .filter(b => b.status === 'on-delivery' && b.currentLocation?.coordinates?.length > 0)
        .map(b => ({
          id: b._id,
          name: b.name,
          phone: b.phone,
          vehicle: b.vehicle,
          latitude: b.currentLocation.coordinates[1],
          longitude: b.currentLocation.coordinates[0],
          updatedAt: b.currentLocation.updatedAt,
          assignedOrders: b.assignedOrders?.length || 0
        }));

      io.to(`shop_${shopId}`).emit('active-delivery-boys', { boys: activeBoys });
    }

    ResponseHandler.success(res, { message: 'Joined shop tracking room' }, 'OK');
  } catch (error) {
    logger.error(`Join shop tracking room error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};