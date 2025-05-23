const { VerificationDocumentSchema } = require("../Model/UserDataModel");
const UserData = require("../Model/userModel");

const getAllUserRequests = async (req, res) => {
    try {
        const documents = await VerificationDocumentSchema.find({ isVerified: false })
            .populate('userId')
            .select('userId');

        res.status(200).json({
            success: true,
            documents,
        });
    } catch (error) {
        console.error("Error fetching document requests:", error);
        res.status(500).json({ message: "Error fetching document requests", error });
    }
};

const adminVerifyOrRejectDocument = async (req, res) => {
    try {
        const { documentId, action } = req.params;
        if (!documentId || !action) {
            return res.status(400).json({ message: "Document ID and action are required" });
        }

        const document = await VerificationDocumentSchema.findById(documentId);
        
        if (!document) {
            return res.status(404).json({ message: "Document not found" });
        }

        if (action === "approve") {
            document.isVerified = true;
            await document.save();
            return res.status(200).json({
                success: true,
                message: "Document has been verified successfully",
            });
        } else if (action === "reject") {
            await uploadServiceProviderDocuments.findByIdAndDelete(documentId);
            return res.status(200).json({
                success: true,
                message: "Document has been rejected and deleted successfully",
            });
        } else {
            return res.status(400).json({ message: "Invalid action. Use 'approve' or 'reject'" });
        }
    } catch (error) {
        console.error("Error processing document:", error);
        res.status(500).json({ message: "Error processing document", error });
    }
};

const getAllServiceProviders = async (req, res) => {
    try {
        const serviceProviders = await UserData.find({ usertype: 'serviceprovider' })
            .select('-password') // Exclude password field
            .sort({ createdAt: -1 }); // Sort by newest first

        if (!serviceProviders || serviceProviders.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No service providers found"
            });
        }

        res.status(200).json({
            success: true,
            count: serviceProviders.length,
            serviceProviders
        });
    } catch (error) {
        console.error("Error fetching service providers:", error.message);
        return res.status(500).json({
            success: false,
            message: "Internal server error while fetching service providers"
        });
    }
};

// Get all users (excluding service providers)
const getAllUsers = async (req, res) => {
    try {
        const users = await UserData.find({ usertype: { $ne: 'serviceprovider' } })
            .select('-password') // Exclude password field
            .sort({ createdAt: -1 }); // Sort by newest first

        if (!users || users.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No users found"
            });
        }

        res.status(200).json({
            success: true,
            count: users.length,
            users
        });
    } catch (error) {
        console.error("Error fetching users:", error.message);
        return res.status(500).json({
            success: false,
            message: "Internal server error while fetching users"
        });
    }
};

// Get user or service provider details by ID
const getUserById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "User ID is required"
            });
        }

        const user = await UserData.findById(id).select('-password'); // Exclude password field

        if (!user) {
            return res.status(404).json({
                success: false,
                message: `User not found with ID: ${id}`
            });
        }

        res.status(200).json({
            success: true,
            user,
            userType: user.usertype === 'serviceprovider' ? 'Service Provider' : 'Regular User'
        });
    } catch (error) {
        console.error("Error fetching user by ID:", error.message);
        
        // Handle invalid ObjectId format
        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID format"
            });
        }

        return res.status(500).json({
            success: false,
            message: "Internal server error while fetching user details"
        });
    }
};

module.exports = {
    getAllUserRequests,
    adminVerifyOrRejectDocument,
   getUserById,
    getAllUsers,
    getAllServiceProviders
};