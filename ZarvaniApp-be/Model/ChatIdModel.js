const mongoose = require("mongoose");

// United States Documents
const chatIdSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Userdata",
        required: true
    },
    conversationId: {
        type: String,
        required: [true]
    },
    recipientId: {
        type: String,
        required: [true]
    },
})
module.exports = mongoose.model("chatId", chatIdSchema);