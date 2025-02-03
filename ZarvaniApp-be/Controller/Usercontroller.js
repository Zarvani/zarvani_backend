const UserData= require("../Model/userModel")
const bcrypt = require("bcryptjs");
const setToken = require("../Utills/JtwToken")
const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');
const jwt = require("jsonwebtoken");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { use } = require("../Route/UserRouter");
const { applyAdditionalFilters } = require('../Utills/filterControl'); 
const { filterWorkerByLocation } = require('../Utills/filterControl'); 

const SUPPORTED_PLATFORMS = {
    web: ['accessToken', 'email', 'displayName'],
    ios: ['idToken', 'email', 'displayName'],
    android: ['idToken', 'email', 'displayName'],
    macos: ['accessToken', 'email', 'displayName']
};

const createUser = async (req, res) => {
    try {
        const { firstname, midname, lastname, gender, city,state,phoneCode,phoneNumber, country, email, password, usertype } = req.body;

        // Check if the user already exists
        const existingUser = await UserData.findOne({ email });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "User already exists"
            });
        }

        // Create the new user
        const newUser = await UserData.create({
            firstname,
            midname,
            lastname,
            gender,
            city,
            state,
            country,
            phoneCode,
            phoneNumber,
            email,
            password,
            usertype,
            avatar: {
                user_id: " ",
                url: " "
            },
       });

        setToken(newUser, 201, res);
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error"
        });
    }
};
const Loginuser = async (req, res) => {
    let { email, password } = req.body;

    if (!email || !password) {
        return res.status(500).json({
            success: false,
            message: "Please fill email and password"
        });
    }

    try {
        let userinfo = await UserData.findOne({ email });
        if (!userinfo) {
            return res.status(500).json({
                success: false,
                message: "Please enter correct credentials"
            });
        }

        const securedpassword = userinfo.password;
        const validPassword = await bcrypt.compare(password, securedpassword);
        if (!validPassword) {
            return res.status(500).json({
                success: false,
                message: "Please enter correct credentials"
            });
        }

        setToken(userinfo, 200, res);
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "Internal server error in login API"
        });
    }
};


const loginWithGoogle = async (req, res) => {
    const { platform, ...authData } = req.body;

    // Validate if platform is supported
    if (!SUPPORTED_PLATFORMS[platform]) {
        return res.status(400).json({
            success: false,
            message: `Unsupported platform: ${platform}`
        });
    }

    // Validate required fields for the platform
    const missingFields = SUPPORTED_PLATFORMS[platform].filter(
        field => !authData[field]
    );

    if (missingFields.length > 0) {
        return res.status(400).json({
            success: false,
            message: `Missing required fields for ${platform}: ${missingFields.join(', ')}`
        });
    }

    try {
        // Verify the token based on platform
        const verifiedData = await verifyTokenByPlatform(platform, authData);

        if (!verifiedData.success) {
            return res.status(401).json({
                success: false,
                message: verifiedData.message
            });
        }

        // Find or create user in database
        let userinfo = await UserData.findOne({ email: verifiedData.email });

        if (!userinfo) {
            // Create new user with platform-specific data
            userinfo = new UserData({
                email: verifiedData.email,
                name: verifiedData.name,
                password: "", // No password for OAuth login
                authProvider: "google",
                googleId: verifiedData.googleId,
                platforms: [platform], // Track which platforms the user uses
                lastLoginPlatform: platform
            });
        } else {
            // Update existing user's information
            userinfo.name = verifiedData.name;
            userinfo.authProvider = "google";
            userinfo.googleId = verifiedData.googleId;
            
            // Add platform if it's not already recorded
            if (!userinfo.platforms.includes(platform)) {
                userinfo.platforms.push(platform);
            }
            userinfo.lastLoginPlatform = platform;
        }

        await userinfo.save();

        // Generate platform-specific tokens if needed
        const tokens = await generatePlatformTokens(platform, userinfo);

        // Set token in response
        setToken(userinfo, 200, res, tokens);

    } catch (error) {
        console.error(`Error in Google login API (${platform}):`, error);
        return res.status(500).json({
            success: false,
            message: "Authentication failed",
            details: error.message
        });
    }
};

// Platform-specific token verification
async function verifyTokenByPlatform(platform, authData) {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

    switch (platform) {
        case 'web':
        case 'macos':
            try {
                const tokenInfo = await client.getTokenInfo(authData.accessToken);
                return {
                    success: true,
                    email: tokenInfo.email,
                    name: authData.displayName,
                    googleId: tokenInfo.sub
                };
            } catch (error) {
                return { success: false, message: "Invalid access token" };
            }

        case 'ios':
        case 'android':
            try {
                const ticket = await client.verifyIdToken({
                    idToken: authData.idToken,
                    audience: platform === 'ios' 
                        ? process.env.GOOGLE_IOS_CLIENT_ID 
                        : process.env.GOOGLE_ANDROID_CLIENT_ID
                });
                const payload = ticket.getPayload();
                return {
                    success: true,
                    email: payload.email,
                    name: payload.name,
                    googleId: payload.sub
                };
            } catch (error) {
                return { success: false, message: "Invalid ID token" };
            }

        default:
            return { success: false, message: "Unsupported platform" };
    }
}

