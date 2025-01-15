const { JsonWebTokenError, TokenExpiredError } = require("jsonwebtoken");

module.exports = (err, req, res, next) => {
   
    const statusCode = err.statusCode || 400;
    let message = err.message || "Internal server error";

   
    if (err.name === "CastError") {
        message = `Resource not found: ${err.path}`;
    }

    if (err.code === 11000) {
        const duplicateField = Object.keys(err.keyValue)[0];
        message = `Duplicate value entered for ${duplicateField}`;
    }

    if (err.name === "JsonWebTokenError") {
        message = `Invalid JSON Web Token. Please try again.`;
    }

    if (err.name === "TokenExpiredError") {
        message = `Expired JSON Web Token. Please try again.`;
    }

  
    res.status(statusCode).json({
        success: false,
        message
    });
};
