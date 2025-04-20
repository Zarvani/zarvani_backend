const express = require('express');
const router = express.Router();
const { createOrder } = require('../Controller/OrderController');
const { Authentication, AuthorizeRole } = require("../Middleware/Authentication")

router.post('/create-order',Authentication, createOrder);

module.exports = router;
