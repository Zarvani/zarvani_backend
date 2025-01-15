const multer = require("multer");

const storage = multer.memoryStorage();

// File filter to accept only certain types of files
const fileFilter = (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "application/pdf"];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true); // Accept file
    } else {
        cb(new Error("Invalid file type. Only JPG, PNG, JPEG, and PDF are allowed."), false);
    }
};

// File size limit (5MB)
const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

module.exports = upload;
