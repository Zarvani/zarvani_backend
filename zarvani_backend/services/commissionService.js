// services/commissionService.js
const Payment = require('../models/Payment');
const ServiceProvider = require('../models/ServiceProvider');
const Shop = require('../models/Shop');
const Booking = require('../models/Booking');
const Order = require('../models/Order');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

// Import notification service
let PushNotificationService;
try {
    PushNotificationService = require('../services/pushNotification');
} catch (error) {
    // Fallback if notification service is not available
    PushNotificationService = {
        sendToUser: async () => console.log('Notification service not available'),
        sendToProvider: async () => console.log('Notification service not available'),
        sendToShop: async () => console.log('Notification service not available')
    };
}

class CommissionService {

    // ==================== COMMISSION PROCESSING ====================

    /**
     * Process commission for a payment based on payment destination
     */
    static async processCommission(paymentId, externalSession = null) {
        const session = externalSession || await mongoose.startSession();
        if (!externalSession) session.startTransaction();

        try {
            const payment = await Payment.findById(paymentId)
                .populate('provider')
                .populate('shop')
                .populate('booking')
                .populate('order')
                .session(session);

            if (!payment) {
                throw new Error('Payment not found');
            }

            // Calculate commission based on payment destination and type
            await payment.calculateCommission();
            await payment.save({ session });

            // Process based on payment destination
            if (payment.paymentDestination === 'company_account') {
                await this.processAutoPayout(payment, session);
            } else {
                await this.trackPersonalPayment(payment, session);
            }

            if (!externalSession) await session.commitTransaction();
            logger.info(`Commission processed for payment: ${paymentId}`);

            return payment;
        } catch (error) {
            if (!externalSession) await session.abortTransaction();
            logger.error(`Process commission error: ${error.message}`, { stack: error.stack });
            throw error;
        } finally {
            if (!externalSession) session.endSession();
        }
    }

    // ==================== AUTO PAYOUT FOR COMPANY PAYMENTS ====================

    /**
     * Process auto-payout for company account payments
     */
    static async processAutoPayout(payment, session) {
        try {
            const isServicePayment = payment.paymentType === 'service';
            const isProductPayment = payment.paymentType === 'product_order';

            let owner = null;
            let ownerModel = null;
            let commissionRate = 0;
            let payoutAmount = 0;
            let commissionAmount = 0;

            // Get owner and calculate commission
            if (isServicePayment && payment.provider) {
                owner = await ServiceProvider.findById(payment.provider).session(session);
                ownerModel = 'ServiceProvider';
                commissionRate = 15; // 15% for services
                commissionAmount = payment.amount * (commissionRate / 100);
                payoutAmount = payment.amount - commissionAmount;

            } else if (isProductPayment && payment.shop) {
                owner = await Shop.findById(payment.shop).session(session);
                ownerModel = 'Shop';
                commissionRate = 8; // 8% for products
                commissionAmount = payment.amount * (commissionRate / 100);
                payoutAmount = payment.amount - commissionAmount;
            }

            if (!owner) {
                logger.warn(`No owner found for auto-payout: ${payment._id}`);
                return;
            }

            // ✅ UPDATE OWNER EARNINGS (Immediate)
            owner.earnings.total = (owner.earnings.total || 0) + payoutAmount;
            owner.earnings.lastUpdated = new Date();

            // Update commission tracking
            owner.commission = owner.commission || {};
            owner.commission.paid = (owner.commission.paid || 0) + commissionAmount;
            owner.commission.lastPaymentDate = new Date();

            await owner.save({ session });

            // ✅ INITIATE AUTO-PAYOUT (Simulate or integrate with payment gateway)
            const payoutResult = await this.initiatePayoutToOwner(owner, payoutAmount, payment, session);

            // Update payment with payout details
            payment.autoPayout = {
                status: payoutResult.success ? 'completed' : 'failed',
                payoutDate: new Date(),
                payoutMethod: payoutResult.method,
                payoutTo: payoutResult.to,
                ...(payoutResult.transactionId && { payoutId: payoutResult.transactionId })
            };

            payment.payoutDetails = {
                ...(isServicePayment && { providerAmount: payoutAmount }),
                ...(isProductPayment && { shopAmount: payoutAmount }),
                companyCommission: commissionAmount,
                sentAt: new Date(),
                transactionId: payoutResult.transactionId
            };

            payment.commission = {
                ...payment.commission,
                companyCommission: commissionAmount,
                commissionRate: commissionRate,
                ...(isServicePayment && { providerEarning: payoutAmount }),
                ...(isProductPayment && { shopEarning: payoutAmount }),
                calculatedAt: new Date()
            };

            // Mark commission as not applicable (already handled)
            payment.paymentVerification = {
                status: 'verified',
                verifiedAt: new Date(),
                verifiedBy: 'system',
                notes: 'Auto-payout completed'
            };

            await payment.save({ session });

            // Update Booking/Order commission status
            if (payment.booking) {
                await Booking.findByIdAndUpdate(
                    payment.booking,
                    {
                        'payment.commissionStatus': 'not_applicable',
                        'payment.receivedBy': 'company',
                        'payment.commissionAmount': commissionAmount
                    },
                    { session }
                );
            }

            if (payment.order) {
                await Order.findByIdAndUpdate(
                    payment.order,
                    {
                        'payment.commissionStatus': 'not_applicable',
                        'payment.receivedBy': 'company',
                        'payment.commissionAmount': commissionAmount
                    },
                    { session }
                );
            }

            // Send notification to owner
            if (payoutResult.success) {
                const notificationMessage = `₹${payoutAmount} has been credited to your account for ${isServicePayment ? 'service' : 'order'}. Commission: ₹${commissionAmount}`;

                await PushNotificationService.sendToUser(
                    owner._id,
                    'Payment Received 💰',
                    notificationMessage
                );
            }

            logger.info(`Auto-payout processed: ${payment._id}, Amount: ${payoutAmount}, Commission: ${commissionAmount}`);

        } catch (error) {
            logger.error(`Auto-payout error: ${error.message}`, { stack: error.stack });
            throw error;
        }
    }

