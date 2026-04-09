// =============== routes/productRoutes.js ==================
const express = require("express");
const router = express.Router();

const productController = require("../controllers/productController");
const { protect, authorize } = require("../middleware/authMiddleware");
const cacheMiddleware = require("../middleware/cache");

// ✅ Import correct upload method from uploadMiddleware.js
const {
  uploadImages,
  uploadSingleImage,
  uploadMultipleDocuments,
  uploadDocument,
  uploadProfile,
} = require("../middleware/uploadMiddleware");

// ==================== PUBLIC ROUTES ====================

// Get all products with filters (Cache for 5 mins)
router.get("/", cacheMiddleware(300), productController.getAllProducts);

// Get product details (Cache for 5 mins)
router.get("/:id", cacheMiddleware(300), productController.getProductDetails);

// Get products by shop (Cache for 5 mins)
router.get("/shop/:shopId", cacheMiddleware(300), productController.getShopProducts);

// Get all categories (Cache for 24 hours, rarely changes)
router.get("/utils/categories", cacheMiddleware(86400), productController.getCategories);

// Get subcategories by category (Cache for 24 hours)
router.get("/utils/categories/:category/subcategories", cacheMiddleware(86400), productController.getSubcategories);

// ==================== PROTECTED ROUTES (REQUIRE AUTH) ====================
router.use(protect);

// -------------------- CUSTOMER ROUTES --------------------
router.post("/:id/review", authorize("customer"), productController.addProductReview);

// -------------------- SHOP OWNER ROUTES --------------------

// Get shop's own products
router.get("/my/products", authorize("shop"), productController.getMyProducts);

// Add new product with images upload
router.post(
  "/",
  authorize("shop"),
  uploadImages,  // <-- using uploadImages from middleware
  productController.addProduct
);

// Update product (allow new images upload)
router.put(
  "/:id",
  authorize("shop"),
  uploadImages,
  productController.updateProduct
);

// Delete product
router.delete("/:id", authorize("shop"), productController.deleteProduct);

// Toggle product availability
router.patch("/:id/toggle-availability", authorize("shop"), productController.toggleProductAvailability);

// Update stock
router.patch("/:id/stock", authorize("shop"), productController.updateStock);

// Delete specific product image
router.delete("/:id/images/:imageId", authorize("shop"), productController.deleteProductImage);

module.exports = router;
