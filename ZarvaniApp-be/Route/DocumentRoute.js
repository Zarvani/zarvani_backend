const express = require('express');
const router = express.Router();
const upload = require('../Utills/multer'); 
const { Authentication, AuthorizeRole } = require("../Middleware/Authentication")

const { 
    uploadServiceProviderDocuments
} = require('../Controller/DocumentController');


router.route('/Document/AadharCard')
    .post(Authentication,  upload.single('file'), uploadServiceProviderDocuments.AadharCard);
router.route('/Document/drivers-license')
    .post(Authentication,  upload.single('file'), uploadServiceProviderDocuments.ProfessionalDocument);
router.route('/Document/PanCard')
    .post(Authentication,  upload.single('file'), uploadServiceProviderDocuments.PanCard);
router.route('/getAlldocument/:id')
    .get(Authentication,  uploadServiceProviderDocuments.getAllUsdecument);


    module.exports = router;
