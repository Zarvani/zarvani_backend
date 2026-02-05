const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const ServiceProvider = require('../models/ServiceProvider');
const Shop = require('../models/Shop');
const { Admin } = require('../models/Admin');
const EmailService = require('../services/emailService');
const SMSService = require('../services/smsService');
const ResponseHandler = require('../utils/responseHandler');
const getAddressFromCoords = require('../utils/getAddressFromCoords')
const logger = require('../utils/logger');
const redisClient = require("../config/passport");
const otpQueue = require('../queues/otpQueue');
// Generate JWT Token
const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE
  });
};

// Generate Refresh Token
const generateRefreshToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRE
  });
};
// ---------------------------------------------
// OTP for Signup (New User Verification)
// ---------------------------------------------
exports.sendSignupOTP = async (req, res) => {
  try {
    const { identifier } = req.body;

    // Validate input
    if (!identifier || typeof identifier !== "string") {
      return ResponseHandler.error(res, "Identifier is required", 400);
    }

    const isEmail = identifier.includes("@");

    // ✅ Rate Limiting for OTP Identifier (Max 3 per 10 min)
    const rateLimitKey = `ratelimit:otp:${identifier}`;
    const otpRequests = await redisClient.get(rateLimitKey);
    if (otpRequests && parseInt(otpRequests) >= 3) {
      return ResponseHandler.error(res, "Too many OTP requests. Please try again later.", 429);
    }

    const otp = crypto.randomInt(100000, 999999).toString();

    // Store OTP in Redis for 10 min
    await redisClient.setEx(`otp:signup:${identifier}`, 600, otp);

    // Increment rate limit counter
    if (!otpRequests) {
      await redisClient.setEx(rateLimitKey, 600, "1");
    } else {
      await redisClient.incr(rateLimitKey);
    }

    // ✅ OPTIMIZATION: Queue OTP sending (non-blocking)
    await otpQueue.add('send-otp', {
      identifier,
      otp,
      name: "New User",
      type: isEmail ? 'email' : 'sms'
    }, {
      priority: 1, // High priority
      delay: 0 // Send immediately
    });

    logger.info(`OTP queued for ${identifier}`);

    return ResponseHandler.success(
      res,
      { message: "Signup OTP sent" },
      "OTP sent successfully"
    );

  } catch (err) {
    logger.error(`Signup OTP Error: ${err.message}`);
    return ResponseHandler.error(res, err.message, 500);
  }
};

// Send OTP
exports.sendOTP = async (req, res) => {
  try {
    const { identifier, role = 'user' } = req.body;

    let Model;
    if (role === 'user') Model = User;
    else if (role === 'provider') Model = ServiceProvider;
    else if (role === 'shop') Model = Shop;
    else return ResponseHandler.error(res, 'Invalid role', 400);

    // Check if identifier is email or phone
    const isEmail = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/.test(identifier);
    const query = isEmail ? { email: identifier } : { phone: identifier };

    let user = await Model.findOne(query);

    if (!user) {
      return ResponseHandler.error(res, 'User not found. Please sign up first.', 404);
    }

    // ✅ Rate Limiting for OTP Identifier (Max 3 per 10 min)
    const rateLimitKey = `ratelimit:otp:${identifier}`;
    const otpRequests = await redisClient.get(rateLimitKey);
    if (otpRequests && parseInt(otpRequests) >= 3) {
      return ResponseHandler.error(res, "Too many OTP requests. Please try again later.", 429);
    }

    // Generate and save OTP
    const otp = user.generateOTP();
    await user.save();

    // Increment rate limit counter
    if (!otpRequests) {
      await redisClient.setEx(rateLimitKey, 600, "1");
    } else {
      await redisClient.incr(rateLimitKey);
    }

    // ✅ OPTIMIZATION: Queue OTP sending (non-blocking)
    let sentTo = [];

    if (isEmail) {
      await otpQueue.add('send-otp', {
        identifier,
        otp,
        name: user.name,
        type: 'email'
      }, { priority: 1 });
      sentTo.push('email');

      // If user has a phone, send to phone as well
      if (user.phone) {
        await otpQueue.add('send-otp', {
          identifier: user.phone,
          otp,
          name: user.name,
          type: 'sms'
        }, { priority: 1 });
        sentTo.push('phone');
      }
    } else {
      await otpQueue.add('send-otp', {
        identifier,
        otp,
        name: user.name,
        type: 'sms'
      }, { priority: 1 });
      sentTo.push('phone');

      // If user has email, send to email as well
      if (user.email) {
        await otpQueue.add('send-otp', {
          identifier: user.email,
          otp,
          name: user.name,
          type: 'email'
        }, { priority: 1 });
        sentTo.push('email');
      }
    }

    logger.info(`OTP queued for ${identifier} (${sentTo.join(', ')})`);

    return ResponseHandler.success(
      res,
      {
        message: `OTP sent to ${sentTo.join(' and ')}`,
        sentTo
      },
      'OTP sent successfully'
    );

  } catch (error) {
    logger.error(`Send OTP error: ${error.message}`);
    return ResponseHandler.error(res, error.message, 500);
  }
};

