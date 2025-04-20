const express=require('express');
const {createUser
    , Loginuser,
    Logout,
    getProfile,
    getAllProvider,
    loginWithGoogle,
    loginWithFacebook,
    updateProfileid,
    deleteUser
    ,updateEmail,
    updateProfilePassword,
    forgetPassword,
    checkProfileCompletion,uploadProfilePhoto,
    deleteProfilePhoto,
    getAllProviderDetails,
}=require("../Controller/Usercontroller");
const upload = require('../Utills/multer'); 

 const { Authentication, AuthorizeRole } = require("../Middleware/Authentication")

const router = express.Router();

router.route("/register").post(createUser);
router.route("/loginuser").post(Loginuser);
router.route('/google-login').post(loginWithGoogle);
router.route('/forget-Password').post(forgetPassword);

router.route("/profile").get(Authentication, getProfile)
router.route("/update-Profile").patch(Authentication,updateProfileid)
router.route("/upload-Profile-Photo").post(Authentication,upload.single('file'),uploadProfilePhoto)
router.route("/check-Profile-Completion").get(Authentication,checkProfileCompletion)
router.route("/update-password").put(Authentication, updateProfilePassword)
router.route("/update-Email").put(Authentication, updateEmail)
router.route("/delete-Profile-Photo").delete(Authentication, deleteProfilePhoto)
router.route("/delete-User/:id").delete(Authentication, deleteUser)

router.route("/logoutuser").delete(Logout);

module.exports = router;