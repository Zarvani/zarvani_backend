# Yetzo Backend - Service Marketplace API

A comprehensive RESTful API backend for a multi-vendor service marketplace platform built with Node.js, Express.js, and MongoDB.

## 🚀 Features

### User Features
- ✅ Multi-method authentication (Email/Phone with OTP or Password)
- ✅ Profile management with Cloudinary image uploads
- ✅ Multiple delivery addresses with geolocation
- ✅ Service browsing, filtering, and booking
- ✅ Real-time booking status tracking
- ✅ Payment integration (Razorpay, Cash)
- ✅ Ratings and reviews system
- ✅ Nearby shops and products discovery
- ✅ Loyalty points and subscriptions
- ✅ Order history and rebooking

### Service Provider Features
- ✅ Provider registration with document verification
- ✅ Service catalog management
- ✅ Booking management with status updates
- ✅ Earnings dashboard and payout requests
- ✅ Portfolio and certification management
- ✅ Working hours and availability settings
- ✅ Customer ratings and reviews

### Shop/Retailer Features
- ✅ Shop registration with business documents
- ✅ Product catalog management
- ✅ Order processing and tracking
- ✅ Inventory management
- ✅ Payment reconciliation
- ✅ Customer reviews

### Admin Features
- ✅ User, Provider, and Shop management
- ✅ Verification and approval workflow
- ✅ Analytics dashboard
- ✅ Revenue tracking and reports
- ✅ Bulk notifications
- ✅ Category management
- ✅ Dispute handling

## 📋 Prerequisites

- Node.js >= 14.x
- MongoDB >= 4.x
- Cloudinary Account
- Razorpay/Stripe Account (for payments)
- Gmail Account (for email notifications)

## 🛠️ Installation

### 1. Clone the repository
```bash
git clone <repository-url>
cd YetzoBackend
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Create a `.env` file in the root directory and add the following:

```env
# Server Configuration

PORT=5000

# MongoDB
MONGODB_URI=mongodb://localhost:27017/Yetzo

# JWT
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRE=7d
JWT_REFRESH_SECRET=your_refresh_token_secret
JWT_REFRESH_EXPIRE=30d

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Email (Gmail)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_specific_password
EMAIL_FROM=Yetzo <noreply@Yetzo.com>

# Payment Gateway
RAZORPAY_KEY_ID=your_razorpay_key
RAZORPAY_KEY_SECRET=your_razorpay_secret

