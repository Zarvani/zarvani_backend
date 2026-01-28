const Shop = require('../models/Shop');
const Product = require('../models/Product');
const { Order } = require('../models/Order');
const ResponseHandler = require('../utils/responseHandler');
const CacheService = require('../services/cacheService');
const CacheInvalidationService = require('../services/cacheInvalidationService');
const { batchLoadAndAttach } = require('../utils/batchLoader');
const logger = require('../utils/logger');

// ==================== PUBLIC ROUTES ====================

/**
 * OPTIMIZED getAllProducts - Fixes N+1 queries and adds caching
 * BEFORE: 20 products = 1 + 20 = 21 queries
 * AFTER: 20 products = 1 + 1 = 2 queries (10x faster!)
 */
exports.getAllProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      subcategory,
      shop,
      search,
      minPrice,
      maxPrice,
      brand,
      tags,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      featured,
      available = true
    } = req.query;

    // Build cache key
    const cacheKey = `products:all:${JSON.stringify(req.query)}`;

    // Try cache first (for first page only)
    if (page == 1) {
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        logger.debug(`Cache HIT: Products list`);
        return ResponseHandler.success(res, cached, 'Products fetched from cache');
      }
    }

    // Build query
    const query = {};

    if (available !== undefined) {
      query.isAvailable = available === 'true' || available === true;
    }

    if (category) query.category = category;
    if (subcategory) query.subcategory = subcategory;
    if (shop) query.shop = shop;
    if (brand) query.brand = brand;
    if (featured !== undefined) query.isFeatured = featured === 'true' || featured === true;

    // Price range filter
    if (minPrice || maxPrice) {
      query['price.sellingPrice'] = {};
      if (minPrice) query['price.sellingPrice'].$gte = Number(minPrice);
      if (maxPrice) query['price.sellingPrice'].$lte = Number(maxPrice);
    }

    // Tags filter
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      query.tags = { $in: tagArray };
    }

    // Search filter (text search)
    if (search) {
      query.$text = { $search: search };
    }

    const skip = (page - 1) * limit;
    const sort = {};

    if (search) {
      sort.score = { $meta: 'textScore' };
    } else {
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    }

    // OPTIMIZATION 1: Use .lean() for faster queries
    let queryBuilder = Product.find(query).lean();

    if (search) {
      queryBuilder = queryBuilder.select({ score: { $meta: 'textScore' } });
    }

    const products = await queryBuilder
      .sort(sort)
      .skip(skip)
      .limit(Number(limit));

    // OPTIMIZATION 2: Batch load shops (1 query instead of N)
    await batchLoadAndAttach(
      products,
      'shop',
      Shop,
      'shop',
      'name logo address phone ratings'
    );

    const total = await Product.countDocuments(query);

    const response = {
      products,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    };

    // Cache for 5 minutes (first page only)
    if (page == 1) {
      await CacheService.set(cacheKey, response, 300);
    }

    ResponseHandler.success(res, response, 'Products fetched successfully');

  } catch (error) {
    logger.error(`Get all products error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};
// Get Product Details by ID
exports.getProductDetails = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('shop', 'name logo address phone ratings workingHours');

    if (!product) {
      return ResponseHandler.error(res, 'Product not found', 404);
    }

    ResponseHandler.success(res, { product }, 'Product details fetched successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Products by Shop ID
exports.getShopProducts = async (req, res) => {
  try {
    const { shopId } = req.params;
    const {
      page = 1,
      limit = 20,
      category,
      available,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build cache key
    const cacheKey = CacheService.shopKey(shopId, `products:${JSON.stringify(req.query)}`);

    // Try cache first
    if (page == 1) {
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        logger.debug(`Cache HIT: Shop products for ${shopId}`);
        return ResponseHandler.success(res, cached, 'Products fetched from cache');
      }
    }

    // Build query
    const query = { shop: shopId };
    if (category) query.category = category;
    if (available !== undefined) {
      query.isAvailable = available === 'true' || available === true;
    }

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // Use .lean() for faster queries (no need to populate shop since we already have shopId)
    const products = await Product.find(query)
      .lean()
      .sort(sort)
      .skip(skip)
      .limit(Number(limit));

    const total = await Product.countDocuments(query);

    const response = {
      products,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    };

    // Cache for 5 minutes
    if (page == 1) {
      await CacheService.set(cacheKey, response, 300);
    }

    ResponseHandler.success(res, response, 'Shop products fetched successfully');

  } catch (error) {
    logger.error(`Get shop products error: ${error.message}`);
    ResponseHandler.error(res, error.message, 500);
  }
};

// ==================== SHOP OWNER ROUTES ====================

// Add New Product
// ================== ADD PRODUCT ==================
exports.addProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      subcategory,
      price,
      stock,
      sku,
      brand,
      specifications,
      tags
    } = req.body;

    // 1️⃣ ONLY SHOP OWNER CAN ADD PRODUCTS
    if (req.user.role !== "shop") {
      return ResponseHandler.error(res, "Only shop owners can add products", 403);
    }

    // 2️⃣ CHECK SHOP ACCOUNT STATUS
    const shop = await Shop.findById(req.user._id);
    if (!shop || !shop.isActive) {
      return ResponseHandler.error(res, "Shop not found or inactive", 403);
    }

    // 3️⃣ PARSE SPECIFICATIONS (IMPORTANT)
    let parsedSpecifications = [];
    try {
      if (specifications) {
        parsedSpecifications =
          typeof specifications === "string"
            ? JSON.parse(specifications)
            : specifications;
      }
    } catch (err) {
      return ResponseHandler.error(res, "Invalid specifications format", 400);
    }

    // 4️⃣ PARSE TAGS
    const parsedTags = Array.isArray(tags)
      ? tags
      : tags
        ? tags.split(",").map((t) => t.trim())
        : [];

    // 5️⃣ CALCULATE DISCOUNT
    const discount =
      price?.mrp && price?.sellingPrice
        ? Math.round(((price.mrp - price.sellingPrice) / price.mrp) * 100)
        : 0;

    // 6️⃣ PREPARE PRODUCT DATA
    const productData = {
      shop: req.user._id,
      name,
      description,
      category,
      subcategory,
      price: {
        ...price,
        discount
      },
      stock,
      sku,
      brand,
      specifications: parsedSpecifications,
      tags: parsedTags
    };

    // 7️⃣ HANDLE IMAGES
    if (req.files && req.files.length > 0) {
      productData.images = req.files.map((file) => ({
        url: file.path,
        publicId: file.filename
      }));
    }

    // 8️⃣ SAVE PRODUCT
    const product = await Product.create(productData);

    // 9️⃣ INVALIDATE CACHE
    await CacheInvalidationService.invalidateProduct(product).catch(e => logger.error(`Cache invalidation error: ${e.message}`));

    return ResponseHandler.success(
      res,
      { product },
      "Product added successfully",
      201
    );
  } catch (error) {
    return ResponseHandler.error(res, error.message, 500);
  }
};

// ================== UPDATE PRODUCT ==================
exports.updateProduct = async (req, res) => {
  try {
    const productId = req.params.id;

    // 1️⃣ ONLY SHOP OWNER CAN UPDATE
    if (req.user.role !== "shop") {
      return ResponseHandler.error(res, "Only shop owners can update products", 403);
    }

    // 2️⃣ FIND PRODUCT
    const product = await Product.findOne({
      _id: productId,
      shop: req.user._id
    });

    if (!product) {
      return ResponseHandler.error(res, "Product not found", 404);
    }

    const updateData = { ...req.body };

    // 3️⃣ FIX: PARSE PRICE IF NEEDED
    if (updateData.price && typeof updateData.price === "string") {
      updateData.price = JSON.parse(updateData.price);
    }

    // 4️⃣ RECALCULATE DISCOUNT
    if (updateData.price?.mrp && updateData.price?.sellingPrice) {
      updateData.price.discount = Math.round(
        ((updateData.price.mrp - updateData.price.sellingPrice) /
          updateData.price.mrp) *
        100
      );
    }

    // 5️⃣ PARSE SPECIFICATIONS
    if (updateData.specifications) {
      try {
        updateData.specifications =
          typeof updateData.specifications === "string"
            ? JSON.parse(updateData.specifications)
            : updateData.specifications;
      } catch (err) {
        return ResponseHandler.error(res, "Invalid specifications format", 400);
      }
    }

    // 6️⃣ PARSE TAGS
    if (updateData.tags) {
      updateData.tags = Array.isArray(updateData.tags)
        ? updateData.tags
        : updateData.tags.split(",").map((t) => t.trim());
    }

    // 7️⃣ ADD NEW IMAGES IF ANY
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map((file) => ({
        url: file.path,
        publicId: file.filename
      }));

      updateData.images = [...product.images, ...newImages];
    }

    // 8️⃣ UPDATE PRODUCT
    const updatedProduct = await Product.findByIdAndUpdate(
      productId,
      updateData,
      { new: true }
    );

    // 9️⃣ INVALIDATE CACHE
    await CacheInvalidationService.invalidateProduct(updatedProduct).catch(e => logger.error(`Cache invalidation error: ${e.message}`));

    return ResponseHandler.success(
      res,
      { product: updatedProduct },
      "Product updated successfully",
      200
    );
  } catch (error) {
    return ResponseHandler.error(res, error.message, 500);
  }
};

// Delete Product Image
exports.deleteProductImage = async (req, res) => {
  try {
    const { id, imageId } = req.params;

    const product = await Product.findById(id);
    if (!product) {
      return ResponseHandler.error(res, 'Product not found', 404);
    }

    // Verify ownership
    if (product.shop.toString() !== req.user._id.toString()) {
      return ResponseHandler.error(res, 'Not authorized to update this product', 403);
    }

    // Remove image from array
    product.images = product.images.filter(img => img._id.toString() !== imageId);
    await product.save();

    // Here you would also delete from cloud storage (Cloudinary, etc.)
    // await cloudinary.uploader.destroy(imagePublicId);

    ResponseHandler.success(res, { product }, 'Image deleted successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Delete Product
exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id);
    if (!product) {
      return ResponseHandler.error(res, 'Product not found', 404);
    }

    // Verify ownership
    if (product.shop.toString() !== req.user._id.toString()) {
      return ResponseHandler.error(res, 'Not authorized to delete this product', 403);
    }

    // Soft delete - just mark as unavailable
    product.isAvailable = false;
    await product.save();

    // Invalidate cache
    await CacheInvalidationService.invalidateProduct(product).catch(e => logger.error(`Cache invalidation error: ${e.message}`));

    // For hard delete, uncomment below:
    // await Product.findByIdAndDelete(id);
    // Also delete images from cloud storage

    ResponseHandler.success(res, null, 'Product deleted successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Toggle Product Availability
exports.toggleProductAvailability = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await Product.findById(id);
    if (!product) {
      return ResponseHandler.error(res, 'Product not found', 404);
    }

    // Verify ownership
    if (product.shop.toString() !== req.user._id.toString()) {
      return ResponseHandler.error(res, 'Not authorized to update this product', 403);
    }

    product.isAvailable = !product.isAvailable;
    await product.save();

    // Invalidate cache
    await CacheInvalidationService.invalidateProduct(product).catch(e => logger.error(`Cache invalidation error: ${e.message}`));

    ResponseHandler.success(
      res,
      { product },
      `Product ${product.isAvailable ? 'activated' : 'deactivated'} successfully`
    );
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Update Stock
exports.updateStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, unit } = req.body;

    const product = await Product.findById(id);
    if (!product) {
      return ResponseHandler.error(res, 'Product not found', 404);
    }

    // Verify ownership
    if (product.shop.toString() !== req.user._id.toString()) {
      return ResponseHandler.error(res, 'Not authorized to update this product', 403);
    }

    product.stock.quantity = quantity !== undefined ? quantity : product.stock.quantity;
    product.stock.unit = unit || product.stock.unit;

    // Auto-disable if out of stock
    if (product.stock.quantity === 0) {
      product.isAvailable = false;
    }

    await product.save();

    // Invalidate cache
    await CacheInvalidationService.invalidateProduct(product).catch(e => logger.error(`Cache invalidation error: ${e.message}`));

    ResponseHandler.success(res, { product }, 'Stock updated successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Shop's Own Products
exports.getMyProducts = async (req, res) => {
  try {
    const { page = 1, limit = 20, category, isAvailable } = req.query;

    const query = { shop: req.user._id };

    if (category) query.category = category;
    if (isAvailable !== undefined) query.isAvailable = isAvailable === 'true';

    const products = await Product.find(query)
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .sort({ createdAt: -1 });

    const count = await Product.countDocuments(query);

    // Get statistics
    const stats = await Product.aggregate([
      { $match: { shop: req.user._id } },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          activeProducts: {
            $sum: { $cond: ['$isAvailable', 1, 0] }
          },
          totalStock: { $sum: '$stock.quantity' },
          averagePrice: { $avg: '$price.sellingPrice' }
        }
      }
    ]);

    ResponseHandler.paginated(res, products, page, limit, count, { stats: stats[0] || {} });
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// ==================== REVIEW ROUTES ====================

// Add Product Review (Customer only)
exports.addProductReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    // Verify user is a customer
    if (req.user.role !== 'customer') {
      return ResponseHandler.error(res, 'Only customers can add reviews', 403);
    }

    const product = await Product.findById(id);
    if (!product) {
      return ResponseHandler.error(res, 'Product not found', 404);
    }

    // Check if user has purchased this product (optional)
    // Uncomment if you want to enforce purchase verification
    /*
    const hasPurchased = await Order.findOne({
      customer: req.user._id,
      'items.product': id,
      status: 'delivered'
    });
    
    if (!hasPurchased) {
      return ResponseHandler.error(res, 'You can only review products you have purchased', 403);
    }
    */

    // Update product ratings
    const newCount = product.ratings.count + 1;
    const newAverage = ((product.ratings.average * product.ratings.count) + rating) / newCount;

    product.ratings.average = Math.round(newAverage * 10) / 10; // Round to 1 decimal
    product.ratings.count = newCount;

    await product.save();

    // Here you would also save the review to a Review model if you have one
    // const review = await Review.create({
    //   product: id,
    //   customer: req.user._id,
    //   rating,
    //   comment
    // });

    ResponseHandler.success(res, { product }, 'Review added successfully', 201);
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Product Categories (Helper endpoint)
exports.getCategories = async (req, res) => {
  try {
    const categories = await Product.distinct('category');
    ResponseHandler.success(res, { categories }, 'Categories fetched successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Get Product Subcategories by Category
exports.getSubcategories = async (req, res) => {
  try {
    const { category } = req.params;
    const subcategories = await Product.distinct('subcategory', { category });
    ResponseHandler.success(res, { subcategories }, 'Subcategories fetched successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};


// Cache invalidation now handled by CacheInvalidationService

