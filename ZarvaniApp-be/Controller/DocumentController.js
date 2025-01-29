const { ServiceProviderDocument} = require("../Model/UserDataModel");
const { uploadDocument,getAllDocument }=require("../Utills/Uploadfile")


// United States Document Uploads
const uploadServiceProviderDocuments = {
    AadharCard: (req, res) => uploadDocument(req, res, ServiceProviderDocument, "AadharCard"),
    driversLicense: (req, res) => uploadDocument(req, res, ServiceProviderDocument, "driversLicense"),
    PanCard: (req, res) => uploadDocument(req, res, ServiceProviderDocument, "PanCard"),
    getAllUsdecument:(req,res)=>getAllDocument(req, res, ServiceProviderDocument)
};




module.exports = {
    uploadServiceProviderDocuments,
};