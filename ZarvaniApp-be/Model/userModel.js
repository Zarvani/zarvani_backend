const mongoose=require('mongoose')
const validator = require("validator");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require('crypto');

const organCategories = [
    'Heart', 'Lungs', 'Liver', 'Kidneys', 'Pancreas', 'Intestines',
    'Corneas', 'Skin', 'Heart Valves', 'Blood Vessels and Veins',
    'Tendons and Ligaments', 'Bone', 'Uterus', 'Ovaries', 'Eggs (Oocytes)',
    'Fallopian Tubes', 'Testicles', 'Sperm', 'Bone Marrow and Stem Cells',
    'Blood and Plasma', 'Umbilical Cord Blood', 'Liver Segment',
    'Kidney', 'Lung Lobe', 'Skin (partial)', 'Bone Marrow and Stem Cells (regenerative)'
  ];

const UserSchema = new mongoose.Schema({
    authProvider: {
        type: String,
        enum: ['local', 'google', 'apple', 'facebook'],
        default: 'local'
    },
    socialIds: {
        google: String,
        apple: String,
        facebook: String
    },
    platforms: [{
        type: String,
        enum: ['web', 'ios', 'android', 'macos'],
    }],
    lastLoginPlatform: {
        type: String,
        enum: ['web', 'ios', 'android', 'macos']
    },
    deviceTokens: [{
        platform: {
            type: String,
            enum: ['ios', 'android', 'web']
        },
        token: String,
        lastUsed: Date
    }],

    stripeCustomerId: String,
    firstname: {
        type: String,
        required: [true, "First name is required"],
        maxLength: [30, "First name cannot exceed 30 characters"],
        minLength: [4, "First name must be at least 4 characters"],
        trim: true
    },
    middlename: {
        type: String,
        required: false,
        maxLength: [30, "Middle name cannot exceed 30 characters"],
        minLength: [4, "Middle name must be at least 4 characters"],
        trim: true
    },
    lastname: {
        type: String,
        required: [true, "Last name is required"],
        maxLength: [30, "Last name cannot exceed 30 characters"],
        minLength: [4, "Last name must be at least 4 characters"],
        trim: true
    },
    email: {
        type: String,
        required: [true, "Email is required"],
        unique: true, 
        validate: [validator.isEmail, "Please enter a valid email"],
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: function() {
            return this.authProvider === 'local';
        },
        minLength: [8, "Password must be at least 8 characters"],
        // select: false
    },
    dateofbirth: {
        type: Date,
        required: false
    },
    gender: {
        type: String,
        enum: ["Male", "Female", "Other"],
        required: false
    },
    bloodGroup: {
        type: String,
        enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"],
        required: false
    },
    city: {
        type: String,
        required: [false, "City is required"]
    },
   state: {
        type: String,
        required: [false, "State is required"]
    },
    country: {
        type: String,
        required: [false, "Country is required"]
    },
    bloodGroup: {
        type: String,
        enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"],
        required: [false, "Blood group is required"]
    }, 
    phoneCode: {
        type: Number,
        required: [false, "Phone number is required"],
    },
    phoneNumber: {
        type: String,
        required: [false, "Phone number is required"],
    },
    usertype: {
        type: String,
        enum: ["recipient", "donor","Admin"],
        required: [false, "User type is required"]
    },
    organDonations: {
    type: [String], 
    validate: {
      validator: function (value) {
        return value.every((item) => organCategories.includes(item));
      },
      message: "Invalid doner type selected"
    },
    required: [false, "Doner type is required"]
  },
    avatar: {
        user_id: {
            type: String,
            require: true
        },
        url: {
            type: String,
            require: true
        }
    },
    resetPasswordToken: String,
    resetPasswordExpire: Date
})
UserSchema.pre("save", async function (next) {
    if (!this.isModified("password")) {
        next();
    }
    this.password = await bcrypt.hash(this.password, 10)
})
// generate jwt tokens and store in cookie
UserSchema.methods.getJwTToken = function () {
    return jwt.sign({ id: this._id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE
    })
}
UserSchema.methods.getJwTRefreshToken = function () {
    return jwt.sign({ id: this._id }, process.env.JWT_REFRESH_SECRET, {
        expiresIn: process.env.JWT_REFRESH_EXPIRE 
    });
};
// genertaing token for forgate password
UserSchema.methods.getResetPasswordToken = function () {
    // Generate reset token
    const resetToken = crypto.randomBytes(20).toString("hex");
    // Hash the reset token
    const hashedToken = crypto.createHash("sha256")
    .update(resetToken)
    .digest("hex");

    this.resetPasswordToken = hashedToken;
    this.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 minutes expiration

    return resetToken;
};

// Method to validate password
UserSchema.methods.comparePassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Method to update device token
UserSchema.methods.updateDeviceToken = function(platform, token) {
    const tokenIndex = this.deviceTokens.findIndex(
        device => device.platform === platform
    );
    
    if (tokenIndex > -1) {
        this.deviceTokens[tokenIndex].token = token;
        this.deviceTokens[tokenIndex].lastUsed = new Date();
    } else {
        this.deviceTokens.push({
            platform,
            token,
            lastUsed: new Date()
        });
    }
};
module.exports = mongoose.model("Userdata", UserSchema);