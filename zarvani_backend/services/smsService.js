const twilio = require('twilio');
const logger = require('../utils/logger');

class SMSService {
    constructor() {
        this.client = twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
        );
        this.serviceSid = process.env.TWILIO_SERVICE_SID;
    }

    /**
     * Send OTP via Twilio Messaging (or Verify API)
     * Note: The user provided a SERVICE_SID, which is typically for the Verify API.
     * However, if they want to send a custom message, we use the Messaging API.
     * Given the request for "send the otp when send", I'll implement a standard SMS send first.
     */
    async sendOTP(phone, otp, name) {
        try {
            // Ensure phone number has + prefix as required by Twilio
            const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;

            const message = await this.client.messages.create({
                body: `\n🔑 Yetzo Security: Your OTP is ${otp}.\n\nWelcome ${name || 'User'}! This code is valid for 10 minutes. Do not share this with anyone.`,
                from: this.serviceSid, // This could be a Messaging Service SID or a Twilio number
                to: formattedPhone
            });

            logger.info(`SMS sent successfully: ${message.sid}`);
            return true;
        } catch (error) {
            logger.error(`SMS send error: ${error.message}`);
            // Fallback: if SERVICE_SID doesn't work as 'from', try without it if you have a default number, 
            // but here we must rely on provided envs.
            return false;
        }
    }
}

module.exports = new SMSService();
