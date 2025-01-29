const mongoose = require("mongoose");

const DocumentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Userdata",
        required: true
    },
    AadharCard: {
        type: String,
        required: [true, "AadharCard is required"]
    },
    driversLicense: {
        type: String,
        required: [false, "driversLicense is required"]
    },
    PanCard: {
        type: String,
        required: [false, "PanCard is required"]
    },
    profession:{
        type: String,
        required: [true, "AadharCard is required"]
    },
    isVerified: {
        type: Boolean,
        default: false,
        required: true,
    },
});

const ServiceProviderDocument = mongoose.model("ServiceProviderDocument", DocumentSchema);

module.exports = {
    ServiceProviderDocument,
};
