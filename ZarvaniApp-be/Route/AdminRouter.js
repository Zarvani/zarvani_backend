const express = require("express");
const { getAllUserRequests,
    adminVerifyOrRejectDocument,
     getUserById,
    getAllUsers,
    getAllServiceProviders} = require("../Controller/AdminController");
const { Authentication, AuthorizeRole } = require("../Middleware/Authentication")

const router = express.Router();

router.route('/get-AllServicesProvider-Requests').get(Authentication,AuthorizeRole("admin"),getAllUserRequests);
router.route('/admin-VerifyOrReject-Document').post(Authentication,AuthorizeRole("admin"),adminVerifyOrRejectDocument);
router.route('/admin-get-AllUser').get(Authentication,AuthorizeRole("admin"),getAllUsers);
router.route('/admin-get-servicesProvider').get(Authentication,AuthorizeRole("admin"),getAllServiceProviders);
router.route('/admin-get-AllUserby-id/:id').get(Authentication,AuthorizeRole("admin"),getUserById);


module.exports = router;