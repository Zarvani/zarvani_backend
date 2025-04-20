const mongoose=require('mongoose')
const validator = require("validator");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require('crypto');
const { type } = require('os');


const UserSchema = new mongoose.Schema({
   
    firstname: {
        type: String,
        required: false,
        maxLength: [30, "First name cannot exceed 30 characters"],
        minLength: [4, "First name must be at least 4 characters"],
        trim: true
    },
  
    lastname: {
        type: String,
        required: false,
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
        
        
    },
    gender: {
        type: String,
        enum: ["male", "female", "other"],
        required: false
    },
    city: {
        type: String,
        required: false
    },
   state: {
        type: String,
        required: false
    },
    country: {
        type: String,
        required: false
    },
    phoneCode: {
        type: Number,
        required: false
    },
    phoneNumber: {
        type: String,
        required: false
    },
    usertype: {
        type: String,
        enum: ["customer", "serviceprovider","admin"],
        required: [true, "User type is required"]
    },
    service:{
        type: String,
        enum: ["plumbing",
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
                "havc-repair",
                "salon-services",
                "beauty-services",
                "tutoring",
                "legal-services",
                "catering",
                "photography",
                "event-planning",
                "other"],
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