    // ==================== PERSONAL PAYMENT COMMISSION TRACKING ====================

    /**
     * Track commission for personal account payments
     */
    static async trackPersonalPayment(payment, session) {
        try {
            const isServicePayment = payment.paymentType === 'service';
            const isProductPayment = payment.paymentType === 'product_order';

            let owner = null;
            let ownerModel = null;
            let commissionRate = 0;

            // Get owner and calculate commission
            if (isServicePayment && payment.provider) {
                owner = await ServiceProvider.findById(payment.provider).session(session);
                ownerModel = 'ServiceProvider';
                commissionRate = 20; // 20% for services (personal payment)

            } else if (isProductPayment && payment.shop) {
                owner = await Shop.findById(payment.shop).session(session);
                ownerModel = 'Shop';
                commissionRate = 12; // 12% for products (personal payment)
            }

            if (!owner) {
                logger.warn(`No owner found for commission tracking: ${payment._id}`);
                return;
            }

            const commissionAmount = payment.amount * (commissionRate / 100);

            // ✅ UPDATE OWNER EARNINGS (Full amount - commission is pending)
            owner.earnings.total = (owner.earnings.total || 0) + payment.amount;
            owner.earnings.lastUpdated = new Date();

            // Update commission due
            owner.commission = owner.commission || {};
            owner.commission.due = (owner.commission.due || 0) + commissionAmount;

            await owner.save({ session });

            // Update payment with commission tracking
            payment.pendingCommission = {
                amount: commissionAmount,
                status: 'pending',
                dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                paymentMethod: payment.paymentMethod,
                remindersSent: []
            };

            payment.commission = {
                ...payment.commission,
                pendingCommission: commissionAmount,
                pendingCommissionRate: commissionRate,
                ...(isServicePayment && { providerEarning: payment.amount }),
                ...(isProductPayment && { shopEarning: payment.amount }),
                calculatedAt: new Date()
            };

            payment.paymentVerification = {
                status: 'pending',
                dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                remindersSent: []
            };

            await payment.save({ session });

            // Update Booking/Order commission status
            if (payment.booking) {
                await Booking.findByIdAndUpdate(
                    payment.booking,
                    {
                        'payment.commissionStatus': 'pending',
                        'payment.receivedBy': 'provider',
                        'payment.commissionAmount': commissionAmount,
                        'payment.commissionDueDate': new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                    },
                    { session }
                );
            }

            if (payment.order) {
                await Order.findByIdAndUpdate(
                    payment.order,
                    {
                        'payment.commissionStatus': 'pending',
                        'payment.receivedBy': 'shop',
                        'payment.commissionAmount': commissionAmount,
                        'payment.commissionDueDate': new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                    },
                    { session }
                );
            }

            // Send notification about pending commission
            const notificationMessage = `New payment received: ₹${payment.amount}. Commission of ₹${commissionAmount} (${commissionRate}%) due in 7 days.`;

            await PushNotificationService.sendToUser(
                owner._id,
                'Payment Received - Commission Due ⚠️',
                notificationMessage
            );

            logger.info(`Personal payment tracked: ${payment._id}, Amount: ${payment.amount}, Commission Due: ${commissionAmount}`);

        } catch (error) {
            logger.error(`Track personal payment error: ${error.message}`, { stack: error.stack });
            throw error;
        }
    }

