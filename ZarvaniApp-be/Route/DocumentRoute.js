const express = require('express');
const router = express.Router();
const upload = require('../Utills/multer'); 
const { Authentication, AuthorizeRole } = require("../Middleware/Authentication")

const { 
    uploadVerificationDocuments
} = require('../Controller/DocumentController');

router.post('/document/upload/:documentName', 
    Authentication, 
    upload.single('file'), 
    (req, res) => {
        const documentName = req.params.documentName;
        uploadVerificationDocuments.upload(documentName)(req, res);
    }
);

router.get('/document/all/:id', 
    Authentication, 
    uploadVerificationDocuments.getAllDocuments
);


    module.exports = router;
