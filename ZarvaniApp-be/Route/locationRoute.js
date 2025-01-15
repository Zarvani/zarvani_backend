const express = require('express');
const { updateLocationIfChanged} = require('../Controller/LocationController');
const { Authentication, AuthorizeRole } = require("../Middleware/Authentication")
const router = express.Router();


router.route('/update-location').post(Authentication,updateLocationIfChanged);

module.exports = router;
