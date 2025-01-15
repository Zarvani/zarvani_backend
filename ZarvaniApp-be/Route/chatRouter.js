const express = require('express');
const {  createOrGetConversation,
    sendMessage, 
    fetchMessages,
    getConversationByDonor,
    senderDetails} = require('../Controller/chatController');
const { Authentication, AuthorizeRole } = require("../Middleware/Authentication")

const router = express.Router();

// Twilio Routes
router.route('/conversation').post(Authentication,createOrGetConversation);
router.route('/message').post(Authentication,sendMessage);
router.route("/fetch-message/:id").get(fetchMessages);
router.route("/conversation/donor").post(Authentication,AuthorizeRole("donor"),getConversationByDonor);
router.route("/conversation/senderdetails").get(Authentication,senderDetails);

module.exports = router;
