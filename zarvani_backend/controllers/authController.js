const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const ServiceProvider = require('../models/ServiceProvider');
const { Shop } = require('../models/Shop');
const Admin= require("../models/Admin")
const EmailService = require('../services/emailService');
const ResponseHandler = require('../utils/responseHandler');
const logger = require('../utils/logger');
const redisClient =require("../config/passport")
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

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP in Redis for 10 min
    await redisClient.setEx(`otp:signup:${identifier}`, 600, otp);

    console.log("Signup OTP:", otp);

    if (isEmail) {
      await EmailService.sendOTP(identifier, otp, "New User");
    } else {
      console.log("SMS OTP:", otp);
    }

    return ResponseHandler.success(
      res,
      { message: "Signup OTP sent" },
      "OTP sent"
    );

  } catch (err) {
    logger.error(`Signup OTP Error: ${err.message}`);
    return ResponseHandler.error(res, err.message, 500);
  }
};

// Send OTP
exports.sendOTP = async (req, res) => {
  try {
    const { identifier, role = 'user' } = req.body; // identifier can be email or phone
    
    let Model;
    if (role === 'user') Model = User;
    else if (role === 'provider') Model = ServiceProvider;
    else if (role === 'shop') Model = Shop;
    else return ResponseHandler.error(res, 'Invalid role', 400);
    
    // Check if identifier is email or phone
    const isEmail = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(identifier);
    const query = isEmail ? { email: identifier } : { phone: identifier };
    
    let user = await Model.findOne(query);
    
    if (!user) {
      return ResponseHandler.error(res, 'User not found. Please sign up first.', 404);
    }
    
    // Generate and save OTP
    const otp = user.generateOTP();
    await user.save();
    
    // Send OTP via email or SMS
    if (isEmail) {
      await EmailService.sendOTP(identifier, otp, user.name);
    } else {
      // TODO: Implement SMS service
      console.log(`OTP for ${identifier}: ${otp}`);
    }
    
    ResponseHandler.success(res, 
      { message: `OTP sent to ${isEmail ? 'email' : 'phone'}` },
      'OTP sent successfully'
    );
  } catch (error) {
    logger.error(`Send OTP error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
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

      // provider fields
      experience,
      certifications,
      documents,
      serviceCategories,
      specializations,
      portfolio,
      workingHours,
      address,
      availability,
      bankDetails,

      // shop fields
      ownerName,
      gstNumber,
      categories
    } = req.body;

    // --------------------------------------
    // 1️⃣ SELECT MODEL BASED ON ROLE
    // --------------------------------------
    let Model;
    if (role === "user") Model = User;
    else if (role === "provider") Model = ServiceProvider;
    else if (role === "shop") Model = Shop;
    else return ResponseHandler.error(res, "Invalid role", 400);


    // --------------------------------------
    // 2️⃣ CHECK IF USER ALREADY EXIST
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
    // 3️⃣ PREPARE DATA
    // --------------------------------------
    const userData = {
      name,
      phone,
      email,
      password,
      role,
    };

    if (role === "provider") {
      if (experience) userData.experience = experience;
      if (certifications) userData.certifications = certifications;
      if (documents) userData.documents = documents;
      if (serviceCategories) userData.serviceCategories = serviceCategories;
      if (specializations) userData.specializations = specializations;
      if (portfolio) userData.portfolio = portfolio;
      if (workingHours) userData.workingHours = workingHours;
      if (address) userData.address = address;
      if (availability) userData.availability = availability;
      if (bankDetails) userData.bankDetails = bankDetails;
    }

    if (role === "shop") {
      userData.ownerName = ownerName;
      if (gstNumber) userData.gstNumber = gstNumber;
      if (categories) userData.categories = categories;
      if (address) userData.address = address;
      if (bankDetails) userData.bankDetails = bankDetails;
    }


    // --------------------------------------
    // 4️⃣ GENERATE OTP BEFORE DB WRITE
    // --------------------------------------
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = Date.now() + 10 * 60 * 1000; // 10 mins

    userData.otp = otp;
    userData.otpExpiry = otpExpiry;
    const user = await Model.create(userData);


    // Remove private fields
    user.password = undefined;
    user.otp = undefined;
    user.otpExpiry = undefined;


    // --------------------------------------
    // 7️⃣ SEND RESPONSE IMMEDIATELY ⭐ FAST ⭐
    // --------------------------------------
    ResponseHandler.success(
      res,
      {
        user,
        message: "Signup successful. OTP sent."
      },
      "Signup success",
      201
    );


    // --------------------------------------
    // 8️⃣ BACKGROUND TASK — SEND EMAILS
    // --------------------------------------
    setImmediate(async () => {
      try {
        if (email) {
          await EmailService.sendOTP(email, otp, name);
          await EmailService.sendWelcomeEmail(email, name, role);
        }
      } catch (err) {
        console.error("Email sending failed:", err.message);
      }
    });


  } catch (err) {
    logger.error(`Signup error: ${err.message}`);
    return ResponseHandler.error(res, err.message, 500);
  }
};

exports.verifySignupOTP = async (req, res) => {
  try {
    const { identifier, otp } = req.body;

    // Validate inputs
    if (!identifier || typeof identifier !== "string") {
      return ResponseHandler.error(res, "Identifier is required", 400);
    }

    if (!otp || typeof otp !== "string") {
      return ResponseHandler.error(res, "OTP is required", 400);
    }

    const storedOtp = await redisClient.get(`otp:signup:${identifier}`);

    if (!storedOtp) {
      return ResponseHandler.error(res, "OTP expired or not found", 400);
    }

    if (storedOtp !== otp) {
      return ResponseHandler.error(res, "Invalid OTP", 400);
    }

    // Delete OTP after successful verification
    await redisClient.del(`otp:signup:${identifier}`);

    return ResponseHandler.success(
      res,
      { verified: true },
      "OTP verified successfully"
    );

  } catch (err) {
    logger.error(`OTP Verify Error: ${err.message}`);
    return ResponseHandler.error(res, err.message, 500);
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
    if (isEmail) {
      await EmailService.sendOTP(identifier, otp, user.name);
    } else {
      console.log(`OTP for ${identifier}: ${otp}`);
    }

    return ResponseHandler.success(
      res,
      {
        message: "OTP sent successfully. Please verify to login.",
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

// Reset Password
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword, role = 'user' } = req.body;
    
    let Model;
    if (role === 'user') Model = User;
    else if (role === 'provider') Model = ServiceProvider;
    else if (role === 'shop') Model = Shop;
    else if (role === 'admin') Model = Admin;
    else return ResponseHandler.error(res, 'Invalid role', 400);
    
    // Hash token
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    const user = await Model.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() }
    });
    
    if (!user) {
      return ResponseHandler.error(res, 'Invalid or expired reset token', 400);
    }
    
    // Set new password
    user.password = newPassword;
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
    const { id, role } = req.user; // coming from middleware

    if (!id || !role) {
      return ResponseHandler.error(res, "Invalid token", 401);
    }

    let Model;

    // Select model based on role
    if (role === "user") Model = User;
    else if (role === "provider") Model = ServiceProvider;
    else if (role === "shop") Model = Shop;
    else if (role === "admin" || role === "superadmin") Model = Admin;
    else return ResponseHandler.error(res, "Invalid role", 400);

    // Fetch user from DB
    let user = await Model.findById(id)
      .select("-password -otp -otpExpiry -resetPasswordToken -resetPasswordExpire");

    if (!user) {
      return ResponseHandler.error(res, "User not found", 404);
    }

    return ResponseHandler.success(
      res,
      {
        user,
        role,
      },
      "User fetched successfully"
    );
  } catch (error) {
    logger.error(`Get current user error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
