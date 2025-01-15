const jwt = require("jsonwebtoken")
const userData = require("../Model/userModel")
const Authentication = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Please login to access the resource.",
            });
        }

        const decodeddata = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await userData.findById(decodeddata.id);
        if (!req.user) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        next(); // Proceed to the next middleware/route handler
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error in cookie handling.",
        });
    }
};
const AuthorizeRole = (...usertypes) => {
 
    return (req, res, next) => {
        if (!req.user || !req.user.usertype) {
            return res.status(403).json({
                success: false,
                message: error.message || "User role not provided"
            });
            
        }
        if (!usertypes.includes(req.user.usertype)) {
            return res.status(403).json({
                success: false,
                message: `ROLE: ${req.user.usertype} is not allowed to access the resource`
            });
        }
        next();
    };
};
module.exports = { Authentication, AuthorizeRole };