// Generate additional tokens if needed for specific platforms
async function generatePlatformTokens(platform, userinfo) {
    const tokens = {};

    switch (platform) {
        case 'ios':
            // Generate any iOS specific tokens
            tokens.pushToken = await generateApplePushToken(userinfo);
            break;
        case 'android':
            // Generate any Android specific tokens
            tokens.fcmToken = await generateFirebaseToken(userinfo);
            break;
        // Add other platform-specific token generation as needed
    }

    return tokens;
}
 
  const loginWithFacebook = async (req, res) => {
    const { accessToken } = req.body;

    if (!accessToken) {
        return res.status(400).json({
            success: false,
            message: "Access token is required",
        });
    }

    try {
       
        const response = await axios.get(`https://graph.facebook.com/me`, {
            params: {
                fields: 'id,first_name,last_name,email', 
                access_token: accessToken
            }
        });

        const data = response.data;
        if (!data.email) {
            return res.status(400).json({
                success: false,
                message: "Unable to retrieve email from Facebook",
            });
        }

        let userinfo = await UserData.findOne({ email: data.email });

        if (!userinfo) {
            userinfo = new UserData({
                email: data.email,
                firstname: data.first_name,
                lastname: data.last_name,
                password: "", 
            });
            await userinfo.save();
        }
        setToken(userinfo, 200, res);

    } catch (error) {
        console.error("Error in Facebook login:", error.message);
        return res.status(500).json({
            success: false,
            message: "Internal server error in Facebook login API",
        });
    }
};




const Logout = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "No token provided. Unauthorized."
            });
        }


        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        res.clearCookie("token", {
            httpOnly: true,
        });

        res.status(200).json({
            success: true,
            message: "Logged out successfully"
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || "Internal server error in logout API"
        });
    }
};

const getProfile = async (req, res) => {
    try {
        const userprofile = await UserData.findById(req.user.id);

        if (!userprofile) {
            return res.status(404).json({
                success: false,
                message: "User profile not found.",
            });
        }

        res.status(200).json({
            success: true,
            userprofile,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: "Profile is not accessible.",
            error: error.message, 
        });
    }
};

const getAllProvider = async (req, res) => {
    try {
        const { usertype, _id: userId } = req.user;
        let userdetail;
        const { country, state, gender, city,radius, latitude, longitude } = req.query;

        if (usertype === "Customer") {
            // Get all serviceProvide
            userdetail = await UserData.find({ usertype: "serviceProvider" });

            // Apply additional filters (country, state, gender, city, etc.)
            userdetail = applyAdditionalFilters(userdetail, { country, state, gender, city});

            // If radius filter is provided (in km)
            if (radius && latitude && longitude) {
                // Filter donors based on location and radius
                userdetail = await filterWorkerByLocation(userdetail, radius, latitude, longitude);
            }

        } else {
            return res.status(403).json({
                success: false,
                message: "Unauthorized access.",
            });
        }

        const transformedUserDetails = userdetail.map(user => {
            return {
                id: user.id,
                firstname: user.firstname,
                middlename: user.middlename || '',
                lastname: user.lastname,
                gender: user.gender,
                country: user.country,
                state: user.state,
                city: user.city,
                usertype:user.usertype,
            };
        });

        res.status(200).json({
            success: true,
            userdetail: transformedUserDetails,
        });
    } catch (error) {
        console.error(error);
        res.status(400).json({
            success: false,
            message: "Unable to access getAllProvider function.",
        });
    }
};

const getAllProviderDetails = async (req, res) => {
    try {
        const userId  = req.params.id; 
        const UserDetails = await UserData.findById(userId)
        if (!UserDetails) { 
            return res.status(404).json({
                 success: false, message: "User not found.", }); 
                }
        res.status(200).json({
            success: true,
            UserDetails,
        });
    } catch (error) {
        console.error(error);
        res.status(400).json({
            success: false,
            message: "Unable to access getdoner function.",
        });
    }
};
const updateProfileid = async (req, res) => {
    try {
        const { firstname, middlename, lastname, dateofbirth, gender,city, state, country,phoneCode,phoneNumber} = req.body;

        const newUserData = {
            firstname,
            middlename,
            lastname,
            dateofbirth,
            gender,
            city,
            state,
            country,
            phoneCode,
            phoneNumber 
        };
        const userprofile = await UserData.findByIdAndUpdate(req.user.id, newUserData, {
            new: true,
            runValidators: true, 
            useFindAndModify: false, 
        });

        if (!userprofile) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            user: userprofile
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Server error: Unable to update profile'
        });
    }
};
const updateEmail = async (req, res) => {
    try {
        const { userId, newEmail } = req.body;
        if (!userId || !newEmail) {
            return res.status(400).json({ 
                success: false, 
                message: "User ID and new email are required" 
            });
        }
        const user = await UserData.findByIdAndUpdate(
            userId,
            { email: newEmail },
            { new: true, runValidators: true }
        );

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: "User not found" 
            });
        }

        res.status(200).json({ 
            success: true, 
            message: "Email updated successfully", 
        });
    } catch (error) {
        console.error("Error updating email:", error.message);
        res.status(500).json({ 
            success: false, 
            message: "An error occurred while updating the email" 
        });
    }
};
const updateProfilePassword = async (req, res) => {
    try {
        const user = await UserData.findById(req.user.id);

        if (!user) {
            return res.status(400).json({ success: false, message: "Please enter correct credentials" });
        }

        const isPasswordValid = await bcrypt.compare(req.body.oldPassword, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ success: false, message: "Old password is not correct" });
        }

        if (req.body.newPassword !== req.body.confirmPassword) {
            return res.status(400).json({ success: false, message: "Passwords do not match" });
        }

        user.password = req.body.newPassword;
        await user.save();

        res.status(200).json({ success: true, message: "Password update successfully" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: "Failed to update password" });
    }
};