    // ==================== COMMISSION PAYMENT ====================

    /**
     * Mark commission as paid (when provider/shop pays commission)
     */
    static async markCommissionPaid(paymentId, adminId, paymentData) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const {
                paymentMethod = 'upi',
                transactionId,
                screenshotUrl,
                notes
            } = paymentData;

            const payment = await Payment.findById(paymentId).session(session);

            if (!payment) {
                throw new Error('Payment not found');
            }

            if (payment.paymentDestination !== 'personal_account') {
                throw new Error('Commission only applicable for personal account payments');
            }

            if (payment.pendingCommission.status === 'paid') {
                throw new Error('Commission already paid');
            }

            // Mark commission as paid
            payment.pendingCommission.status = 'paid';
            payment.pendingCommission.paidDate = new Date();
            payment.pendingCommission.paymentMethod = paymentMethod;
            payment.pendingCommission.transactionId = transactionId;

            // Move pending commission to company commission
            payment.commission.companyCommission = payment.commission.pendingCommission;
            payment.commission.pendingCommission = 0;

            // Update verification status
            payment.paymentVerification = {
                status: 'verified',
                verifiedAt: new Date(),
                verifiedBy: null,
                notes: notes || `Paid via ${paymentMethod}`
            };

            if (screenshotUrl) {
                payment.metadata = payment.metadata || {};
                payment.metadata.commissionPaymentProof = screenshotUrl;
            }

            await payment.save({ session });

            // Update owner commission tracking
            const isServicePayment = payment.paymentType === 'service';
            const ownerId = isServicePayment ? payment.provider : payment.shop;

            if (isServicePayment && ownerId) {
                const provider = await ServiceProvider.findById(ownerId).session(session);
                provider.commission.due = Math.max(0, provider.commission.due - payment.commission.companyCommission);
                provider.commission.paid = (provider.commission.paid || 0) + payment.commission.companyCommission;
                provider.commission.lastPaymentDate = new Date();
                await provider.save({ session });
            } else if (!isServicePayment && ownerId) {
                const shop = await Shop.findById(ownerId).session(session);
                shop.commission.due = Math.max(0, shop.commission.due - payment.commission.companyCommission);
                shop.commission.paid = (shop.commission.paid || 0) + payment.commission.companyCommission;
                shop.commission.lastPaymentDate = new Date();
                await shop.save({ session });
            }

            // Update Booking/Order commission status
            if (payment.booking) {
                await Booking.findByIdAndUpdate(
                    payment.booking,
                    {
                        'payment.commissionStatus': 'paid',
                        'payment.commissionPaidAt': new Date()
                    },
                    { session }
                );
            }

            if (payment.order) {
                await Order.findByIdAndUpdate(
                    payment.order,
                    {
                        'payment.commissionStatus': 'paid',
                        'payment.commissionPaidAt': new Date()
                    },
                    { session }
                );
            }

            await session.commitTransaction();

            // Send confirmation notifications
            await this.sendCommissionPaidNotifications(payment, adminId);

            logger.info(`Commission marked as paid: ${paymentId}, Amount: ${payment.commission.companyCommission}`);

