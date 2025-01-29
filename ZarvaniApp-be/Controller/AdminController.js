const { uploadServiceProviderDocuments } = require("../Model/UserDataModel");
const UserData = require("../Model/userModel");

const getAllUserRequests = async (req, res) => {
    try {
        const documents = await uploadServiceProviderDocuments.find({ isVerified: false })
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

        const document = await uploadServiceProviderDocuments.findById(documentId);
        
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

const getAllUser = async (req, res) => {
    try {
        const userdetail = await UserData.find();

        res.status(200).json({
            success: true,
            userdetail,
        });
    } catch (error) {
        res.status(500).json({ message: "Error fetching users", error });
    }
};

const getUserByID = async (req, res) => {
    try {
        const userId = req.params.id;
        const userprofile = await UserData.findById(userId);

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
        res.status(400).json({
            success: false,
            message: "Error fetching user profile",
            error: error.message,
        });
    }
};

module.exports = {
    getAllUserRequests,
    adminVerifyOrRejectDocument,
    getAllUser,
    getUserByID,
};