# Frontend
FRONTEND_URL=http://localhost:3000
```

### 4. Create necessary directories
```bash
mkdir logs uploads
```

### 5. Start the server

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## 📁 Project Structure

```
YetzoBackend/
├── config/                 # Configuration files
│   ├── db.js              # MongoDB connection
│   └── env.js             # Environment variables
├── controllers/           # Business logic
│   ├── authController.js
│   ├── userController.js
│   ├── providerController.js
│   ├── shopController.js
│   ├── bookingController.js
│   ├── productController.js
│   ├── paymentController.js
│   └── adminController.js
├── middleware/            # Custom middleware
│   ├── authMiddleware.js
│   ├── errorHandler.js
│   ├── validateRequest.js
│   └── uploadMiddleware.js
├── models/               # Mongoose schemas
│   ├── User.js
│   ├── ServiceProvider.js
│   ├── Shop.js
│   └── [other models]
├── routes/               # API routes
│   ├── authRoutes.js
│   ├── userRoutes.js
│   └── [other routes]
├── services/             # Helper services
│   ├── emailService.js
│   ├── pushNotification.js
│   ├── paymentService.js
│   └── geoService.js
├── utils/                # Utility functions
│   ├── logger.js
│   ├── responseHandler.js
│   └── constants.js
├── .env                  # Environment variables
├── .gitignore
├── package.json
├── server.js             # Entry point
└── README.md
```

## 🔌 API Endpoints

### Authentication
```
POST   /api/v1/auth/signup              - User registration
POST   /api/v1/auth/send-otp            - Send OTP
POST   /api/v1/auth/verify-otp          - Verify OTP
POST   /api/v1/auth/login               - Login with password
POST   /api/v1/auth/login-otp           - Login with OTP
POST   /api/v1/auth/forgot-password     - Forgot password
POST   /api/v1/auth/reset-password      - Reset password
POST   /api/v1/auth/change-password     - Change password
GET    /api/v1/auth/me                  - Get current user
```

### User Endpoints
```
GET    /api/v1/users/profile            - Get profile
PUT    /api/v1/users/profile            - Update profile
POST   /api/v1/users/address            - Add address
GET    /api/v1/users/bookings           - Get booking history
POST   /api/v1/users/reviews            - Submit review
```

### Provider Endpoints
```
GET    /api/v1/providers/profile        - Get profile
PUT    /api/v1/providers/profile        - Update profile
POST   /api/v1/providers/documents      - Upload documents
POST   /api/v1/providers/services       - Add service
GET    /api/v1/providers/services       - Get services
GET    /api/v1/providers/bookings       - Get bookings
PUT    /api/v1/providers/bookings/:id/status - Update booking status
```

### Booking Endpoints
```
POST   /api/v1/bookings                 - Create booking
GET    /api/v1/bookings/:id             - Get booking details
PUT    /api/v1/bookings/:id/cancel      - Cancel booking
```

### Shop Endpoints
```
GET    /api/v1/shops/profile            - Get shop profile
PUT    /api/v1/shops/profile            - Update profile
POST   /api/v1/shops/products           - Add product
GET    /api/v1/shops/products           - Get products
GET    /api/v1/shops/orders             - Get orders
PUT    /api/v1/shops/orders/:id/status  - Update order status
```

### Product Endpoints
```
GET    /api/v1/products                 - Get all products
GET    /api/v1/products/:id             - Get product details
GET    /api/v1/products/shop/:shopId    - Get shop products
```

### Payment Endpoints
```
POST   /api/v1/payments/create-order    - Create payment order
POST   /api/v1/payments/verify          - Verify payment
POST   /api/v1/payments/cash            - Cash payment
GET    /api/v1/payments/history         - Payment history
```

### Admin Endpoints
```
GET    /api/v1/admin/users              - Get all users
GET    /api/v1/admin/providers          - Get all providers
PUT    /api/v1/admin/providers/:id/verify - Verify provider
GET    /api/v1/admin/analytics/dashboard - Dashboard stats
POST   /api/v1/admin/notifications/send - Send bulk notifications
```

## 🔐 Authentication

The API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

## 🎯 User Roles

- `user` - Regular customers
- `provider` - Service providers
- `shop` - Shop owners/retailers
- `admin` - System administrators
- `superadmin` - Super administrators

## 📝 Example Requests

### 1. User Signup
```bash
curl -X POST http://localhost:5000/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "9876543210",
    "password": "password123",
    "role": "user"
  }'
```

### 2. Login with Password
```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "john@example.com",
    "password": "password123",
    "role": "user"
  }'
```

### 3. Create Booking
```bash
curl -X POST http://localhost:5000/api/v1/bookings \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "service": "service_id",
    "scheduledDate": "2025-11-15",
    "scheduledTime": "10:00 AM",
    "address": {
      "addressLine1": "123 Main St",
      "city": "Mumbai",
      "state": "Maharashtra",
      "pincode": "400001"
    }
  }'
```

## 🔧 Configuration

### Cloudinary Setup
1. Create account at https://cloudinary.com
2. Get API credentials from dashboard
3. Add to .env file

### Email Setup (Gmail)
1. Enable 2-factor authentication
2. Generate app-specific password
3. Add credentials to .env

### Razorpay Setup
1. Create account at https://razorpay.com
2. Get API keys from dashboard
3. Add to .env file

## 🚦 Testing

Check server health:
```bash
curl http://localhost:5000/health
```

## 📊 Database Models

### Main Collections
- users
- serviceproviders
- shops
- services
- products
- bookings
- payments
- reviews
- notifications
- admins

## 🔄 Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error

## 🛡️ Security Features

- Password hashing with bcrypt
- JWT token authentication
- Role-based access control
- Request validation with Joi
- Rate limiting
- Helmet.js security headers
- CORS enabled
- File upload restrictions

## 📈 Future Enhancements

- [ ] Real-time chat with Socket.io
- [ ] Firebase Cloud Messaging for push notifications
- [ ] Advanced analytics and reporting
- [ ] Multi-language support
- [ ] AI-based service recommendations
- [ ] Video consultation feature
- [ ] Referral program
- [ ] Advanced search with Elasticsearch

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## 📄 License

This project is licensed under the ISC License.

## 👥 Support

For support, email support@Yetzo.com or create an issue in the repository.

## 🙏 Acknowledgments

- Express.js
- MongoDB
- Cloudinary
- Razorpay
- Nodemailer

---

**Built with ❤️ for Yetzo**