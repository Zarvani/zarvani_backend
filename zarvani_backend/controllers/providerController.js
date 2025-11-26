// ============= controllers/providerController.js =============
const ServiceProvider = require('../models/ServiceProvider');
const { Service } =require("../models/Service")
const ResponseHandler = require('../utils/responseHandler');
// Get Provider Profile
exports.getProfile = async (req, res) => {
  try {
    const provider = await ServiceProvider.findById(req.user._id);
    ResponseHandler.success(res, { provider }, 'Profile fetched successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Update Provider Profile
exports.updateProfile = async (req, res) => {
  try {
    const { name, email, experience, specializations, workingHours, bankDetails } = req.body;
    const updates = {};
    
    if (name) updates.name = name;
    if (email) updates.email = email;
    if (experience) updates.experience = experience;
    if (specializations) updates.specializations = specializations;
    if (workingHours) updates.workingHours = workingHours;
    if (bankDetails) updates.bankDetails = bankDetails;
    
    if (req.file) {
      if (req.user.profilePicture?.publicId) {
        await deleteFromCloudinary(req.user.profilePicture.publicId);
      }
      updates.profilePicture = {
        url: req.file.path,
        publicId: req.file.filename
      };
    }
    
    const provider = await ServiceProvider.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    );
    
    ResponseHandler.success(res, { provider }, 'Profile updated successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Upload Documents
exports.uploadDocuments = async (req, res) => {
  try {
    const provider = await ServiceProvider.findById(req.user._id);
    
    if (req.files) {
      if (req.files.idProof) {
        if (provider.documents.idProof?.document?.publicId) {
          await deleteFromCloudinary(provider.documents.idProof.document.publicId);
        }
        provider.documents.idProof = {
          ...req.body.idProofDetails,
          document: {
            url: req.files.idProof[0].path,
            publicId: req.files.idProof[0].filename
          }
        };
      }
      
      if (req.files.addressProof) {
        if (provider.documents.addressProof?.document?.publicId) {
          await deleteFromCloudinary(provider.documents.addressProof.document.publicId);
        }
        provider.documents.addressProof = {
          document: {
            url: req.files.addressProof[0].path,
            publicId: req.files.addressProof[0].filename
          }
        };
      }
      
      if (req.files.policeClearance) {
        if (provider.documents.policeClearance?.document?.publicId) {
          await deleteFromCloudinary(provider.documents.policeClearance.document.publicId);
        }
        provider.documents.policeClearance = {
          document: {
            url: req.files.policeClearance[0].path,
            publicId: req.files.policeClearance[0].filename
          }
        };
      }
    }
    
    await provider.save();
    
    ResponseHandler.success(res, { documents: provider.documents }, 'Documents uploaded successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Add Service
exports.addService = async (req, res) => {
  try {
    const { title, description, category, pricing, duration } = req.body;
    
    const serviceData = {
      provider: req.user._id,
      title,
      description,
      category,
      pricing,
      duration
    };
    
    if (req.files && req.files.length > 0) {
      serviceData.images = req.files.map(file => ({
        url: file.path,
        publicId: file.filename
      }));
    }
    
    // Add provider's location
    if (req.user.address?.location) {
      serviceData.location = req.user.address.location;
    }
    
    const service = await Service.create(serviceData);
    
    ResponseHandler.success(res, { service }, 'Service added successfully', 201);
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get My Services
exports.getMyServices = async (req, res) => {
  try {
    const services = await Service.find({ provider: req.user._id });
    ResponseHandler.success(res, { services }, 'Services fetched successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Bookings
exports.getBookings = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const query = { provider: req.user._id };
    if (status) query.status = status;
    
    const bookings = await Booking.find(query)
      .populate('user service')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Booking.countDocuments(query);
    
    ResponseHandler.paginated(res, bookings, page, limit, count);
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Update Booking Status
exports.updateBookingStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status, completionNotes } = req.body;
    
    const booking = await Booking.findOne({
      _id: bookingId,
      provider: req.user._id
    });
    
    if (!booking) {
      return ResponseHandler.error(res, 'Booking not found', 404);
    }
    
    booking.status = status;
    if (completionNotes) booking.completionNotes = completionNotes;
    if (status === 'completed') {
      booking.completedAt = new Date();
      
      // Update provider stats
      await ServiceProvider.findByIdAndUpdate(req.user._id, {
        $inc: { completedServices: 1 }
      });
    }
    
    await booking.save();
    
    // Send notification to user
    const NotificationService = require('../services/pushNotification');
    await NotificationService.sendToUser(
      booking.user,
      'Booking Status Updated',
      `Your booking status has been updated to ${status}`
    );
    
    ResponseHandler.success(res, { booking }, 'Booking status updated successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};
