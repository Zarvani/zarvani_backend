const mongoose = require("mongoose");

const VerificationDocumentSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Userdata",
        required: true
    },
    documentName: {
        type: String,
        required: [true, "Document name is required"]
    },
    documentValue: {
        type: String,
        required: [true, "Document value is required"]
    },
    isVerified: {
        type: Boolean,
        default: false,
        required: true,
    },
});

const VerificationDocument = mongoose.model("VerificationDocument", VerificationDocumentSchema);

module.exports = {
    VerificationDocument,
};