const forgetPassword = async (req, res) => {
    try {
        const { email, newPassword } = req.body;
        const userdetail = await UserData.findOne({ email });

        if (!userdetail) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Ensure password is not empty or weak
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ success: false, message: "Password is too weak" });
        }

        userdetail.password = newPassword;
        userdetail.resetPasswordToken = undefined;
        userdetail.resetPasswordExpire = undefined;
        await userdetail.save();

        res.status(200).json({ success: true, message: "Password reset successfully" });
    } catch (error) {
        res.status(400).json({ success: false, message: "Error in resetting password" });
    }
};


const checkProfileCompletion = async (req, res) => {
    try {
        const userprofile = await UserData.findById(req.user.id);

        if (!userprofile) {
            return res.status(404).json({
                success: false,
                message: "User profile not found.",
            });
        }

        const requiredFields = [
            'firstname', 'lastname', 'dateofbirth', 'gender', 'email', 
            'city', 'state', 'country',  'phoneNumber', 
            'usertype'
        ];

        let missingFields = [];

        // Check each required field
        requiredFields.forEach(field => {
            if (!userprofile[field] || (typeof userprofile[field] === 'string' && userprofile[field].trim() === '')) {
                missingFields.push(field);
            }
        });

        const notify = missingFields.length > 0;

        res.status(200).json({
            success: true,
            notify,
            missingFields
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: "Profile is not accessible.",
            error: error.message,
        });
    }
};


// Upload Profile Photo Handler
const uploadProfilePhoto = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded.",
            });
        }
        const s3 = new S3Client({
            region: process.env.AWS_S3_REGION_NAME,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
        });
        const userId  = req.user.id; 
        const fileContent = req.file.buffer; 
        const fileName = `profile_photos/${Date.now()}_${req.file.originalname}`; // Generate file name
        // S3 upload parameters
        const uploadParams = {
            Bucket: process.env.AWS_STORAGE_BUCKET_NAME, 
            Key: fileName, 
            Body: fileContent,
            ContentType: req.file.mimetype,  
        };

        // Upload file to S3
        const command = new PutObjectCommand(uploadParams);
        const data = await s3.send(command);

        // Update the database with the file URL (use the S3 URL returned by AWS)
        const updatedUser = await UserData.findByIdAndUpdate(
            userId,
            {
                avatar: {
                    user_id: userId,
                    url: `https://${process.env.AWS_STORAGE_BUCKET_NAME}.s3.${process.env.AWS_S3_REGION_NAME}.amazonaws.com/${fileName}`, // Construct URL
                },
            },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Profile photo uploaded and updated successfully.",
            user: updatedUser,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
        });
    }
};

const deleteProfilePhoto = async (req, res) => {
    try {
        const userId = req.user.id;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID is required.",
            });
        }

        const updatedUser = await UserData.findByIdAndUpdate(
            userId,
            { 
                avatar: null, 
            },
            { new: true } 
        );

        if (!updatedUser) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Profile photo deleted successfully.",
          
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
        });
    }
};

const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        const user = await UserData.findById(id);
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: `User does not exist with the ID: ${id}` 
            });
        }
        await user.deleteOne();
        res.status(200).json({ 
            success: true, 
            message: "The account has been successfully deleted" 
        });
    } catch (error) {
        console.error("Error deleting user:", error.message);
        res.status(500).json({ 
            success: false, 
            message: "An error occurred while deleting the user" 
        });
    }
};

module.exports = {
    createUser, 
    Loginuser,
    Logout,
    getProfile,
    getAllProvider,
    loginWithGoogle,
    loginWithFacebook,
    updateProfileid,
    updateEmail,
    updateProfilePassword,
    forgetPassword,
    checkProfileCompletion,
    uploadProfilePhoto,
    deleteProfilePhoto,
    deleteUser,
    getAllProviderDetails,
}