// Signup with Email/Phone
exports.signup = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      role = "user",
      coordinates
    } = req.body;

    // --------------------------------------
    // 1️⃣ PARSE JSON STRINGS FROM FORMDATA
    // --------------------------------------
    let address, experience, documents, serviceCategories, specializations;
    let ownerName, gstNumber, categories;

    try {
      // Parse JSON fields
      if (req.body.address) address = JSON.parse(req.body.address);
      if (req.body.experience) experience = JSON.parse(req.body.experience);
      if (req.body.documents) documents = JSON.parse(req.body.documents);
      if (req.body.serviceCategories) serviceCategories = JSON.parse(req.body.serviceCategories);
      if (req.body.specializations) specializations = JSON.parse(req.body.specializations);
      if (req.body.categories) categories = JSON.parse(req.body.categories);
    } catch (parseErr) {
      logger.error(`JSON Parse Error: ${parseErr.message}`);
      return ResponseHandler.error(res, "Invalid JSON data in request", 400);
    }

    // Shop fields (plain text, no parsing needed)
    if (req.body.ownerName) ownerName = req.body.ownerName;
    if (req.body.gstNumber) gstNumber = req.body.gstNumber;

    // --------------------------------------
    // 2️⃣ SELECT MODEL BASED ON ROLE
    // --------------------------------------
    let Model;
    if (role === "user") Model = User;
    else if (role === "provider") Model = ServiceProvider;
    else if (role === "shop") Model = Shop;
    else return ResponseHandler.error(res, "Invalid role", 400);

    // --------------------------------------
    // 3️⃣ CHECK IF USER ALREADY EXISTS
    // --------------------------------------
    const existing = await Model.findOne({
      $or: [
        { phone },
        ...(email ? [{ email }] : [])
      ]
    });

    if (existing) {
      return ResponseHandler.error(
        res,
        "User already exists with this email or phone",
        400
      );
    }

    // --------------------------------------
    // 4️⃣ PREPARE BASE USER DATA
    // --------------------------------------
    const userData = {
      name,
      phone,
      password,
      role,
      phoneVerified: true, // Since OTP was verified
    };

    if (email) userData.email = email;
    if (role === "user") {
      if (coordinates && coordinates.latitude && coordinates.longitude) {
        const autoAddress = await getAddressFromCoords(
          coordinates.latitude,
          coordinates.longitude
        );

        if (autoAddress) {
          userData.addresses = [autoAddress];  // Save inside addresses[]
        }
      }
    }
    // --------------------------------------
    // 5️⃣ PROVIDER-SPECIFIC DATA
    // --------------------------------------
    if (role === "provider") {
      // Service Categories
      if (serviceCategories && Array.isArray(serviceCategories)) {
        userData.serviceCategories = serviceCategories;
      }

      // Specializations
      if (specializations && Array.isArray(specializations)) {
        userData.specializations = specializations;
      }

      // Experience
      if (experience) {
        userData.experience = {
          years: parseInt(experience.years) || 0,
          description: experience.description || ""
        };
      }

      // Address with Location
      if (address) {
        userData.address = {
          addressLine1: address.addressLine1,
          addressLine2: address.addressLine2 || "",
          city: address.city,
          state: address.state,
          country: address.country,
          pincode: address.pincode,
          location: {
            type: "Point",
            coordinates: address.location?.coordinates || [0, 0]
          }
        };
      }

      // Documents with uploaded file
      if (documents && req.files && req.files.idProof) {
        const idProofFile = req.files.idProof[0];
        userData.documents = {
          idProof: {
            type: documents.idProof?.type || "",
            number: documents.idProof?.number || "",
            document: {
              url: idProofFile.path, // Cloudinary URL
              publicId: idProofFile.filename // Cloudinary public ID
            },
            verified: false
          }
        };
      }
    }

    // --------------------------------------
    // 6️⃣ SHOP-SPECIFIC DATA
    // --------------------------------------
    if (role === "shop") {
      userData.ownerName = ownerName;

      if (gstNumber) userData.gstNumber = gstNumber;

      // Categories
      if (categories && Array.isArray(categories)) {
        userData.categories = categories;
      }

      // Address with Location
      if (address) {
        userData.address = {
          addressLine1: address.addressLine1,
          addressLine2: address.addressLine2 || "",
          city: address.city,
          state: address.state,
          country: address.country,
          pincode: address.pincode,
          location: {
            type: "Point",
            coordinates: address.location?.coordinates || [0, 0]
          }
        };
      }

      // Documents
      userData.documents = {};

      if (req.files && req.files.businessLicense) {
        const licenseFile = req.files.businessLicense[0];
        userData.documents.businessLicense = {
          url: licenseFile.path,
          publicId: licenseFile.filename,
          verified: false
        };
      }

      if (req.files && req.files.gstCertificate) {
        const gstFile = req.files.gstCertificate[0];
        userData.documents.gstCertificate = {
          url: gstFile.path,
          publicId: gstFile.filename,
          verified: false
        };
      }
    }

    // --------------------------------------
    // 7️⃣ CREATE USER IN DATABASE
    // --------------------------------------
    const user = await Model.create(userData);

    // Generate token
    const token = generateToken(user._id, role);

    // Remove sensitive fields
    const userObj = user.toObject();
    delete userObj.password;

    // --------------------------------------
    // 8️⃣ SEND RESPONSE
    // --------------------------------------
    ResponseHandler.success(
      res,
      {
        user: userObj,
        token,
        message: "Registration successful"
      },
      "Signup success",
      201
    );

    // --------------------------------------
    // 9️⃣ BACKGROUND TASK — SEND EMAILS
    // --------------------------------------
    // ✅ OPTIMIZATION: Queue welcome email (non-blocking)
    if (email) {
      await otpQueue.add('send-welcome-email', {
        email,
        name,
        role
      }, { priority: 2 }); // Lower priority than OTP
    }

  } catch (err) {
    logger.error(`Signup error: ${err.message}`);

    // Delete uploaded files if registration fails
    if (req.files) {
      try {
        const { deleteFromCloudinary } = require('../middleware/uploadMiddleware');

        if (req.files.idProof && req.files.idProof[0]) {
          await deleteFromCloudinary(req.files.idProof[0].filename);
        }
        if (req.files.businessLicense && req.files.businessLicense[0]) {
          await deleteFromCloudinary(req.files.businessLicense[0].filename);
        }
        if (req.files.gstCertificate && req.files.gstCertificate[0]) {
          await deleteFromCloudinary(req.files.gstCertificate[0].filename);
        }
      } catch (deleteErr) {
        logger.error(`Error deleting files: ${deleteErr.message}`);
      }
    }

    return ResponseHandler.error(res, err.message, 500);
  }
};


