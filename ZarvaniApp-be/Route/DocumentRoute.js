const express = require('express');
const router = express.Router();
const upload = require('../Utills/multer'); 
const { Authentication, AuthorizeRole } = require("../Middleware/Authentication")

const { 
    uploadUsDocuments, 
    uploadUkDocuments, 
    uploadAusDocuments, 
    uploadNwzDocuments, 
    uploadUaeDocuments, 
    uploadChinaDocuments 
} = require('../Controller/DocumentController');


// United States Document Routes
router.route('/us/social-security-card')
    .post(Authentication,  upload.single('file'), uploadUsDocuments.socialSecurityCard);
router.route('/us/passport')
    .post(Authentication,  upload.single('file'), uploadUsDocuments.passport);
router.route('/us/drivers-license')
    .post(Authentication,  upload.single('file'), uploadUsDocuments.driversLicense);
router.route('/us/birth-certificate')
    .post(Authentication,  upload.single('file'), uploadUsDocuments.birthCertificate);
router.route('/us/green-card')
    .post(Authentication,  upload.single('file'), uploadUsDocuments.greenCard);
router.route('/us/getAlldocument/:id')
    .get(Authentication,  uploadUsDocuments.getAllUsdecument);

// United Kingdom Document Routes
router.route('/uk/national-insurance-number')
    .post(Authentication,  upload.single('file'), uploadUkDocuments.nationalInsuranceNumber);
router.route('/uk/passport')
    .post(Authentication,  upload.single('file'), uploadUkDocuments.passport);
router.route('/uk/drivers-license')
    .post(Authentication,  upload.single('file'), uploadUkDocuments.driversLicense);
router.route('/uk/birth-certificate')
    .post(Authentication,  upload.single('file'), uploadUkDocuments.birthCertificate);
router.route('/uk/biometric-residence-permit')
    .post(Authentication,  upload.single('file'), uploadUkDocuments.biometricResidencePermit);
router.route('/uk/getAlldocument/:id')
    .get(Authentication,  uploadUkDocuments.getAllUkdecument);

// Australia Document Routes
router.route('/aus/medicare-card')
    .post(Authentication,  upload.single('file'), uploadAusDocuments.medicareCard);
router.route('/aus/passport')
    .post(Authentication,  upload.single('file'), uploadAusDocuments.passport);
router.route('/aus/drivers-license')
    .post(Authentication,  upload.single('file'), uploadAusDocuments.driversLicense);
router.route('/aus/birth-certificate')
    .post(Authentication,  upload.single('file'), uploadAusDocuments.birthCertificate);
router.route('/aus/permanent-residency-card')
    .post(Authentication,  upload.single('file'), uploadAusDocuments.permanentResidencyCard);
router.route('/aus/getAlldocument/:id')
    .get(Authentication,  uploadAusDocuments.getAllAusdecument);

// New Zealand Document Routes
router.route('/nwz/medicare-card')
    .post(Authentication,  upload.single('file'), uploadNwzDocuments.medicareCard);
router.route('/nwz/passport')
    .post(Authentication,  upload.single('file'), uploadNwzDocuments.passport);
router.route('/nwz/drivers-license')
    .post(Authentication,  upload.single('file'), uploadNwzDocuments.driversLicense);
router.route('/nwz/birth-certificate')
    .post(Authentication,  upload.single('file'), uploadNwzDocuments.birthCertificate);
router.route('/nwz/permanent-residency-card')
    .post(Authentication,  upload.single('file'), uploadNwzDocuments.permanentResidencyCard);
router.route('/nwz/getAlldocument/:id')
    .get(Authentication,  uploadNwzDocuments.getAllNwzdecument);

// United Arab Emirates Document Routes
router.route('/uae/emirates-id')
    .post(Authentication,  upload.single('file'), uploadUaeDocuments.emiratesId);
router.route('/uae/passport')
    .post(Authentication,  upload.single('file'), uploadUaeDocuments.passport);
router.route('/uae/residence-visa')
    .post(Authentication,  upload.single('file'), uploadUaeDocuments.residenceVisa);
router.route('/uae/labor-card')
    .post(Authentication,  upload.single('file'), uploadUaeDocuments.laborCard);
router.route('/uae/getAlldocument/:id')
    .get(Authentication,  uploadUaeDocuments.getAllUaedecument);


// China Document Routes
router.route('/china/resident-identity-card')
    .post(Authentication,  upload.single('file'), uploadChinaDocuments.residentIdentityCard);
router.route('/china/household-registration')
    .post(Authentication,  upload.single('file'), uploadChinaDocuments.householdRegistration);
router.route('/china/passport')
    .post(Authentication,  upload.single('file'), uploadChinaDocuments.passport);
router.route('/china/drivers-license')
    .post(Authentication,  upload.single('file'), uploadChinaDocuments.driversLicense);
router.route('/china/getAlldocument/:id')
      .get(Authentication,  uploadChinaDocuments.getAllChinadecument);
module.exports = router;
