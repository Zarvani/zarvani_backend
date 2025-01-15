const express = require("express");
const { sendOtp, verifyOtp} = require("../Controller/Verifycontroller");
const { Authentication, AuthorizeRole } = require("../Middleware/Authentication")

const router = express.Router();

router.route('/send-otp').post(sendOtp);
router.route('/verify-otp').post(verifyOtp);




module.exports = router;