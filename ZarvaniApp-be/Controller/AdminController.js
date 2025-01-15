const { UsDocument, UkDocument, AusDocument, UaeDocument, ChinaDocument, nwzDocument } = require("../Model/UserDataModel");
const UserData= require("../Model/userModel")

const getAllUserRequests = async (req, res) => {
    try {
        const models = [
            UsDocument,
            UkDocument,
            AusDocument,
            UaeDocument,
            ChinaDocument,
            nwzDocument
        ];

        const documentPromises = models.map(model =>
            model.find({ isVerified: false })
                .populate('userId')
                .select('userId') 
        );
      
        const documentResults = await Promise.all(documentPromises);
        const allDocuments = documentResults.flat();


        res.status(200).json({
            success: true,
            documents: allDocuments,
        });
    } catch (error) {
        console.error("Error fetching document requests:", error); // Log detailed error
        res.status(500).json({ message: "Error fetching document requests", error });
    }
};


const adminVerifyOrRejectDocument = async (req, res) => {
    try {
        const { documentId, action } = req.params; 
        if (!documentId || !action) {
            return res.status(400).json({ message: "Document ID and action are required" });
        }

        const documentModels = [UsDocument, UkDocument, AusDocument, UaeDocument, ChinaDocument, nwzDocument];
        let documentFound = false;

        for (const Model of documentModels) {
            const document = await Model.findById(documentId);

            if (document) {
                documentFound = true;

                if (action === "approve") {
                    document.isVerified = true;
                    await document.save();
                    return res.status(200).json({
                        success: true,
                        message: "Document has been verified successfully",
                    });
                } else if (action === "reject") {
                    await Model.findByIdAndDelete(documentId);
                    return res.status(200).json({
                        success: true,
                        message: "Document has been rejected and deleted successfully",
                    });
                } else {
                    return res.status(400).json({ message: "Invalid action. Use 'approve' or 'reject'" });
                }
            }
        }

        if (!documentFound) {
            return res.status(404).json({ message: "Document not found" });
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
        })
    } catch (error) {
        return next(new ErrorHandle("getAllUser is not access ", 400))
    }
};
const getUserByID = async (req, res) => {
    try {
        const userId=req.params.id
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
        return res.status(400).json({
            success: false,
            message: "Profile is not accessible.",
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
