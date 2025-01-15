const express = require('express');
const PaymentController = require('../Controller/RzrpaymentController');
const { Authentication, AuthorizeRole } = require("../Middleware/Authentication")

const router = express.Router();

router.post('/orders', Authentication, PaymentController.createOrder);
router.post('/verify', Authentication, PaymentController.verifyPayment);
router.get('/subscription-status',Authentication, PaymentController.verifySubscription)
// router.post('/webhook', Authentication.handleWebhook);
router.post('/select-single-doner', Authentication, PaymentController.deductCreditWithSelectedDoner);
router.get('/get-allSelected-doner', Authentication, PaymentController.getAllSelectedDoner);
module.exports = router;
