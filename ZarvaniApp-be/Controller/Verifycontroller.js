const nodemailer = require('nodemailer');
const crypto = require('crypto');
const twilio = require('twilio');

const otpStorage = new Map(); 

const sendOtp = async (req, res) => {
    try {
        const { email } = req.body;

        // Validate email input
        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required" });
        }

        const otp = crypto.randomInt(100000, 999999).toString();

        otpStorage.set(email, { otp, expiresAt: Date.now() + 10 * 60 * 1000 }); // OTP expires in 10 minutes

        if (!process.env.EMAIL_SERVICE || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            throw new Error('Email configuration is missing in environment variables');
        }

        // Configure transporter
        const transporter = nodemailer.createTransport({
            service: process.env.EMAIL_SERVICE, 
            auth: {
                user: process.env.EMAIL_USER, 
                pass: process.env.EMAIL_PASS,  
            },
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Your OTP for Verification',
            text: `Your OTP is ${otp}. It is valid for 10 minutes.`,
        };

        await transporter.sendMail(mailOptions);

        res.status(200).json({ success: true, message: "OTP sent successfully" });
    } catch (error) {
        console.error('Error sending OTP:', error);
        if (error.code === 'EAUTH') {
            return res.status(500).json({ 
                success: false, 
                message: "Authentication error. Check email credentials." 
            });
        }
        res.status(500).json({ success: false, message: "Error sending OTP" });
    }
};

const verifyOtp = (req, res) => {
    try {
        const { email, otp } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ success: false, message: "Email and OTP are required" });
        }

        const storedOtp = otpStorage.get(email);

        if (!storedOtp) {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }

        if (storedOtp.otp !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        if (storedOtp.expiresAt < Date.now()) {
            return res.status(400).json({ success: false, message: "OTP expired" });
        }
        otpStorage.delete(email);
        res.status(200).json({ success: true, message: "OTP verified successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Error verifying OTP" });
    }
};

const sendPhoneOtp = async (req, res)=>{
    try {
        const phoneNumber = req.body;
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const serviceSid = process.env.TWILIO_SERVICE_SID;

        const client = twilio(accountSid, authToken);

      
        const response = await client.verify.v2.services(serviceSid).verifications.create({
            to: phoneNumber,
            channel: 'sms',
        });
        return {
            success: true,
            message: 'OTP sent successfully',
            sid: response.sid,
        };
    } catch (error) {
        return {
            success: false,
            message: error.message,
        };
          }
}
const verifyPhoneOtp = async (req, res)=>{
    try {
        const {  phoneNumber, otp } = req.body;

        const accountSid = process.env.YOUR_ACCOUNT_SID;
        const authToken = process.env.AUTH_TOKEN;
        const serviceSid = process.env.SERVICE_SID;

        const client = twilio(accountSid, authToken);
        
        const response = await client.verify.v2.services(serviceSid).verificationChecks.create({
            to: phoneNumber,
            code: otp,
        });
        if (response.status === 'approved') {
            return {
                success: true,
                message: 'OTP verified successfully',
            };
        } else {
            return {
                success: false,
                message: 'Invalid OTP',
            };
        }
    } catch (error) {
        return {
            success: false,
            message: error.message,
        };
    }
}

module.exports = { sendOtp, verifyOtp };