// ============= middleware/authMiddleware.js =============
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ServiceProvider = require('../models/ServiceProvider');
const Shop = require('../models/Shop');
const { Admin } = require('../models/Admin');
const redisClient = require('../config/passport');

exports.protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ PERFORMANCE: Check Redis cache first to avoid DB hits on every request
    const cacheKey = `session:${decoded.role}:${decoded.id}`;
    const cachedUser = await redisClient.get(cacheKey);

    if (cachedUser) {
      req.user = JSON.parse(cachedUser);
      req.userRole = decoded.role;
      return next();
    }

    let user;
    if (decoded.role === 'user') {
      user = await User.findById(decoded.id);
    } else if (decoded.role === 'provider') {
      user = await ServiceProvider.findById(decoded.id);
    } else if (decoded.role === 'shop') {
      user = await Shop.findById(decoded.id);
    } else if (decoded.role === 'admin' || decoded.role === 'superadmin') {
      user = await Admin.findById(decoded.id);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // ✅ PERFORMANCE: Cache user in Redis for 5 minutes
    await redisClient.setEx(cacheKey, 300, JSON.stringify(user));

    req.user = user;
    req.userRole = decoded.role;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }
};

exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({
        success: false,
        message: 'User role is not authorized to access this route'
      });
    }
    next();
  };
};

