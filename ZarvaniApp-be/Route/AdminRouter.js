const express = require("express");
const { getAllUserRequests,
    adminVerifyOrRejectDocument,
    getAllUser,
    getUserByID,} = require("../Controller/AdminController");
const { Authentication, AuthorizeRole } = require("../Middleware/Authentication")

const router = express.Router();

router.route('/get-AllUser-Requests').get(Authentication,AuthorizeRole("Admin"),getAllUserRequests);
router.route('/admin-VerifyOrReject-Document').post(Authentication,AuthorizeRole("Admin"),adminVerifyOrRejectDocument);
router.route('/admin-get-AllUser').get(Authentication,AuthorizeRole("Admin"),getAllUser);
router.route('/admin-get-AllUserby-id/:id').get(Authentication,AuthorizeRole("Admin"),getUserByID);


module.exports = router;