exports.verifySignupOTP = async (req, res) => {
  try {
    const { identifier, otp, name, role = 'user', password, ...otherData } = req.body;

    // Validate required fields
    if (!identifier || !otp || !name) {
      return ResponseHandler.error(res, "Identifier, OTP, and name are required", 400);
    }

    // Verify OTP from Redis
    const storedOTP = await redisClient.get(`otp:signup:${identifier}`);

    if (!storedOTP) {
      return ResponseHandler.error(res, "OTP expired or invalid", 400);
    }

    if (storedOTP !== otp) {
      return ResponseHandler.error(res, "Invalid OTP", 400);
    }

    // Delete OTP after verification
    await redisClient.del(`otp:signup:${identifier}`);

    // Determine model based on role
    let Model;
    if (role === 'user') Model = User;
    else if (role === 'provider') Model = ServiceProvider;
    else if (role === 'shop') Model = Shop;
    else return ResponseHandler.error(res, 'Invalid role', 400);

    const isEmail = identifier.includes("@");
    const query = isEmail ? { email: identifier } : { phone: identifier };

    // Check if user already exists
    let user = await Model.findOne(query);
    if (user) {
      return ResponseHandler.error(res, "User already exists", 400);
    }

    // Create new user
    const userData = {
      name,
      ...otherData
    };

    if (isEmail) {
      userData.email = identifier;
    } else {
      userData.phone = identifier;
    }

    if (password) {
      userData.password = password;
    }

    user = await Model.create(userData);

    // Generate tokens
    const token = generateToken(user._id, role);
    const refreshToken = generateRefreshToken(user._id, role);

    // ✅ OPTIMIZATION: Queue welcome email (non-blocking)
    if (user.email) {
      await otpQueue.add('send-welcome-email', {
        email: user.email,
        name: user.name,
        role
      }, { priority: 2 }); // Lower priority than OTP
    }

    logger.info(`User ${user._id} signed up successfully`);

    return ResponseHandler.success(
      res,
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role
        },
        token,
        refreshToken
      },
      "Signup successful",
      201
    );

  } catch (error) {
    logger.error(`Verify signup OTP error: ${error.message}`);
    return ResponseHandler.error(res, error.message, 500);
  }
};



