// ============= services/emailService.js =============
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

class EmailService {
  static async sendEmail(to, subject, html) {
    try {
      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to,
        subject,
        html
      };
      
      const info = await transporter.sendMail(mailOptions);
      logger.info(`Email sent: ${info.messageId}`);
      return true;
    } catch (error) {
      logger.error(`Email send error: ${error.message}`);
      return false;
    }
  }
  
  static async sendOTP(email, otp, name) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .otp-box { background: #f4f4f4; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; }
          .footer { margin-top: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Welcome to Yetzo!</h2>
          <p>Hi ${name},</p>
          <p>Your OTP for verification is:</p>
          <div class="otp-box">${otp}</div>
          <p>This OTP will expire in 10 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <div class="footer">
            <p>© ${new Date().getFullYear()} Yetzo. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    return await this.sendEmail(email, 'Your Yetzo OTP', html);
  }
  
  static async sendBookingConfirmation(email, bookingDetails) {
    const html = `
      <!DOCTYPE html>
      <html>
      <body>
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Booking Confirmed!</h2>
          <p>Dear ${bookingDetails.userName},</p>
          <p>Your booking has been confirmed.</p>
          <div style="background: #f9f9f9; padding: 15px; margin: 20px 0;">
            <p><strong>Booking ID:</strong> ${bookingDetails.bookingId}</p>
            <p><strong>Service:</strong> ${bookingDetails.serviceName}</p>
            <p><strong>Date:</strong> ${bookingDetails.date}</p>
            <p><strong>Time:</strong> ${bookingDetails.time}</p>
            <p><strong>Provider:</strong> ${bookingDetails.providerName}</p>
            <p><strong>Amount:</strong> ₹${bookingDetails.amount}</p>
          </div>
          <p>Thank you for choosing Yetzo!</p>
        </div>
      </body>
      </html>
    `;
    
    return await this.sendEmail(email, 'Booking Confirmation - Yetzo', html);
  }
  
  static async sendPasswordReset(email, resetLink, name) {
    const html = `
      <!DOCTYPE html>
      <html>
      <body>
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Password Reset Request</h2>
          <p>Hi ${name},</p>
          <p>You requested to reset your password. Click the link below to proceed:</p>
          <p><a href="${resetLink}" style="background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a></p>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
      </body>
      </html>
    `;
    
    return await this.sendEmail(email, 'Password Reset - Yetzo', html);
  }
  
  static async sendWelcomeEmail(email, name, role) {
    const html = `
      <!DOCTYPE html>
      <html>
      <body>
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Welcome to Yetzo!</h2>
          <p>Hi ${name},</p>
          <p>Thank you for joining Yetzo as a ${role}.</p>
          <p>We're excited to have you on board!</p>
          ${role === 'provider' || role === 'shop' ? `
            <p>Your account is currently under review. We'll notify you once it's approved.</p>
          ` : ''}
          <p>Best regards,<br>Team Yetzo</p>
        </div>
      </body>
      </html>
    `;
    
    return await this.sendEmail(email, 'Welcome to Yetzo', html);
  }
}

module.exports = EmailService;

