const { UsDocument, UkDocument, AusDocument, UaeDocument, ChinaDocument, nwzDocument } = require("../Model/UserDataModel");
const { uploadDocument,getAllDocument }=require("../Utills/Uploadfile")


// United States Document Uploads
const uploadUsDocuments = {
    socialSecurityCard: (req, res) => uploadDocument(req, res, UsDocument, "socialSecurityCard"),
    passport: (req, res) => uploadDocument(req, res, UsDocument, "passport"),
    driversLicense: (req, res) => uploadDocument(req, res, UsDocument, "driversLicense"),
    birthCertificate: (req, res) => uploadDocument(req, res, UsDocument, "birthCertificate"),
    greenCard: (req, res) => uploadDocument(req, res, UsDocument, "greenCard"),
    getAllUsdecument:(req,res)=>getAllDocument(req, res, UsDocument)
};

// United Kingdom Document Uploads
const uploadUkDocuments = {
    nationalInsuranceNumber: (req, res) => uploadDocument(req, res, UkDocument, "nationalInsuranceNumber"),
    passport: (req, res) => uploadDocument(req, res, UkDocument, "passport"),
    driversLicense: (req, res) => uploadDocument(req, res, UkDocument, "driversLicense"),
    birthCertificate: (req, res) => uploadDocument(req, res, UkDocument, "birthCertificate"),
    biometricResidencePermit: (req, res) => uploadDocument(req, res, UkDocument, "biometricResidencePermit"),
    getAllUkdecument:(req,res)=>getAllDocument(req, res, UkDocument)
};

// Australia Document Uploads
const uploadAusDocuments = {
    medicareCard: (req, res) => uploadDocument(req, res, AusDocument, "medicareCard"),
    passport: (req, res) => uploadDocument(req, res, AusDocument, "passport"),
    driversLicense: (req, res) => uploadDocument(req, res, AusDocument, "driversLicense"),
    birthCertificate: (req, res) => uploadDocument(req, res, AusDocument, "birthCertificate"),
    permanentResidencyCard: (req, res) => uploadDocument(req, res, AusDocument, "permanentResidencyCard"),
    getAllAusdecument:(req,res)=>getAllDocument(req, res, AusDocument)
};

// New Zealand Document Uploads
const uploadNwzDocuments = {
    medicareCard: (req, res) => uploadDocument(req, res, nwzDocument, "medicareCard"),
    passport: (req, res) => uploadDocument(req, res, nwzDocument, "passport"),
    driversLicense: (req, res) => uploadDocument(req, res, nwzDocument, "driversLicense"),
    birthCertificate: (req, res) => uploadDocument(req, res, nwzDocument, "birthCertificate"),
    permanentResidencyCard: (req, res) => uploadDocument(req, res, nwzDocument, "permanentResidencyCard"),
    getAllNwzdecument:(req,res)=>getAllDocument(req, res, NwzDocument)
};

// United Arab Emirates Document Uploads
const uploadUaeDocuments = {
    emiratesId: (req, res) => uploadDocument(req, res, UaeDocument, "emiratesId"),
    passport: (req, res) => uploadDocument(req, res, UaeDocument, "passport"),
    residenceVisa: (req, res) => uploadDocument(req, res, UaeDocument, "residenceVisa"),
    laborCard: (req, res) => uploadDocument(req, res, UaeDocument, "laborCard"),
    getAllUaedecument:(req,res)=>getAllDocument(req, res, UaeDocument)
};

// China Document Uploads
const uploadChinaDocuments = {
    residentIdentityCard: (req, res) => uploadDocument(req, res, ChinaDocument, "residentIdentityCard"),
    householdRegistration: (req, res) => uploadDocument(req, res, ChinaDocument, "householdRegistration"),
    passport: (req, res) => uploadDocument(req, res, ChinaDocument, "passport"),
    driversLicense: (req, res) => uploadDocument(req, res, ChinaDocument, "driversLicense"),
    getAllChinadecument:(req,res)=>getAllDocument(req, res, ChinaDocument)
};

module.exports = {
    uploadUsDocuments,
    uploadUkDocuments,
    uploadAusDocuments,
    uploadNwzDocuments,
    uploadUaeDocuments,
    uploadChinaDocuments
};