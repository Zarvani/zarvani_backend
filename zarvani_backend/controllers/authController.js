const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const ServiceProvider = require('../models/ServiceProvider');
const { Shop, Admin } = require('../models/Shop');
const EmailService = require('../services/emailService');
const ResponseHandler = require('../utils/responseHandler');
const logger = require('../utils/logger');

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
    const { name, email, phone, password, role = 'user' } = req.body;
    
    let Model;
    if (role === 'user') Model = User;
    else if (role === 'provider') Model = ServiceProvider;
    else if (role === 'shop') Model = Shop;
    else return ResponseHandler.error(res, 'Invalid role', 400);
    
    // Check if user already exists
    const existingUser = await Model.findOne({
      $or: [
        { phone },
        ...(email ? [{ email }] : [])
      ]
    });
    
    if (existingUser) {
      return ResponseHandler.error(res, 'User already exists with this email or phone', 400);
    }
    
    // Create user
    const userData = {
      name,
      phone,
      role
    };
    
    if (email) userData.email = email;
    if (password) {
      userData.password = password;
      userData.phoneVerified = false;
    }
    
    const user = await Model.create(userData);
    
    // Generate OTP for phone verification
    const otp = user.generateOTP();
    await user.save();
    
    // Send OTP
    if (email) {
      await EmailService.sendOTP(email, otp, name);
    }
    console.log(`OTP for ${phone}: ${otp}`);
    
    // Send welcome email
    if (email) {
      await EmailService.sendWelcomeEmail(email, name, role);
    }
    
    // Generate token
    const token = generateToken(user._id, role);
    const refreshToken = generateRefreshToken(user._id, role);
    
    // Remove sensitive data
    user.password = undefined;
    user.otp = undefined;
    
    ResponseHandler.success(res, {
      user,
      token,
      refreshToken,
      message: 'Please verify your phone number with OTP'
    }, 'Signup successful', 201);
  } catch (error) {
    logger.error(`Signup error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
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
    const { identifier, password, role = 'user' } = req.body;
    
    if (!identifier || !password) {
      return ResponseHandler.error(res, 'Please provide email/phone and password', 400);
    }
    
    let Model;
    if (role === 'user') Model = User;
    else if (role === 'provider') Model = ServiceProvider;
    else if (role === 'shop') Model = Shop;
    else if (role === 'admin' || role === 'superadmin') Model = Admin;
    else return ResponseHandler.error(res, 'Invalid role', 400);
    
    // Check if identifier is email or phone
    const isEmail = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(identifier);
    const query = isEmail ? { email: identifier } : { phone: identifier };
    
    // Find user and include password
    const user = await Model.findOne(query).select('+password');
    
    if (!user) {
      return ResponseHandler.error(res, 'Invalid credentials', 401);
    }
    
    // Check password
    const isPasswordMatch = await user.comparePassword(password);
    
    if (!isPasswordMatch) {
      return ResponseHandler.error(res, 'Invalid credentials', 401);
    }
    
    // Check if account is active
    if (user.isActive === false) {
      return ResponseHandler.error(res, 'Your account has been deactivated. Please contact support.', 403);
    }
    
    // For providers and shops, check verification status
    if ((role === 'provider' || role === 'shop') && user.verificationStatus !== 'approved') {
      return ResponseHandler.error(res, 
        `Your account is ${user.verificationStatus}. ${user.verificationStatus === 'pending' ? 'Please wait for admin approval.' : 'Please contact support.'}`, 
        403
      );
    }
    
    // Update last login
    user.lastLogin = new Date();
    await user.save();
    
    // Generate tokens
    const token = generateToken(user._id, role);
    const refreshToken = generateRefreshToken(user._id, role);
    
    // Remove sensitive data
    user.password = undefined;
    user.otp = undefined;
    
    ResponseHandler.success(res, {
      user,
      token,
      refreshToken
    }, 'Login successful');
  } catch (error) {
    logger.error(`Login error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Login with OTP
exports.loginWithOTP = async (req, res) => {
  try {
    const { identifier, role = 'user' } = req.body;
    
    let Model;
    if (role === 'user') Model = User;
    else if (role === 'provider') Model = ServiceProvider;
    else if (role === 'shop') Model = Shop;
    else return ResponseHandler.error(res, 'Invalid role', 400);
    
    const isEmail = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(identifier);
    const query = isEmail ? { email: identifier } : { phone: identifier };
    
    let user = await Model.findOne(query);
    
    if (!user) {
      return ResponseHandler.error(res, 'User not found. Please sign up first.', 404);
    }
    
    // Generate and send OTP
    const otp = user.generateOTP();
    await user.save();
    
    if (isEmail) {
      await EmailService.sendOTP(identifier, otp, user.name);
    } else {
      console.log(`OTP for ${identifier}: ${otp}`);
    }
    
    ResponseHandler.success(res, 
      { message: 'OTP sent. Please verify to login.' },
      'OTP sent successfully'
    );
  } catch (error) {
    logger.error(`Login with OTP error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// Forgot Password
exports.forgotPassword = async (req, res) => {
  try {
    const { identifier, role = 'user' } = req.body;
    
    let Model;
    if (role === 'user') Model = User;
    else if (role === 'provider') Model = ServiceProvider;
    else if (role === 'shop') Model = Shop;
    else if (role === 'admin') Model = Admin;
    else return ResponseHandler.error(res, 'Invalid role', 400);
    
    const isEmail = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(identifier);
    
    if (!isEmail) {
      return ResponseHandler.error(res, 'Please provide a valid email address', 400);
    }
    
    const user = await Model.findOne({ email: identifier });
    
    if (!user) {
      return ResponseHandler.error(res, 'User not found', 404);
    }
    
    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    user.resetPasswordToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    
    user.resetPasswordExpire = Date.now() + 60 * 60 * 1000; // 1 hour
    
    await user.save();
    
    // Send reset email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
    await EmailService.sendPasswordReset(identifier, resetUrl, user.name);
    
    ResponseHandler.success(res, 
      { message: 'Password reset link sent to email' },
      'Reset link sent successfully'
    );
  } catch (error) {
    logger.error(`Forgot password error: ${error.message}`);
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
exports.getCurrentUser = async (req, res) => {
  try {
    const user = req.user;
    const role = req.userRole;
    
    // Remove sensitive fields
    if (user.password) user.password = undefined;
    if (user.otp) user.otp = undefined;
    
    ResponseHandler.success(res, { user, role }, 'User fetched successfully');
  } catch (error) {
    logger.error(`Get current user error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};