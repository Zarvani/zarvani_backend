// ============= controllers/shopController.js =============
const Shop = require('../models/Shop');
const  Product  =require("../models/Product")
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
    const { name, ownerName, email, address, workingHours, categories, gstNumber, bankDetails } = req.body;
    const updates = {};
    
    if (name) updates.name = name;
    if (ownerName) updates.ownerName = ownerName;
    if (email) updates.email = email;
    if (address) {
      updates.address = address;
      
      // Get coordinates for address
      const geoResult = await GeoService.getCoordinatesFromAddress(address);
      if (geoResult.success) {
        updates['address.location'] = {
          type: 'Point',
          coordinates: geoResult.coordinates
        };
      }
    }
    if (workingHours) updates.workingHours = workingHours;
    if (categories) updates.categories = categories;
    if (gstNumber) updates.gstNumber = gstNumber;
    if (bankDetails) updates.bankDetails = bankDetails;
    
    if (req.file) {
      if (req.user.logo?.publicId) {
        await deleteFromCloudinary(req.user.logo.publicId);
      }
      updates.logo = {
        url: req.file.path,
        publicId: req.file.filename
      };
    }
    
    const shop = await Shop.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    );
    
    ResponseHandler.success(res, { shop }, 'Profile updated successfully');
  } catch (error) {
    logger.error(`Update shop profile error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
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

    console.log("Shop ID from token:", req.user._id);
    console.log("DeliveryBoy ID from URL:", id);

    const shop = await Shop.findById(req.user._id);

    if (!shop) {
      return ResponseHandler.error(res, "Shop not found", 404);
    }

    console.log("All DBoys:", shop.deliveryBoys.map(b => b._id));

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
    const { Booking } = require('../models/Shop');
    
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