// Verify OTP
exports.verifyOTP = async (req, res) => {
  try {
    const { identifier, otp, role = 'user' } = req.body;

    let Model;
    if (role === 'user') Model = User;
    else if (role === 'provider') Model = ServiceProvider;
    else if (role === 'shop') Model = Shop;
    else return ResponseHandler.error(res, 'Invalid role', 400);

    const isEmail = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(identifier);
    const query = isEmail ? { email: identifier } : { phone: identifier };

    const user = await Model.findOne(query);

    if (!user) {
      return ResponseHandler.error(res, 'User not found', 404);
    }

    // Verify OTP
    const isValid = user.verifyOTP(otp);

    if (!isValid) {
      user.otp.attempts += 1;
      await user.save();

      if (user.otp.attempts >= 5) {
        return ResponseHandler.error(res, 'Maximum OTP attempts reached. Please request a new OTP.', 400);
      }

      return ResponseHandler.error(res, 'Invalid or expired OTP', 400);
    }

    // Mark as verified
    if (isEmail) {
      user.emailVerified = true;
    } else {
      user.phoneVerified = true;
    }

    user.otp = undefined;
    await user.save();

    // Generate tokens
    const token = generateToken(user._id, role);
    const refreshToken = generateRefreshToken(user._id, role);

    // Remove sensitive data
    user.password = undefined;

    ResponseHandler.success(res, {
      user,
      token,
      refreshToken
    }, 'OTP verified successfully');
  } catch (error) {
    logger.error(`Verify OTP error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Login with Email/Phone and Password
exports.loginWithPassword = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return ResponseHandler.error(res, "Identifier and password are required", 400);
    }

    const isEmail = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(identifier);
    const query = isEmail ? { email: identifier } : { phone: identifier };

    let user = null;
    let role = null;

    // AUTO DETECT ROLE
    user = await User.findOne(query).select("+password");
    if (user) role = "user";

    if (!user) {
      user = await ServiceProvider.findOne(query).select("+password");
      if (user) role = "provider";
    }

    if (!user) {
      user = await Shop.findOne(query).select("+password");
      if (user) role = "shop";
    }
    if (!user) {
      user = await Admin.findOne(query).select("+password");
      if (user) {
        if (user.role === "admin" || user.role === "superadmin") {
          role = user.role; // assign actual admin/superadmin role
        } else {
          return ResponseHandler.error(res, "Unauthorized admin role", 403);
        }
      }
    }
    if (!user) {
      return ResponseHandler.error(res, "User not found", 404);
    }

    // Check Password
    const match = await user.comparePassword(password);
    if (!match) {
      return ResponseHandler.error(res, "Invalid password", 401);
    }

    // Generate token
    const token = generateToken(user._id, role);
    const refreshToken = generateRefreshToken(user._id, role);

    return ResponseHandler.success(
      res,
      {
        message: "Login successful",
        token,
        refreshToken,
        role,
        user,
      },
      "Logged in successfully"
    );

  } catch (error) {
    logger.error(`LoginWithPassword Error: ${error.message}`);
    return ResponseHandler.error(res, error.message, 500);
  }
};
// Login with OTP
exports.loginWithOTP = async (req, res) => {
  try {
    const { identifier } = req.body;

    if (!identifier) {
      return ResponseHandler.error(res, "Identifier is required", 400);
    }

    const isEmail = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(identifier);
    const query = isEmail ? { email: identifier } : { phone: identifier };

    let user = null;
    let role = null;

    // AUTO-DETECT ROLE
    user = await User.findOne(query);
    if (user) role = "user";

    if (!user) {
      user = await ServiceProvider.findOne(query);
      if (user) role = "provider";
    }

    if (!user) {
      user = await Shop.findOne(query);
      if (user) role = "shop";
    }

    if (!user) {
      return ResponseHandler.error(res, "User not found. Please sign up first.", 404);
    }

    // Generate & Save OTP
    const otp = user.generateOTP();
    await user.save();

    // Send OTP
    let sentTo = [];
    if (isEmail) {
      await EmailService.sendOTP(identifier, otp, user.name);
      sentTo.push("email");
      if (user.phone) {
        await SMSService.sendOTP(user.phone, otp, user.name);
        sentTo.push("phone");
      }
    } else {
      await SMSService.sendOTP(identifier, otp, user.name);
      sentTo.push("phone");
      if (user.email) {
        await EmailService.sendOTP(user.email, otp, user.name);
        sentTo.push("email");
      }
    }

    return ResponseHandler.success(
      res,
      {
        message: `OTP sent successfully to ${sentTo.join(" and ")}. Please verify to login.`,
        role
      },
      "OTP sent successfully"
    );

  } catch (error) {
    logger.error(`LoginWithOTP Error: ${error.message}`);
    return ResponseHandler.error(res, error.message, 500);
  }
};

exports.verifyloginWithOTP = async (req, res) => {
  try {
    const { identifier, otp, role } = req.body;

    if (!identifier || !otp) {
      return ResponseHandler.error(res, "Identifier and OTP required", 400);
    }

    let Model;
    if (role === 'user') Model = User;
    else if (role === 'provider') Model = ServiceProvider;
    else if (role === 'shop') Model = Shop;
    else return ResponseHandler.error(res, "Invalid role", 400);

    const isEmail = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(identifier);
    const query = isEmail ? { email: identifier } : { phone: identifier };

    const user = await Model.findOne(query).select("+otp");

    if (!user) {
      return ResponseHandler.error(res, "User not found", 404);
    }

    // Validate OTP
    const isValid = user.verifyOTP(otp);
    if (!isValid) {
      return ResponseHandler.error(res, "Invalid or expired OTP", 400);
    }

    // Mark verified
    if (isEmail) user.emailVerified = true;
    else user.phoneVerified = true;

    user.otp = undefined;
    await user.save();

    // Generate tokens
    const token = generateToken(user._id, role);
    const refreshToken = generateRefreshToken(user._id, role);

    user.password = undefined;

    return ResponseHandler.success(
      res,
      {
        message: "Login successful",
        token,
        refreshToken,
        role,
        user,
      },
      "Logged in successfully"
    );

  } catch (error) {
    logger.error(`Verify OTP Error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};


// Forgot Password
exports.forgotPassword = async (req, res) => {
  try {
    const { identifier, newPassword } = req.body;

    if (!identifier || !newPassword) {
      return ResponseHandler.error(res, 'Identifier and new password are required', 400);
    }

    // All models list
    const models = [User, ServiceProvider, Shop, Admin];
    let user = null;
    let foundModel = null;

    // Search user across all models
    for (const Model of models) {
      user = await Model.findOne({
        $or: [{ email: identifier }, { phone: identifier }]
      }).select('+password');

      if (user) {
        foundModel = Model;
        break;
      }
    }

    if (!user) {
      return ResponseHandler.error(res, 'User not found', 404);
    }

    // Set new password directly (OTP already verified)
    user.password = newPassword;

    // Remove reset fields if any
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;

    await user.save();

    ResponseHandler.success(res, null, 'Password reset successful');

  } catch (error) {
    logger.error(`Reset password error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Change Password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;
    const role = req.userRole;

    let Model;
    if (role === 'user') Model = User;
    else if (role === 'provider') Model = ServiceProvider;
    else if (role === 'shop') Model = Shop;
    else if (role === 'admin' || role === 'superadmin') Model = Admin;
    else return ResponseHandler.error(res, 'Invalid role', 400);

    const user = await Model.findById(userId).select('+password');

    if (!user) {
      return ResponseHandler.error(res, 'User not found', 404);
    }

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);

    if (!isMatch) {
      return ResponseHandler.error(res, 'Current password is incorrect', 400);
    }

    // Set new password
    user.password = newPassword;
    await user.save();

    ResponseHandler.success(res, null, 'Password changed successfully');
  } catch (error) {
    logger.error(`Change password error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Refresh Token
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return ResponseHandler.error(res, 'Refresh token required', 400);
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Generate new access token
    const newToken = generateToken(decoded.id, decoded.role);

    ResponseHandler.success(res, { token: newToken }, 'Token refreshed successfully');
  } catch (error) {
    logger.error(`Refresh token error: ${error.message}`);
    ResponseHandler.error(res, 'Invalid refresh token', 401);
  }
};

// Logout
exports.logout = async (req, res) => {
  try {
    // In a stateless JWT system, logout is handled client-side
    // by removing the token. However, you can implement token blacklisting if needed

    ResponseHandler.success(res, null, 'Logged out successfully');
  } catch (error) {
    logger.error(`Logout error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Current User
// Get Current User
exports.getCurrentUser = async (req, res) => {
  try {
    const id = req.user._id || req.user.id;
    const role = req.userRole || req.user.role;

    if (!id || !role) {
      return ResponseHandler.error(res, "Invalid token", 401);
    }

    let Model;
    let query;

    // Select model based on role
    switch (role) {
      case "user":
        Model = User;
        query = Model.findById(id).select("-password -otp -resetPasswordToken -resetPasswordExpire");
        break;
      case "provider":
        Model = ServiceProvider;
        query = Model.findById(id).select("-password -otp -resetPasswordToken -resetPasswordExpire");
        break;
      case "shop":
        Model = Shop;
        query = Model.findById(id).select("-password -otp -resetPasswordToken -resetPasswordExpire -deliveryBoys.password");
        break;
      case "admin":
      case "superadmin":
        Model = Admin;
        query = Model.findById(id).select("-password");
        break;
      default:
        return ResponseHandler.error(res, "Invalid role", 400);
    }

    // Fetch user from DB
    let user = await query;

    if (!user) {
      return ResponseHandler.error(res, "User not found", 404);
    }

    // Convert to plain object
    user = user.toObject ? user.toObject() : user;

    // Add role to user object for frontend
    user.role = role;

    return ResponseHandler.success(
      res,
      {
        user,
        role,
      },
      "User fetched successfully"
    );
  } catch (error) {
    logger.error(`Get current user error: ${error.message}`, error);
    ResponseHandler.error(res, "Internal server error", 500);
  }
};

exports.updateLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { coordinates } = req.body;

    // Validate coordinates
    if (
      !coordinates ||
      !Array.isArray(coordinates) ||
      coordinates.length !== 2 ||
      isNaN(coordinates[0]) ||
      isNaN(coordinates[1])
    ) {
      return res.status(400).json({
        success: false,
        message: "Coordinates required in format: [longitude, latitude]"
      });
    }

    // ================================
    // 1️⃣ TRY USER UPDATE
    // ================================
    let user = await User.findById(userId);

    if (user) {
      if (!user.addresses || user.addresses.length === 0) {
        // Create minimal address only for coordinates
        user.addresses = [
          {
            label: "Home",
            addressLine1: "Unknown",
            city: "Unknown",
            state: "Unknown",
            pincode: "000000",
            isDefault: true,
            location: {
              type: "Point",
              coordinates
            }
          }
        ];
      } else {
        // Update only default address coordinates
        const defaultAddress =
          user.addresses.find(a => a.isDefault) || user.addresses[0];

        defaultAddress.location.coordinates = coordinates;
      }

      await user.save();

      return res.status(200).json({
        success: true,
        message: "User location updated successfully",
        location:
          user.addresses.find(a => a.isDefault)?.location ||
          user.addresses[0].location
      });
    }

    // ================================
    // 2️⃣ TRY SERVICE PROVIDER UPDATE
    // ================================
    let provider = await ServiceProvider.findById(userId);

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: "User or Provider not found"
      });
    }

    // Ensure address object exists
    if (!provider.address) {
      provider.address = {};
    }

    if (!provider.address.location) {
      provider.address.location = {
        type: "Point",
        coordinates
      };
    } else {
      provider.address.location.coordinates = coordinates;
    }

    await provider.save();

    return res.status(200).json({
      success: true,
      message: "Service Provider location updated successfully",
      location: provider.address.location
    });

  } catch (error) {
    console.error("Location update error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

