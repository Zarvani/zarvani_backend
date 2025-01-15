const mongoose = require("mongoose");

// United States Documents
const usDocumentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Userdata",
        required: true
    },
    socialSecurityCard: {
        type: String,
        required: [true, "Social Security Card is required"]
    },
    passport: {
        type: String,
        required: [false, "Passport is required"]
    },
    driversLicense: {
        type: String,
        required: [false, "Driver's License is required"]
    },
    birthCertificate: {
        type: String,
        required: [false, "Birth Certificate is required"]
    },
    greenCard: {
        type: String,
        required: [false, "Green Card is required"]
    },
    isVerified: {
        type: Boolean,
        default: false,
        required: true,
    },
});

// United Kingdom Documents
const ukDocumentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Userdata",
        required: true
    },
    nationalInsuranceNumber: {
        type: String,
        required: [true, "National Insurance Number is required"]
    },
    passport: {
        type: String,
        required: [false, "Passport is required"]
    },
    driversLicense: {
        type: String,
        required: [false, "Driver's License is required"]
    },
    birthCertificate: {
        type: String,
        required: [false, "Birth Certificate is required"]
    },
    biometricResidencePermit: {
        type: String,
        required: [false, "Biometric Residence Permit is required"]
    },
    isVerified: {
        type: Boolean,
        default: false,
        required: true,
    },
});

// Australia Documents
const ausDocumentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Userdata",
        required: true
    },
    medicareCard: {
        type: String,
        required: [true, "Medicare Card is required (Australia only)"]
    },
    passport: {
        type: String,
        required: [false, "Passport is required"]
    },
    driversLicense: {
        type: String,
        required: [false, "Driver's License is required"]
    },
    birthCertificate: {
        type: String,
        required: [false, "Birth Certificate is required"]
    },
    permanentResidencyCard: {
        type: String,
        required: [false, "Permanent Residency Card is required"]
    },
    isVerified: {
        type: Boolean,
        default: false,
        required: true,
    },
});
const NwzDocumentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Userdata",
        required: true
    },
    medicareCard: {
        type: String,
        required: [true, "Medicare Card is required (Australia only)"]
    },
    passport: {
        type: String,
        required: [false, "Passport is required"]
    },
    driversLicense: {
        type: String,
        required: [false, "Driver's License is required"]
    },
    birthCertificate: {
        type: String,
        required: [false, "Birth Certificate is required"]
    },
    permanentResidencyCard: {
        type: String,
        required: [false, "Permanent Residency Card is required"]
    },
    isVerified: {
        type: Boolean,
        default: false,
        required: true,
    },
});
// United Arab Emirates Documents
const uaeDocumentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Userdata",
        required: true
    },
    emiratesId: {
        type: String,
        required: [true, "Emirates ID is required"]
    },
    passport: {
        type: String,
        required: [false, "Passport is required"]
    },
    residenceVisa: {
        type: String,
        required: [false, "Residence Visa is required"]
    },
    laborCard: {
        type: String,
        required: [false, "Labor Card is required"]
    },
    isVerified: {
        type: Boolean,
        default: false,
        required: true,
    },
});

// China Documents
const chinaDocumentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Userdata",
        required: true
    },
    residentIdentityCard: {
        type: String,
        required: [true, "Resident Identity Card is required"]
    },
    householdRegistration: {
        type: String,
        required: [false, "Household Registration (Hukou) is required"]
    },
    passport: {
        type: String,
        required: [false, "Passport is required"]
    },
    driversLicense: {
        type: String,
        required: [false, "Driver's License is required"]
    },
    isVerified: {
        type: Boolean,
        default: false,
        required: true,
    },
});

// Create Models for each country's document schema
const UsDocument = mongoose.model("UsDocument", usDocumentSchema);
const UkDocument = mongoose.model("UkDocument", ukDocumentSchema);
const AusDocument = mongoose.model("ausDocument", ausDocumentSchema);
const nwzDocument = mongoose.model("NwzDocument", NwzDocumentSchema);
const UaeDocument = mongoose.model("UaeDocument", uaeDocumentSchema);
const ChinaDocument = mongoose.model("ChinaDocument", chinaDocumentSchema);

module.exports = {
    UsDocument,
    UkDocument,
    AusDocument,
    UaeDocument,
    ChinaDocument,
    nwzDocument
};
