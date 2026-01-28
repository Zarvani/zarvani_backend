const Queue = require('bull');
const EmailService = require('../services/emailService');
const SMSService = require('../services/smsService');
const logger = require('../utils/logger');

// Create OTP queue
const otpQueue = new Queue('otp-queue', 'redis://localhost:6379', {
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 2000
        },
        removeOnComplete: true,
        removeOnFail: false
    }
});

// Process OTP jobs
otpQueue.process('send-otp', async (job) => {
    const { identifier, otp, name, type } = job.data;

    try {
        if (type === 'email') {
            await EmailService.sendOTP(identifier, otp, name);
            logger.info(`✅ OTP email sent to ${identifier}`);
        } else if (type === 'sms') {
            await SMSService.sendOTP(identifier, otp, name);
            logger.info(`✅ OTP SMS sent to ${identifier}`);
        } else if (type === 'both') {
            // Send to both email and phone
            await Promise.all([
                EmailService.sendOTP(job.data.email, otp, name),
                SMSService.sendOTP(job.data.phone, otp, name)
            ]);
            logger.info(`✅ OTP sent to both email and SMS for ${name}`);
        }

        return { success: true, identifier };
    } catch (error) {
        logger.error(`❌ OTP sending failed for ${identifier}: ${error.message}`);
        throw error; // Will trigger retry
    }
});

// Process welcome email jobs
otpQueue.process('send-welcome-email', async (job) => {
    const { email, name, role } = job.data;

    try {
        await EmailService.sendWelcomeEmail(email, name, role);
        logger.info(`✅ Welcome email sent to ${email}`);
        return { success: true, email };
    } catch (error) {
        logger.error(`❌ Welcome email failed for ${email}: ${error.message}`);
        throw error;
    }
});

// Event listeners
otpQueue.on('completed', (job, result) => {
    logger.debug(`Job ${job.id} completed:`, result);
});

otpQueue.on('failed', (job, err) => {
    logger.error(`Job ${job.id} failed after ${job.attemptsMade} attempts:`, err.message);
});

otpQueue.on('stalled', (job) => {
    logger.warn(`Job ${job.id} stalled`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    await otpQueue.close();
    logger.info('OTP queue closed');
});

module.exports = otpQueue;
