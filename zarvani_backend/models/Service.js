// ============= models/Service.js =============
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const serviceSchema = new mongoose.Schema({
  provider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ServiceProvider',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
     enum: [
      "plumbing",
      "electrical",
      "carpentry",
      "painting",
      "cleaning",
      "gardening",
      "home-appliance-repair",
      "computer-repair",
      "home-renovation",
      "interior-design",
      "pest-control",
      "hvac-repair",
      "salon-services",
      "beauty-services",
      "tutoring",
      "legal-services",
      "catering",
      "photography",
      "event-planning",
      "flooring-and-tile",
      "wall-panels-and-panelling",
      "water-purifier-installation",
      "ac-service",
      "sofa-and-carpet-cleaning",
      "maid-service",
      "home-moving-and-packers",
      "fitness-and-yoga-trainer",
      "home-health-care",
      "driver-and-chauffeur",
      "native-product-installation",
      "furniture-assembly",
      "shifting-and-relocation",
      "bike-or-vehicle-repair",
      "accounting-and-tax-services",
      "dry-cleaning-and-laundry",
      "baby-or-child-care",
      "elder-care",
      "pet-grooming",
      "other"
    ]
  },
  subcategory: String,
  images: [{
    url: String,
    publicId: String
  }],
  pricing: {
    basePrice: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    discountedPrice: Number,
    discountPercentage: Number
  },
  duration: {
    value: Number,
    unit: { type: String, enum: ['minutes', 'hours', 'days'], default: 'minutes' }
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: [Number]
  },
  serviceType: {
    type: String,
    enum: ['at-home', 'at-center', 'both'],
    default: 'at-home'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  ratings: {
    average: { type: Number, default: 0 },
    count: { type: Number, default: 0 }
  },
  tags: [String],
  requiredProducts: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    quantity: Number
  }]
}, { timestamps: true });

serviceSchema.index({ location: '2dsphere' });

module.exports = {Service: mongoose.model('Service', serviceSchema)};