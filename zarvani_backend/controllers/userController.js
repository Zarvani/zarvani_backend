// ============= controllers/userController.js =============
const User = require('../models/User');
const Booking =require("../models/Booking")
const { Review } = require('../models/Review');
const ResponseHandler = require('../utils/responseHandler');
const { deleteFromCloudinary } = require('../middleware/uploadMiddleware');
const GeoService = require('../services/geoService');

// Get User Profile
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    ResponseHandler.success(res, { user }, 'Profile fetched successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Update Profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, email, preferences } = req.body;
    const updates = {};
    
    if (name) updates.name = name;
    if (email) updates.email = email;
    if (preferences) updates.preferences = preferences;
    
    if (req.file) {
      // Delete old profile picture
      if (req.user.profilePicture?.publicId) {
        await deleteFromCloudinary(req.user.profilePicture.publicId);
      }
      
      updates.profilePicture = {
        url: req.file.path,
        publicId: req.file.filename
      };
    }
    
    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    );
    
    ResponseHandler.success(res, { user }, 'Profile updated successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Add Address
exports.addAddress = async (req, res) => {
  try {
    const address = req.body;
    
    // Get coordinates
    const geoResult = await GeoService.getCoordinatesFromAddress(address);
    if (geoResult.success) {
      address.location = {
        type: 'Point',
        coordinates: geoResult.coordinates
      };
    }
    
    const user = await User.findById(req.user._id);
    
    // If this is the first address or marked as default
    if (user.addresses.length === 0 || address.isDefault) {
      user.addresses.forEach(addr => addr.isDefault = false);
      address.isDefault = true;
    }
    
    user.addresses.push(address);
    await user.save();
    
    ResponseHandler.success(res, { addresses: user.addresses }, 'Address added successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Booking History
exports.getBookingHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const query = { user: req.user._id };
    if (status) query.status = status;
    
    const bookings = await Booking.find(query)
      .populate('service provider')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Booking.countDocuments(query);
    
    ResponseHandler.paginated(res, bookings, page, limit, count);
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Submit Review
exports.submitReview = async (req, res) => {
  try {
    const { booking, provider, shop, product, rating, comment } = req.body;
    
    const review = await Review.create({
      user: req.user._id,
      booking,
      provider,
      shop,
      product,
      rating,
      comment,
      isVerifiedPurchase: !!booking
    });
    
    // Update average rating
    if (provider) {
      const Provider = require('../models/ServiceProvider');
      const reviews = await Review.find({ provider });
      const avgRating = reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length;
      await Provider.findByIdAndUpdate(provider, {
        'ratings.average': avgRating,
        'ratings.count': reviews.length
      });
    }
    
    ResponseHandler.success(res, { review }, 'Review submitted successfully', 201);
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};