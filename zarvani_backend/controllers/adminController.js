// ============= controllers/adminController.js =============
const User = require('../models/User');
const ServiceProvider = require('../models/ServiceProvider');
const { Shop } = require('../models/Shop');
const Booking =require("../models/Booking")
const Payment = require("../models/Payment");
const { Service } =require("../models/Service")
const { Product } =require("../models/Product")
const ResponseHandler = require('../utils/responseHandler');
const EmailService = require('../services/emailService');
const { Admin } = require('../models/Admin');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const mongoose = require("mongoose");

exports.createAdmin = async (req, res) => {
  try {
    const { name, email, password, role, permissions } = req.body;
    const admin = new Admin({ name, email, password, role, permissions });
    await admin.save();
    res.status(201).json({ message: 'Admin created successfully', admin });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
// Get All Users
exports.getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, isActive } = req.query;
    
    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }
    if (isActive !== undefined) query.isActive = isActive === 'true';
    
    const users = await User.find(query)
      .select('-password -otp')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    
    const count = await User.countDocuments(query);
    
    ResponseHandler.paginated(res, users, page, limit, count);
  } catch (error) {
    logger.error(`Get all users error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get All Providers
exports.getAllProviders = async (req, res) => {
  try {
    const { page = 1, limit = 20, verificationStatus, search } = req.query;
    
    const query = {};
    if (verificationStatus) query.verificationStatus = verificationStatus;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }
    
    const providers = await ServiceProvider.find(query)
      .select('-password -otp')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    
    const count = await ServiceProvider.countDocuments(query);
    
    ResponseHandler.paginated(res, providers, page, limit, count);
  } catch (error) {
    logger.error(`Get all providers error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Verify Provider
exports.verifyProvider = async (req, res) => {
  try {
    const { id } = req.params;
    
    const provider = await ServiceProvider.findByIdAndUpdate(
      id,
      {
        verificationStatus: 'approved',
        isActive: true,
        'documents.idProof.verified': true,
        'documents.addressProof.verified': true,
        'documents.policeClearance.verified': true
      },
      { new: true }
    );
    
    if (!provider) {
      return ResponseHandler.error(res, 'Provider not found', 404);
    }
    
    // Send approval email
    if (provider.email) {
      await EmailService.sendEmail(
        provider.email,
        'Account Approved - Zarvani',
        `<p>Congratulations ${provider.name}! Your service provider account has been approved.</p>`
      );
    }
    
    ResponseHandler.success(res, { provider }, 'Provider verified successfully');
  } catch (error) {
    logger.error(`Verify provider error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Reject Provider
exports.rejectProvider = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const provider = await ServiceProvider.findByIdAndUpdate(
      id,
      {
        verificationStatus: 'rejected',
        rejectionReason: reason,
        isActive: false
      },
      { new: true }
    );
    
    if (!provider) {
      return ResponseHandler.error(res, 'Provider not found', 404);
    }
    
    // Send rejection email
    if (provider.email) {
      await EmailService.sendEmail(
        provider.email,
        'Account Verification Update - Zarvani',
        `<p>Dear ${provider.name}, your application has been rejected. Reason: ${reason}</p>`
      );
    }
    
    ResponseHandler.success(res, { provider }, 'Provider rejected');
  } catch (error) {
    logger.error(`Reject provider error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Dashboard Stats
exports.getDashboardStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ isActive: true });
    const totalProviders = await ServiceProvider.countDocuments({ 
      verificationStatus: 'approved',
      isActive: true 
    });
    const totalShops = await Shop.countDocuments({ 
      verificationStatus: 'approved',
      isActive: true 
    });
    const totalBookings = await Booking.countDocuments();
    const pendingBookings = await Booking.countDocuments({ status: 'pending' });
    const completedBookings = await Booking.countDocuments({ status: 'completed' });
    
    const totalRevenue = await Payment.aggregate([
      { $match: { status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const monthlyRevenue = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          createdAt: {
            $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          }
        }
      },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const stats = {
      totalUsers,
      totalProviders,
      totalShops,
      totalBookings,
      pendingBookings,
      completedBookings,
      totalRevenue: totalRevenue[0]?.total || 0,
      monthlyRevenue: monthlyRevenue[0]?.total || 0,
      pendingVerifications: await ServiceProvider.countDocuments({ verificationStatus: 'pending' }) +
                           await Shop.countDocuments({ verificationStatus: 'pending' })
    };
    
    ResponseHandler.success(res, stats, 'Dashboard stats fetched successfully');
  } catch (error) {
    logger.error(`Get dashboard stats error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Revenue Stats
exports.getRevenueStats = async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    let startDate;
    const now = new Date();
    
    if (period === 'week') {
      startDate = new Date(now.setDate(now.getDate() - 7));
    } else if (period === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }
    
    const revenue = await Payment.aggregate([
      {
        $match: {
          status: 'success',
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    ResponseHandler.success(res, revenue, 'Revenue stats fetched successfully');
  } catch (error) {
    logger.error(`Get revenue stats error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Top Services
exports.getTopServices = async (req, res) => {
  try {
    const topServices = await Booking.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: '$service', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'services',
          localField: '_id',
          foreignField: '_id',
          as: 'serviceDetails'
        }
      },
      { $unwind: '$serviceDetails' }
    ]);
    
    ResponseHandler.success(res, topServices, 'Top services fetched successfully');
  } catch (error) {
    logger.error(`Get top services error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Top Providers
exports.getTopProviders = async (req, res) => {
  try {
    const topProviders = await ServiceProvider.find({
      verificationStatus: 'approved',
      isActive: true
    })
      .select('name profilePicture ratings completedServices')
      .sort({ 'ratings.average': -1, completedServices: -1 })
      .limit(10);
    
    ResponseHandler.success(res, topProviders, 'Top providers fetched successfully');
  } catch (error) {
    logger.error(`Get top providers error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Send Bulk Notification
exports.sendBulkNotification = async (req, res) => {
  try {
    const { title, message, targetRole, userIds } = req.body;
    
    const PushNotificationService = require('../services/pushNotification');
    
    if (userIds && userIds.length > 0) {
      await PushNotificationService.sendBulkNotification(userIds, title, message);
    } else if (targetRole) {
      // Send to all users of a specific role
      let Model;
      if (targetRole === 'user') Model = User;
      else if (targetRole === 'provider') Model = ServiceProvider;
      else if (targetRole === 'shop') Model = Shop;
      
      const users = await Model.find({ isActive: true }).select('_id');
      const ids = users.map(u => u._id);
      
      await PushNotificationService.sendBulkNotification(ids, title, message);
    }
    
    ResponseHandler.success(res, null, 'Notifications sent successfully');
  } catch (error) {
    logger.error(`Send bulk notification error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
// ============= Add these to controllers/adminController.js =============

// Get User Details
exports.getUserDetails = async (req, res) => {
  try {
    const { id } = req.params;
    
    const user = await User.findById(id)
      .select('-password -otp')
      .populate('addresses');
    
    if (!user) {
      return ResponseHandler.error(res, 'User not found', 404);
    }
    
    // Get user's booking history
    const bookings = await Booking.find({ user: id })
      .populate('service provider')
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Get user's payment history
    const payments = await Payment.find({ user: id })
      .sort({ createdAt: -1 })
      .limit(10);
    
    ResponseHandler.success(res, { user, bookings, payments }, 'User details fetched successfully');
  } catch (error) {
    logger.error(`Get user details error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Update User Status
exports.updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    
    const user = await User.findByIdAndUpdate(
      id,
      { isActive },
      { new: true }
    ).select('-password -otp');
    
    if (!user) {
      return ResponseHandler.error(res, 'User not found', 404);
    }
    
    ResponseHandler.success(res, { user }, `User ${isActive ? 'activated' : 'deactivated'} successfully`);
  } catch (error) {
    logger.error(`Update user status error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Provider Details
exports.getProviderDetails = async (req, res) => {
  try {
    const { id } = req.params;
    
    const provider = await ServiceProvider.findById(id)
      .select('-password -otp');
    
    if (!provider) {
      return ResponseHandler.error(res, 'Provider not found', 404);
    }
    
    // Get provider's services
    const services = await Service.find({ provider: id })
      .sort({ createdAt: -1 });
    
    // Get provider's booking history
    const bookings = await Booking.find({ provider: id })
      .populate('user service')
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Get provider's earnings
    const earnings = await Payment.find({ 
      provider: id, 
      status: 'success' 
    });
    
    const totalEarnings = earnings.reduce((sum, payment) => sum + payment.amount, 0);
    
    ResponseHandler.success(res, { 
      provider, 
      services, 
      bookings, 
      totalEarnings 
    }, 'Provider details fetched successfully');
  } catch (error) {
    logger.error(`Get provider details error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get All Shops
exports.getAllShops = async (req, res) => {
  try {
    const { page = 1, limit = 20, verificationStatus, search, isActive } = req.query;
    
    const query = {};
    if (verificationStatus) query.verificationStatus = verificationStatus;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { ownerName: { $regex: search, $options: 'i' } }
      ];
    }
    
    const shops = await Shop.find(query)
      .select('-password -otp')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    
    const count = await Shop.countDocuments(query);
    
    ResponseHandler.paginated(res, shops, page, limit, count);
  } catch (error) {
    logger.error(`Get all shops error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Shop Details
exports.getShopDetails = async (req, res) => {
  try {
    const { id } = req.params;
    
    const shop = await Shop.findById(id)
      .select('-password -otp');
    
    if (!shop) {
      return ResponseHandler.error(res, 'Shop not found', 404);
    }
    
    // Get shop's products
    const products = await Product.find({ shop: id })
      .sort({ createdAt: -1 });
    
    // Get shop's orders
    const orders = await Booking.find({ 'products.shop': id })
      .populate('user')
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Get shop's earnings
    const earnings = await Payment.find({ 
      shop: id, 
      status: 'success' 
    });
    
    const totalEarnings = earnings.reduce((sum, payment) => sum + payment.amount, 0);
    
    ResponseHandler.success(res, { 
      shop, 
      products, 
      orders, 
      totalEarnings 
    }, 'Shop details fetched successfully');
  } catch (error) {
    logger.error(`Get shop details error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Verify Shop
exports.verifyShop = async (req, res) => {
  try {
    const { id } = req.params;
    
    const shop = await Shop.findByIdAndUpdate(
      id,
      {
        verificationStatus: 'approved',
        isActive: true,
        'documents.businessLicense.verified': true,
        'documents.gstCertificate.verified': true
      },
      { new: true }
    );
    
    if (!shop) {
      return ResponseHandler.error(res, 'Shop not found', 404);
    }
    
    // Send approval email
    if (shop.email) {
      await EmailService.sendEmail(
        shop.email,
        'Shop Approved - Zarvani',
        `<p>Congratulations ${shop.name}! Your shop has been approved and is now live.</p>`
      );
    }
    
    ResponseHandler.success(res, { shop }, 'Shop verified successfully');
  } catch (error) {
    logger.error(`Verify shop error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Reject Shop
exports.rejectShop = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const shop = await Shop.findByIdAndUpdate(
      id,
      {
        verificationStatus: 'rejected',
        rejectionReason: reason,
        isActive: false
      },
      { new: true }
    );
    
    if (!shop) {
      return ResponseHandler.error(res, 'Shop not found', 404);
    }
    
    // Send rejection email
    if (shop.email) {
      await EmailService.sendEmail(
        shop.email,
        'Shop Verification Update - Zarvani',
        `<p>Dear ${shop.name}, your shop application has been rejected. Reason: ${reason}</p>`
      );
    }
    
    ResponseHandler.success(res, { shop }, 'Shop rejected');
  } catch (error) {
    logger.error(`Reject shop error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get All Bookings
exports.getAllBookings = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      search,
      startDate,
      endDate 
    } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    if (search) {
      query.bookingId = { $regex: search, $options: 'i' };
    }
    
    const bookings = await Booking.find(query)
      .populate('user', 'name email phone')
      .populate('provider', 'name email phone')
      .populate('service', 'title category pricing')
      .populate('payment')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    
    const count = await Booking.countDocuments(query);
    
    ResponseHandler.paginated(res, bookings, page, limit, count);
  } catch (error) {
    logger.error(`Get all bookings error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Booking Details
exports.getBookingDetails = async (req, res) => {
  try {
    const { id } = req.params;
    
    const booking = await Booking.findById(id)
      .populate('user', 'name email phone profilePicture')
      .populate('provider', 'name email phone profilePicture ratings')
      .populate('service')
      .populate('payment')
      .populate('products.product')
      .populate('products.shop')
      .populate('shopOrderTracking.shop')
      .populate('shopOrderTracking.deliveryPartner');
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    ResponseHandler.success(res, { booking }, 'Booking details fetched successfully');
  } catch (error) {
    logger.error(`Get booking details error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
exports.addService = async (req, res) => {
  try {
    // Parse the service data from 'data' field
    const serviceData = JSON.parse(req.body.data);
    
    // Handle uploaded images from multer
    const uploadedImages = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        uploadedImages.push({
          url: file.path, // Cloudinary URL
          publicId: file.filename // Cloudinary public ID
        });
      });
    }
    
    // Combine uploaded images with service data
    const service = await Service.create({
      title: serviceData.title,
      description: serviceData.description,
      category: serviceData.category,
      subcategory: serviceData.subcategory,
      images: uploadedImages, // Only Cloudinary URLs
      pricing: serviceData.pricing,
      duration: serviceData.duration,
      serviceType: serviceData.serviceType,
      tags: serviceData.tags,
      isActive: serviceData.isActive
    });

    ResponseHandler.success(res, { service }, 'Service created successfully', 201);
  } catch (error) {
    logger.error(`Add service error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};


// Get All Services
exports.getServices = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      category, 
      search, 
      isActive,
      provider 
    } = req.query;

    const query = {};
    if (category) query.category = category;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    if (provider) query.provider = provider;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } }
      ];
    }

    const services = await Service.find(query)
      .populate('provider', 'name email phone profilePicture ratings')
      .populate('requiredProducts.product')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const count = await Service.countDocuments(query);

    ResponseHandler.paginated(res, services, page, limit, count);
  } catch (error) {
    logger.error(`Get services error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Service Details
exports.getServiceDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const service = await Service.findById(id)
      .populate('provider', 'name email phone profilePicture ratings verificationStatus')
      .populate('requiredProducts.product');

    if (!service) {
      return ResponseHandler.error(res, 'Service not found', 404);
    }

    // Get booking statistics for this service
    const bookingStats = await Booking.aggregate([
      { $match: { service: new mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get total revenue from this service
    const revenue = await Payment.aggregate([
      {
        $lookup: {
          from: 'bookings',
          localField: 'booking',
          foreignField: '_id',
          as: 'bookingDetails'
        }
      },
      { $unwind: '$bookingDetails' },
      {
        $match: {
          'bookingDetails.service': new mongoose.Types.ObjectId(id),
          status: 'success'
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          totalBookings: { $sum: 1 }
        }
      }
    ]);

    ResponseHandler.success(res, {
      service,
      bookingStats,
      revenue: revenue[0] || { totalRevenue: 0, totalBookings: 0 }
    }, 'Service details fetched successfully');
  } catch (error) {
    logger.error(`Get service details error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Update Service
exports.updateService = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Parse the service data from 'data' field
    const serviceData = JSON.parse(req.body.data);
    
    // Get existing service
    const existingService = await Service.findById(id);
    if (!existingService) {
      return ResponseHandler.error(res, 'Service not found', 404);
    }
    
    // Handle new uploaded images
    const newUploadedImages = [];
    if (req.files && req.files.length > 0) {
      req.files.forEach(file => {
        newUploadedImages.push({
          url: file.path, // Cloudinary URL
          publicId: file.filename // Cloudinary public ID
        });
      });
    }
    
    // Combine existing images (from serviceData.existingImages) with new uploads
    const finalImages = [
      ...(serviceData.existingImages || []), // Keep old images that weren't deleted
      ...newUploadedImages // Add new uploaded images
    ];
    
    // Find images that were removed (to delete from Cloudinary)
    const removedImages = existingService.images.filter(oldImg => 
      !finalImages.some(newImg => newImg.publicId === oldImg.publicId)
    );
    
    // Delete removed images from Cloudinary
    for (const img of removedImages) {
      if (img.publicId) {
        await deleteFromCloudinary(img.publicId);
      }
    }
    
    // Update service
    const service = await Service.findByIdAndUpdate(
      id,
      {
        title: serviceData.title,
        description: serviceData.description,
        category: serviceData.category,
        subcategory: serviceData.subcategory,
        images: finalImages, // Updated images array
        pricing: serviceData.pricing,
        duration: serviceData.duration,
        serviceType: serviceData.serviceType,
        tags: serviceData.tags,
        isActive: serviceData.isActive
      },
      { new: true, runValidators: true }
    )

    ResponseHandler.success(res, { service }, 'Service updated successfully');
  } catch (error) {
    logger.error(`Update service error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
// Delete Service
exports.deleteService = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if service has any active bookings
    const activeBookings = await Booking.countDocuments({
      service: id,
      status: { $in: ['pending', 'confirmed', 'in-progress'] }
    });

    if (activeBookings > 0) {
      return ResponseHandler.error(
        res,
        'Cannot delete service with active bookings. Please complete or cancel all bookings first.',
        400
      );
    }
    const service = await Service.findByIdAndDelete(id);
   
    if (!service) {
      return ResponseHandler.error(res, 'Service not found', 404);
    }

    ResponseHandler.success(res, null, 'Service deleted successfully');
  } catch (error) {
    logger.error(`Delete service error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Toggle Service Status
exports.toggleServiceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    
    const service = await Service.findById(id);
    
    if (!service) {
      return ResponseHandler.error(res, 'Service not found', 404);
    }

    service.isActive = !service.isActive;
    await service.save();

    ResponseHandler.success(
      res,
      { service },
      `Service ${service.isActive ? 'activated' : 'deactivated'} successfully`
    );
  } catch (error) {
    logger.error(`Toggle service status error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Service Categories (Enum values)
exports.getServiceCategories = async (req, res) => {
  try {
    const categories = [
      "plumbing",
      "electrical",
      "carpentry",
      "painting",
      "cleaning",
      "gardening",
      "home-appliance-repair",
      "computer-repair",
      "home-renovation",
      "interior-design",
      "pest-control",
      "hvac-repair",
      "salon-services",
      "beauty-services",
      "tutoring",
      "legal-services",
      "catering",
      "photography",
      "event-planning",
      "flooring-and-tile",
      "wall-panels-and-panelling",
      "water-purifier-installation",
      "ac-service",
      "sofa-and-carpet-cleaning",
      "maid-service",
      "home-moving-and-packers",
      "fitness-and-yoga-trainer",
      "home-health-care",
      "driver-and-chauffeur",
      "native-product-installation",
      "furniture-assembly",
      "shifting-and-relocation",
      "bike-or-vehicle-repair",
      "accounting-and-tax-services",
      "dry-cleaning-and-laundry",
      "baby-or-child-care",
      "elder-care",
      "pet-grooming",
      "other"
    ];

    // Get count of services per category
    const categoryCounts = await Service.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          avgPrice: { $avg: '$pricing.basePrice' }
        }
      }
    ]);

    const categoriesWithStats = categories.map(cat => {
      const stats = categoryCounts.find(c => c._id === cat);
      return {
        name: cat,
        displayName: cat.split('-').map(word => 
          word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' '),
        count: stats?.count || 0,
        avgPrice: stats?.avgPrice || 0
      };
    });

    ResponseHandler.success(res, categoriesWithStats, 'Service categories fetched successfully');
  } catch (error) {
    logger.error(`Get service categories error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

exports.getAllTransactions = async (req, res) => {
  try {
    // Check Access
    if (!["admin", "superadmin"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Only admin or superadmin can view transactions."
      });
    }

    // Filters
    const { 
      paymentMethod, 
      status, 
      provider, 
      shop, 
      user, 
      startDate, 
      endDate,
      search
    } = req.query;

    const filter = {};

    // Filter by payment method
    if (paymentMethod) filter.paymentMethod = paymentMethod;

    // Filter by payment status
    if (status) filter.status = status;

    // Filter by provider
    if (provider) filter.provider = mongoose.Types.ObjectId(provider);

    // Filter by shop
    if (shop) filter.shop = mongoose.Types.ObjectId(shop);

    // Filter by user
    if (user) filter.user = mongoose.Types.ObjectId(user);

    // Filter by date range
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // Search by transactionId or gatewayTransactionId
    if (search) {
      filter.$or = [
        { transactionId: { $regex: search, $options: "i" } },
        { gatewayTransactionId: { $regex: search, $options: "i" } }
      ];
    }

    // Pagination
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 20;
    let skip = (page - 1) * limit;

    // Fetch Payments
    const payments = await Payment.find(filter)
      .populate("user", "name email phone")
      .populate("provider", "name email phone serviceName")
      .populate("shop", "shopName owner email phone")
      .populate("booking", "serviceName bookingDate status")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Payment.countDocuments(filter);

    return res.status(200).json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      payments
    });

  } catch (error) {
    console.error("Get All Transactions Error → ", error);

    return res.status(500).json({
      success: false,
      message: "Server error while fetching transactions",
      error: error.message
    });
  }
};