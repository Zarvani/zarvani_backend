const { VerificationDocument } = require("../Model/UserDataModel");
const { uploadDocument, getAllDocument } = require("../Utills/Uploadfile");

const uploadVerificationDocuments = {
    // Use one common function with document name passed dynamically
    upload: (documentName) => (req, res) => 
        uploadDocument(req, res, VerificationDocument, documentName),

    getAllDocuments: (req, res) => 
        getAllDocument(req, res, VerificationDocument)
};

module.exports = {
    uploadVerificationDocuments,
};