            return payment;

        } catch (error) {
            await session.abortTransaction();
            logger.error(`Mark commission paid error: ${error.message}`, { stack: error.stack });
            throw error;
        } finally {
            session.endSession();
        }
    }

    // ==================== COMMISSION QUERIES ====================

    /**
     * Get commission summary for provider/shop
     */
    static async getCommissionSummary(ownerId, ownerType, period = 'all') {
        try {
            const isProvider = ownerType === 'provider';
            const isShop = ownerType === 'shop';

            const dateFilter = this.getDateFilter(period);
            const query = {
                paymentDestination: 'personal_account',
                status: 'success',
                ...dateFilter
            };

            if (isProvider) {
                query.provider = ownerId;
                query.paymentType = 'service';
            } else if (isShop) {
                query.shop = ownerId;
                query.paymentType = 'product_order';
            }

            const payments = await Payment.find(query)
                .populate('user', 'name phone')
                .populate('booking', 'bookingId serviceDetails')
                .populate('order', 'orderId items pricing.totalAmount')
                .sort({ createdAt: -1 });

            // Calculate totals
            const summary = {
                totalEarnings: 0,
                totalCommissionDue: 0,
                totalCommissionPaid: 0,
                pendingCommissions: [],
                paidCommissions: [],
                overdueCommissions: []
            };

            const now = new Date();

            payments.forEach(payment => {
                summary.totalEarnings += payment.amount;

                if (payment.pendingCommission.status === 'pending') {
                    summary.totalCommissionDue += payment.commission.pendingCommission || 0;

                    const commissionItem = {
                        paymentId: payment._id,
                        transactionId: payment.transactionId,
                        amount: payment.amount,
                        commission: payment.commission.pendingCommission,
                        dueDate: payment.pendingCommission.dueDate,
                        daysRemaining: payment.pendingCommission.dueDate ?
                            Math.max(0, Math.ceil((payment.pendingCommission.dueDate - now) / (1000 * 60 * 60 * 24))) : 0,
                        createdAt: payment.createdAt,
                        ...(payment.booking && {
                            type: 'service',
                            bookingId: payment.booking.bookingId,
                            service: payment.booking.serviceDetails?.title,
                            customer: payment.user?.name
                        }),
                        ...(payment.order && {
                            type: 'product',
                            orderId: payment.order.orderId,
                            customer: payment.user?.name
                        })
                    };

                    // Check if overdue
                    if (payment.pendingCommission.dueDate && payment.pendingCommission.dueDate < now) {
                        commissionItem.daysOverdue = Math.ceil((now - payment.pendingCommission.dueDate) / (1000 * 60 * 60 * 24));
                        commissionItem.status = 'overdue';
                        summary.overdueCommissions.push(commissionItem);
                    } else {
                        commissionItem.status = 'pending';
                        summary.pendingCommissions.push(commissionItem);
                    }

                } else if (payment.pendingCommission.status === 'paid') {
                    summary.totalCommissionPaid += payment.commission.pendingCommission || 0;
                    summary.paidCommissions.push({
                        paymentId: payment._id,
                        transactionId: payment.transactionId,
                        amount: payment.amount,
                        commission: payment.commission.pendingCommission,
                        paidDate: payment.pendingCommission.paidDate,
                        paymentMethod: payment.pendingCommission.paymentMethod,
                        createdAt: payment.createdAt,
                        ...(payment.booking && {
                            type: 'service',
                            bookingId: payment.booking.bookingId
                        }),
                        ...(payment.order && {
                            type: 'product',
                            orderId: payment.order.orderId
                        })
                    });
                }
            });

            return summary;

        } catch (error) {
            logger.error(`Get commission summary error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get all pending commissions with filters
     */
    static async getPendingCommissions(filters = {}) {
        try {
            const {
                ownerType,
                ownerId,
                startDate,
                endDate,
                minAmount,
                maxAmount,
                status = 'pending'
            } = filters;

            const query = {
                paymentDestination: 'personal_account',
                'pendingCommission.status': status,
                status: 'success'
            };

            // Apply filters
            if (ownerType === 'provider') {
                query.provider = { $ne: null };
                query.paymentType = 'service';
            } else if (ownerType === 'shop') {
                query.shop = { $ne: null };
                query.paymentType = 'product_order';
            }

            if (ownerId) {
                if (ownerType === 'provider') {
                    query.provider = ownerId;
                } else if (ownerType === 'shop') {
                    query.shop = ownerId;
                }
            }

            if (startDate || endDate) {
                query.createdAt = {};
                if (startDate) query.createdAt.$gte = new Date(startDate);
                if (endDate) query.createdAt.$lte = new Date(endDate);
            }

            if (minAmount || maxAmount) {
                query.amount = {};
                if (minAmount) query.amount.$gte = minAmount;
                if (maxAmount) query.amount.$lte = maxAmount;
            }

            const commissions = await Payment.find(query)
                .populate('provider', 'name phone email')
                .populate('shop', 'name phone email')
                .populate('user', 'name phone')
                .populate('booking', 'bookingId serviceDetails')
                .populate('order', 'orderId items')
                .sort({ 'pendingCommission.dueDate': 1 });

            return commissions;
        } catch (error) {
            logger.error(`Get pending commissions error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get overdue commissions with severity
     */
    static async getOverdueCommissions(severity = 'all') {
        try {
            const now = new Date();
            let dateFilter = {};

            if (severity === 'critical') {
                // Overdue by more than 14 days
                const criticalDate = new Date(now.setDate(now.getDate() - 14));
                dateFilter = { $lt: criticalDate };
            } else if (severity === 'high') {
                // Overdue by 7-14 days
                const highDate = new Date(now.setDate(now.getDate() - 7));
                dateFilter = { $lt: highDate, $gte: new Date(now.setDate(now.getDate() - 7)) };
            } else {
                // All overdue
                dateFilter = { $lt: new Date() };
            }

            const overdueCommissions = await Payment.find({
                paymentDestination: 'personal_account',
                'pendingCommission.status': 'pending',
                'pendingCommission.dueDate': dateFilter,
                status: 'success'
            })
                .populate('provider', 'name phone email')
                .populate('shop', 'name phone email')
                .populate('user', 'name phone')
                .populate('booking', 'bookingId serviceDetails')
                .populate('order', 'orderId items')
                .sort({ 'pendingCommission.dueDate': 1 });

            return overdueCommissions;
        } catch (error) {
            logger.error(`Get overdue commissions error: ${error.message}`);
            throw error;
        }
    }

    // ==================== REMINDERS & NOTIFICATIONS ====================

    /**
     * Send commission reminders with escalation
     */
    static async sendCommissionReminders() {
        try {
            const overdueCommissions = await this.getOverdueCommissions();

            let reminderCount = 0;
            let escalationCount = 0;

            for (const payment of overdueCommissions) {
                const owner = await this.getPaymentOwner(payment);
                if (!owner) continue;

                const daysOverdue = this.calculateDaysOverdue(payment.pendingCommission.dueDate);
                let subject, message;

                if (daysOverdue > 14) {
                    // Critical - escalate to admin
                    subject = 'CRITICAL: Commission Overdue - Account Suspension Risk';
                    message = `Commission of ₹${payment.commission.pendingCommission} is overdue by ${daysOverdue} days. Immediate action required.`;
                    escalationCount++;

                    // Notify admin
                    await this.notifyAdminAboutCriticalCommission(payment);
                } else if (daysOverdue > 7) {
                    // High priority
                    subject = 'URGENT: Commission Overdue';
                    message = `Your commission of ₹${payment.commission.pendingCommission} is overdue by ${daysOverdue} days. Please pay immediately.`;
                } else {
                    // Normal reminder
                    subject = 'Reminder: Commission Payment Due';
                    message = `Your commission of ₹${payment.commission.pendingCommission} is overdue. Please make the payment.`;
                }

                // Send notification
                await PushNotificationService.sendToUser(owner._id, subject, message);

                // Update reminder count
                payment.pendingCommission.remindersSent = payment.pendingCommission.remindersSent || [];
                payment.pendingCommission.remindersSent.push({
                    sentAt: new Date(),
                    type: daysOverdue > 7 ? 'urgent' : 'normal',
                    content: message
                });

                payment.pendingCommission.reminderSent = true;
                await payment.save();

                reminderCount++;
            }

            logger.info(`Commission reminders sent: ${reminderCount}, escalations: ${escalationCount}`);

            return { reminderCount, escalationCount };
        } catch (error) {
            logger.error(`Send commission reminders error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Send due date reminders
     */
    static async sendDueDateReminders(hoursBefore = 24) {
        try {
            const dueSoonDate = new Date(Date.now() + hoursBefore * 60 * 60 * 1000);
            const now = new Date();

            const dueSoonPayments = await Payment.find({
                paymentDestination: 'personal_account',
                'pendingCommission.status': 'pending',
                'pendingCommission.dueDate': {
                    $lte: dueSoonDate,
                    $gt: now
                },
                status: 'success',
                'pendingCommission.reminderSent': { $ne: true }
            });

            let reminderCount = 0;

            for (const payment of dueSoonPayments) {
                const owner = await this.getPaymentOwner(payment);
                if (!owner) continue;

                const hoursRemaining = Math.ceil((payment.pendingCommission.dueDate - now) / (1000 * 60 * 60));

                await PushNotificationService.sendToUser(
                    owner._id,
                    'Commission Due Soon',
                    `Your commission of ₹${payment.commission.pendingCommission} is due in ${hoursRemaining} hours.`
                );

                payment.pendingCommission.reminderSent = true;
                payment.pendingCommission.remindersSent = payment.pendingCommission.remindersSent || [];
                payment.pendingCommission.remindersSent.push({
                    sentAt: new Date(),
                    type: 'due_soon',
                    content: `Commission due in ${hoursRemaining} hours`
                });

                await payment.save();
                reminderCount++;
            }

            logger.info(`Due date reminders sent: ${reminderCount}`);
            return reminderCount;
        } catch (error) {
            logger.error(`Send due date reminders error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Check and mark overdue commissions
     */
    static async checkOverdueCommissions() {
        try {
            const overduePayments = await Payment.find({
                paymentDestination: 'personal_account',
                'pendingCommission.status': 'pending',
                'pendingCommission.dueDate': { $lt: new Date() }
            }).populate('provider shop');

            for (const payment of overduePayments) {
                const daysOverdue = this.calculateDaysOverdue(payment.pendingCommission.dueDate);

                // Update status to overdue
                payment.pendingCommission.status = 'overdue';

                // Update Booking/Order status
                if (payment.booking) {
                    await Booking.findByIdAndUpdate(payment.booking, {
                        'payment.commissionStatus': 'overdue'
                    });
                }

                if (payment.order) {
                    await Order.findByIdAndUpdate(payment.order, {
                        'payment.commissionStatus': 'overdue'
                    });
                }

                // Send reminder
                await this.sendOverdueReminder(payment, daysOverdue);

                await payment.save();
            }

            logger.info(`Checked overdue commissions: ${overduePayments.length} found`);

        } catch (error) {
            logger.error(`Check overdue commissions error: ${error.message}`);
        }
    }

    // ==================== STATISTICS & REPORTS ====================

    /**
     * Get comprehensive commission statistics
     */
    static async getCommissionStats(timeframe = 'month') {
        try {
            const dateFilter = this.getDateFilter(timeframe);

            // Aggregate commission data
            const commissionStats = await Payment.aggregate([
                {
                    $match: {
                        status: 'success',
                        ...dateFilter
                    }
                },
                {
                    $group: {
                        _id: {
                            destination: '$paymentDestination',
                            type: '$paymentType'
                        },
                        totalAmount: { $sum: '$amount' },
                        totalCommissionCollected: {
                            $sum: {
                                $cond: [
                                    { $eq: ['$paymentDestination', 'company_account'] },
                                    '$commission.companyCommission',
                                    0
                                ]
                            }
                        },
                        totalPendingCommission: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: ['$paymentDestination', 'personal_account'] },
                                            { $eq: ['$pendingCommission.status', 'pending'] }
                                        ]
                                    },
                                    '$commission.pendingCommission',
                                    0
                                ]
                            }
                        },
                        totalCommissionPaid: {
                            $sum: {
                                $cond: [
                                    {
                                        $and: [
                                            { $eq: ['$paymentDestination', 'personal_account'] },
                                            { $eq: ['$pendingCommission.status', 'paid'] }
                                        ]
                                    },
                                    '$commission.pendingCommission',
                                    0
                                ]
                            }
                        },
                        count: { $sum: 1 }
                    }
                },
                {
                    $sort: { '_id.destination': 1, '_id.type': 1 }
                }
            ]);

            // Calculate totals
            const totals = {
                totalRevenue: 0,
                totalCommission: 0,
                pendingCommission: 0,
                collectedCommission: 0,
                byType: {}
            };

            commissionStats.forEach(stat => {
                totals.totalRevenue += stat.totalAmount;
                totals.totalCommission += stat.totalCommissionCollected + stat.totalCommissionPaid;
                totals.pendingCommission += stat.totalPendingCommission;
                totals.collectedCommission += stat.totalCommissionCollected + stat.totalCommissionPaid;

                const type = stat._id.type || 'unknown';
                totals.byType[type] = totals.byType[type] || {
                    revenue: 0,
                    commission: 0,
                    pending: 0
                };

                totals.byType[type].revenue += stat.totalAmount;
                totals.byType[type].commission += stat.totalCommissionCollected + stat.totalCommissionPaid;
                totals.byType[type].pending += stat.totalPendingCommission;
            });

            // Get top commission payers
            const topPayers = await Payment.aggregate([
                {
                    $match: {
                        paymentDestination: 'personal_account',
                        status: 'success',
                        ...dateFilter
                    }
                },
                {
                    $group: {
                        _id: {
                            $cond: [
                                { $ne: ['$provider', null] },
                                { type: 'provider', id: '$provider' },
                                { type: 'shop', id: '$shop' }
                            ]
                        },
                        totalCommission: { $sum: '$commission.pendingCommission' },
                        totalPaid: {
                            $sum: {
                                $cond: [
                                    { $eq: ['$pendingCommission.status', 'paid'] },
                                    '$commission.pendingCommission',
                                    0
                                ]
                            }
                        },
                        totalPending: {
                            $sum: {
                                $cond: [
                                    { $eq: ['$pendingCommission.status', 'pending'] },
                                    '$commission.pendingCommission',
                                    0
                                ]
                            }
                        },
                        paymentCount: { $sum: 1 }
                    }
                },
                {
                    $sort: { totalCommission: -1 }
                },
                {
                    $limit: 10
                }
            ]);

            return {
                timeframe,
                generatedAt: new Date(),
                summary: totals,
                breakdown: commissionStats,
                topPayers,
                metrics: {
                    commissionRate: totals.totalRevenue > 0 ? (totals.totalCommission / totals.totalRevenue) * 100 : 0,
                    collectionRate: totals.totalCommission > 0 ? (totals.collectedCommission / totals.totalCommission) * 100 : 0,
                    averageCommission: totals.totalCommission > 0 ? totals.totalCommission / commissionStats.reduce((sum, s) => sum + s.count, 0) : 0
                }
            };
        } catch (error) {
            logger.error(`Get commission stats error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Generate commission report
     */
    static async generateCommissionReport(timeframe = 'month', format = 'json') {
        try {
            const stats = await this.getCommissionStats(timeframe);
            const pendingCommissions = await this.getPendingCommissions();
            const overdueCommissions = await this.getOverdueCommissions();

            const report = {
                timeframe,
                generatedAt: new Date(),
                summary: stats.summary,
                metrics: stats.metrics,

                pendingCommissions: {
                    count: pendingCommissions.length,
                    totalAmount: pendingCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0),
                    items: pendingCommissions.map(p => ({
                        paymentId: p._id,
                        transactionId: p.transactionId,
                        date: p.createdAt,
                        amount: p.amount,
                        commission: p.commission.pendingCommission,
                        dueDate: p.pendingCommission.dueDate,
                        ownerType: p.provider ? 'provider' : 'shop',
                        ownerId: p.provider || p.shop,
                        ownerName: p.provider?.name || p.shop?.name
                    }))
                },

                overdueCommissions: {
                    count: overdueCommissions.length,
                    totalAmount: overdueCommissions.reduce((sum, p) => sum + p.commission.pendingCommission, 0),
                    items: overdueCommissions.map(p => ({
                        paymentId: p._id,
                        transactionId: p.transactionId,
                        amount: p.amount,
                        commission: p.commission.pendingCommission,
                        dueDate: p.pendingCommission.dueDate,
                        daysOverdue: this.calculateDaysOverdue(p.pendingCommission.dueDate),
                        ownerType: p.provider ? 'provider' : 'shop',
                        ownerId: p.provider || p.shop,
                        ownerName: p.provider?.name || p.shop?.name,
                        contact: p.provider?.phone || p.shop?.phone
                    }))
                },

                breakdown: stats.breakdown,
                topPayers: stats.topPayers
            };

            if (format === 'csv') {
                return this.convertToCSV(report);
            }

            return report;
        } catch (error) {
            logger.error(`Generate commission report error: ${error.message}`);
            throw error;
        }
    }

    // ==================== HELPER METHODS ====================

    /**
     * Initiate payout to owner (simulated or integrate with payment gateway)
     */
    static async initiatePayoutToOwner(owner, amount, payment, session) {
        try {
            // Get owner's payout method (UPI or bank)
            const payoutMethod = owner.bankDetails?.upiId ? 'upi' :
                owner.bankDetails?.accountNumber ? 'bank_transfer' : 'wallet';

            const payoutTo = owner.bankDetails?.upiId ||
                owner.bankDetails?.accountNumber ||
                owner.walletId;

            if (!payoutTo) {
                logger.warn(`No payout method found for owner: ${owner._id}`);
                return {
                    success: false,
                    error: 'No payout method configured'
                };
            }

            // In production, integrate with Razorpay Payouts/UPI API
            // This is a simulation - replace with actual API call

            const transactionId = `PAYOUT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Simulate successful payout
            // TODO: Replace with actual payout API like Razorpay Payouts

            logger.info(`Payout initiated: ${transactionId}, Amount: ${amount}, To: ${payoutTo}`);

            return {
                success: true,
                method: payoutMethod,
                to: payoutTo,
                transactionId: transactionId,
                amount: amount
            };

        } catch (error) {
            logger.error(`Initiate payout error: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get payment owner
     */
    static async getPaymentOwner(payment) {
        if (payment.provider) {
            return await ServiceProvider.findById(payment.provider);
        } else if (payment.shop) {
            return await Shop.findById(payment.shop);
        }
        return null;
    }

    /**
     * Send commission paid notifications
     */
    static async sendCommissionPaidNotifications(payment, adminId) {
        try {
            const owner = await this.getPaymentOwner(payment);

            if (owner) {
                await PushNotificationService.sendToUser(
                    owner._id,
                    'Commission Payment Verified',
                    `Your commission payment of ₹${payment.commission.pendingCommission} has been verified. Thank you!`
                );
            }

            // Notify admin who verified
            const admin = await mongoose.model('User').findById(adminId);
            if (admin) {
                await PushNotificationService.sendToUser(
                    adminId,
                    'Commission Payment Recorded',
                    `Commission payment verified for transaction: ${payment.transactionId}`
                );
            }
        } catch (error) {
            logger.error(`Send commission paid notifications error: ${error.message}`);
        }
    }

    /**
     * Notify admin about critical commission
     */
    static async notifyAdminAboutCriticalCommission(payment) {
        try {
            const owner = await this.getPaymentOwner(payment);

            if (!owner) return;

            const adminMessage = `CRITICAL: Commission overdue for ${owner.name || 'Owner'}. ` +
                `Amount: ₹${payment.commission.pendingCommission}, ` +
                `Overdue by: ${this.calculateDaysOverdue(payment.pendingCommission.dueDate)} days, ` +
                `Payment ID: ${payment._id}`;

            // This should notify all admins
            // In production, you'd have an Admin model to get admin users
            logger.warn(adminMessage);

            // You can also send to a dedicated admin notification channel
            // await PushNotificationService.sendToAdmin('Critical Commission Alert', adminMessage);
        } catch (error) {
            logger.error(`Notify admin error: ${error.message}`);
        }
    }

    /**
     * Send overdue reminder
     */
    static async sendOverdueReminder(payment, daysOverdue) {
        try {
            const owner = await this.getPaymentOwner(payment);
            if (!owner) return;

            const commissionAmount = payment.commission.pendingCommission;

            let title, message;

            if (daysOverdue <= 3) {
                title = 'Commission Payment Reminder';
                message = `Your commission of ₹${commissionAmount} is ${daysOverdue} day(s) overdue. Please pay now.`;
            } else if (daysOverdue <= 7) {
                title = 'Urgent: Commission Overdue';
                message = `Commission of ₹${commissionAmount} is ${daysOverdue} days overdue. Account restrictions may apply.`;
            } else {
                title = 'Final Notice: Commission Overdue';
                message = `Commission of ₹${commissionAmount} is ${daysOverdue} days overdue. Your account may be suspended.`;
            }

            // Send push notification
            await PushNotificationService.sendToUser(owner._id, title, message);

            // Record reminder
            payment.pendingCommission.remindersSent = payment.pendingCommission.remindersSent || [];
            payment.pendingCommission.remindersSent.push({
                sentAt: new Date(),
                type: daysOverdue > 7 ? 'final' : daysOverdue > 3 ? 'urgent' : 'reminder',
                message
            });

        } catch (error) {
            logger.error(`Send reminder error: ${error.message}`);
        }
    }

    /**
     * Calculate days overdue
     */
    static calculateDaysOverdue(dueDate) {
        if (!dueDate) return 0;
        const now = new Date();
        return Math.max(0, Math.ceil((now - dueDate) / (1000 * 60 * 60 * 24)));
    }

    /**
     * Get date filter for queries
     */
    static getDateFilter(timeframe) {
        const now = new Date();
        let startDate;

        switch (timeframe) {
            case 'today':
                startDate = new Date(now.setHours(0, 0, 0, 0));
                break;
            case 'yesterday':
                startDate = new Date(now.setDate(now.getDate() - 1));
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'week':
                startDate = new Date(now.setDate(now.getDate() - 7));
                break;
            case 'month':
                startDate = new Date(now.setMonth(now.getMonth() - 1));
                break;
            case 'quarter':
                startDate = new Date(now.setMonth(now.getMonth() - 3));
                break;
            case 'year':
                startDate = new Date(now.setFullYear(now.getFullYear() - 1));
                break;
            case 'all':
            default:
                return {};
        }

        return { createdAt: { $gte: startDate } };
    }

    /**
     * Convert report to CSV
     */
    static convertToCSV(report) {
        const csv = [];

        // Add headers
        csv.push('Payment ID,Transaction ID,Amount,Commission,Due Date,Owner Type,Owner Name,Status,Days Overdue');

        // Add pending commissions
        report.pendingCommissions.items.forEach(item => {
            csv.push(`${item.paymentId},${item.transactionId},${item.amount},${item.commission},${item.dueDate},${item.ownerType},${item.ownerName},pending,0`);
        });

        // Add overdue commissions
        report.overdueCommissions.items.forEach(item => {
            csv.push(`${item.paymentId},${item.transactionId},${item.amount},${item.commission},${item.dueDate},${item.ownerType},${item.ownerName},overdue,${item.daysOverdue}`);
        });

        return csv.join('\n');
    }
}

module.exports = CommissionService;