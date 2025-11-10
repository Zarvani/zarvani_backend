const { Shop } = require('../models/Shop');
const { Product } = require('../models/Product');
const { Order } = require('../models/Order'); // Assuming you have an Order model
const ResponseHandler = require('../utils/responseHandler');

// ==================== PUBLIC ROUTES ====================

// Get All Products with Filters
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
      sortOrder = 'desc'
    } = req.query;
    
    const query = { isAvailable: true };
    
    // Filter by category
    if (category) query.category = category;
    
    // Filter by subcategory
    if (subcategory) query.subcategory = subcategory;
    
    // Filter by shop
    if (shop) query.shop = shop;
    
    // Filter by brand
    if (brand) query.brand = brand;
    
    // Filter by tags
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim());
      query.tags = { $in: tagArray };
    }
    
    // Search by name or description
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Price range filter
    if (minPrice || maxPrice) {
      query['price.sellingPrice'] = {};
      if (minPrice) query['price.sellingPrice'].$gte = Number(minPrice);
      if (maxPrice) query['price.sellingPrice'].$lte = Number(maxPrice);
    }
    
    // Sorting options
    const sortOptions = {};
    if (sortBy === 'price') {
      sortOptions['price.sellingPrice'] = sortOrder === 'asc' ? 1 : -1;
    } else if (sortBy === 'rating') {
      sortOptions['ratings.average'] = sortOrder === 'asc' ? 1 : -1;
    } else if (sortBy === 'name') {
      sortOptions.name = sortOrder === 'asc' ? 1 : -1;
    } else {
      sortOptions.createdAt = sortOrder === 'asc' ? 1 : -1;
    }
    
    const products = await Product.find(query)
      .populate('shop', 'name logo address phone ratings')
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .sort(sortOptions);
    
    const count = await Product.countDocuments(query);
    
    ResponseHandler.paginated(res, products, page, limit, count);
  } catch (error) {
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
    const { page = 1, limit = 20, category, isAvailable } = req.query;
    const { shopId } = req.params;
    
    // Verify shop exists
    const shop = await Shop.findById(shopId);
    if (!shop) {
      return ResponseHandler.error(res, 'Shop not found', 404);
    }
    
    const query = { shop: shopId };
    
    if (category) query.category = category;
    if (isAvailable !== undefined) query.isAvailable = isAvailable === 'true';
    
    const products = await Product.find(query)
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit))
      .sort({ createdAt: -1 });
    
    const count = await Product.countDocuments(query);
    
    ResponseHandler.paginated(res, products, page, limit, count);
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// ==================== SHOP OWNER ROUTES ====================

// Add New Product
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
    
    // Verify user is a shop owner
    if (req.user.role !== 'shop') {
      return ResponseHandler.error(res, 'Only shop owners can add products', 403);
    }
    
    // Verify shop exists and is active
    const shop = await Shop.findById(req.user._id);
    if (!shop || !shop.isActive) {
      return ResponseHandler.error(res, 'Shop not found or inactive', 403);
    }
    
    // Calculate discount
    const discount = price.mrp && price.sellingPrice 
      ? Math.round(((price.mrp - price.sellingPrice) / price.mrp) * 100)
      : 0;
    
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
      specifications,
      tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())) : []
    };
    
    // Handle image uploads
    if (req.files && req.files.length > 0) {
      productData.images = req.files.map(file => ({
        url: file.path,
        publicId: file.filename
      }));
    }
    
    const product = await Product.create(productData);
    
    ResponseHandler.success(res, { product }, 'Product added successfully', 201);
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
  }
};

// Update Product
exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Find product
    const product = await Product.findById(id);
    if (!product) {
      return ResponseHandler.error(res, 'Product not found', 404);
    }
    
    // Verify ownership
    if (product.shop.toString() !== req.user._id.toString()) {
      return ResponseHandler.error(res, 'Not authorized to update this product', 403);
    }
    
    // Calculate discount if prices are updated
    if (updateData.price) {
      if (updateData.price.mrp && updateData.price.sellingPrice) {
        updateData.price.discount = Math.round(
          ((updateData.price.mrp - updateData.price.sellingPrice) / updateData.price.mrp) * 100
        );
      }
    }
    
    // Handle new image uploads
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map(file => ({
        url: file.path,
        publicId: file.filename
      }));
      
      // Append to existing images or replace
      updateData.images = [...(product.images || []), ...newImages];
    }
    
    // Handle tags
    if (updateData.tags && typeof updateData.tags === 'string') {
      updateData.tags = updateData.tags.split(',').map(t => t.trim());
    }
    
    const updatedProduct = await Product.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('shop', 'name logo address phone');
    
    ResponseHandler.success(res, { product: updatedProduct }, 'Product updated successfully');
  } catch (error) {
    ResponseHandler.error(res, error.message, 500);
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