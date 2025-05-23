const express = require("express");
const { getAllUserRequests,
    adminVerifyOrRejectDocument,
     getUserById,
    getAllUsers,
    getAllServiceProviders} = require("../Controller/AdminController");
const { Authentication, AuthorizeRole } = require("../Middleware/Authentication")

const router = express.Router();

router.route('/get-AllUser-Requests').get(Authentication,AuthorizeRole("Admin"),getAllUserRequests);
router.route('/admin-VerifyOrReject-Document').post(Authentication,AuthorizeRole("Admin"),adminVerifyOrRejectDocument);
router.route('/admin-get-AllUser').get(Authentication,AuthorizeRole("Admin"),getAllUsers);
router.route('/admin-get-servicesProvider').get(Authentication,AuthorizeRole("Admin"),getAllServiceProviders);
router.route('/admin-get-AllUserby-id/:id').get(Authentication,AuthorizeRole("Admin"),getUserById);


module.exports = router;