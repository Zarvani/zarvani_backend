// ============= controllers/userController.js =============
const User = require('../models/User');
const Booking = require("../models/Booking")
const { Review } = require('../models/Review');
const ResponseHandler = require('../utils/responseHandler');
const { deleteFromCloudinary } = require('../middleware/uploadMiddleware');
const GeoService = require('../services/geoService');
const Service = require('../models/Service'); 
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
    const userId = req.user._id;
    const addressData = req.body;

    // Get geo coordinates
    const geoResult = await GeoService.getCoordinatesFromAddress(addressData);
    if (geoResult?.success) {
      addressData.location = {
        type: 'Point',
        coordinates: geoResult.coordinates // [lng, lat]
      };
    }

    const user = await User.findById(userId);

    // First address → default
    if (user.addresses.length === 0) {
      addressData.isDefault = true;
    }

    user.addresses.push(addressData);
    await user.save();

    ResponseHandler.success(res, user.addresses, 'Address added successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};
exports.updateAddress = async (req, res) => {
  try {
    const userId = req.user._id;
    const { addressId } = req.params;
    const updateData = req.body;

    const user = await User.findById(userId);

    const address = user.addresses.id(addressId);
    if (!address) {
      return ResponseHandler.error(res, 'Address not found', 404);
    }

    // Update geo if address changed
    const geoResult = await GeoService.getCoordinatesFromAddress(updateData);
    if (geoResult?.success) {
      updateData.location = {
        type: 'Point',
        coordinates: geoResult.coordinates
      };
    }

    Object.assign(address, updateData);

    // If set as default
    if (updateData.isDefault) {
      user.addresses.forEach(addr => {
        if (addr._id.toString() !== addressId) {
          addr.isDefault = false;
        }
      });
    }

    await user.save();

    ResponseHandler.success(res, user.addresses, 'Address updated successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};
exports.setDefaultAddress = async (req, res) => {
  try {
    const userId = req.user._id;
    const { addressId } = req.params;

    const user = await User.findById(userId);

    let found = false;
    user.addresses.forEach(addr => {
      if (addr._id.toString() === addressId) {
        addr.isDefault = true;
        found = true;
      } else {
        addr.isDefault = false;
      }
    });

    if (!found) {
      return ResponseHandler.error(res, 'Address not found', 404);
    }

    await user.save();
    ResponseHandler.success(res, user.addresses, 'Default address updated');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};
exports.deleteAddress = async (req, res) => {
  try {
    const userId = req.user._id;
    const { addressId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return ResponseHandler.error(res, 'User not found', 404);
    }

    const address = user.addresses.id(addressId);
    if (!address) {
      return ResponseHandler.error(res, 'Address not found', 404);
    }

    const wasDefault = address.isDefault;

    // ✅ Correct way to remove subdocument
    user.addresses.pull(addressId);

    // ✅ If deleted address was default → set first address as default
    if (wasDefault && user.addresses.length > 0) {
      user.addresses[0].isDefault = true;
    }

    await user.save();

    return ResponseHandler.success(
      res,
      user.addresses,
      'Address deleted successfully'
    );
  } catch (error) {
    return ResponseHandler.error(res, error.message, 500);
  }
};

exports.getAddresses = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    const addresses = user.addresses.sort(
      (a, b) => b.isDefault - a.isDefault
    );

    ResponseHandler.success(res, addresses, 'Addresses fetched');
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
exports.getServices = async (req, res) => {
  try {
    let { page = 1, limit = 100, sortBy = "createdAt", order = "desc" } = req.query;

    page = Number(page);
    limit = Number(limit);
    const sortOrder = order === "asc" ? 1 : -1;

    const services = await Service.find()
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit);

    const total = await Service.countDocuments();

    return res.status(200).json({
      success: true,
      message: "Services fetched successfully",
      page,
      limit,
      total,
      data: services
    });

  } catch (error) {
    console.error("Error fetching services:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message
    });
  }
};
// Add this to your backend routes
exports.getServiceById = async (req, res) => {
  try {
    const { id } = req.params;

    const service = await Service.findById(id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Service fetched successfully",
      data: service
    });

  } catch (error) {
    console.error("Error fetching service:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong",
      error: error.message
    });
  }
};
exports.getServicesByCategory = async (req, res) => {
  try {
    const { category } = req.query;

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required"
      });
    }

    const services = await Service.find({ category })
      .select("-provider -requiredProducts -__v")
      .lean();

    // If no services → return empty array but success = true
    if (services.length === 0) {
      return res.status(200).json({
        success: true,
        category,
        services: []  // empty list
      });
    }

    return res.status(200).json({
      success: true,
      category,
      services
    });

  } catch (error) {
    console.error("Error fetching services:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};
