// ============= services/paymentService.js =============

const crypto = require("crypto");
const axios = require("axios");
const mongoose = require("mongoose");

const Booking = require("../models/Booking");
const Order = require("../models/Order");
const Payment = require("../models/Payment");

const NotificationService = require("./notificationService");
const CommissionService = require("./commissionService");
const logger = require("../utils/logger");

class PaymentService {
  /**
   * Create Razorpay Order
   */
  static async createRazorpayOrder(amount, currency = "INR", receipt) {
    try {
      const auth = Buffer.from(
        `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
      ).toString("base64");

      const response = await axios.post(
        "https://api.razorpay.com/v1/orders",
        {
          amount: Math.round(amount * 100), // paise
          currency,
          receipt,
        },
        {
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
          },
        }
      );

      return { success: true, order: response.data };
    } catch (error) {
      logger.error(
        `Razorpay order creation error: ${error.response?.data?.error?.description || error.message
        }`
      );
      return {
        success: false,
        error:
          error.response?.data?.error?.description || error.message,
      };
    }
  }

  /**
   * Verify Razorpay Signature
   */
  static verifyRazorpaySignature(orderId, paymentId, signature) {
    const text = `${orderId}|${paymentId}`;
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(text)
      .digest("hex");
    return generatedSignature === signature;
  }

  /**
   * Create Payment Intent
   */
  static async createPaymentIntent(data, user) {
    const {
      bookingId,
      orderId,
      amount,
      paymentDestination = "company_account",
    } = data;

    if (!bookingId && !orderId) {
      throw new Error("bookingId or orderId is required");
    }

    let refDoc;
    let paymentType;
    let providerId = null;
    let shopId = null;
    let userId;

    if (bookingId) {
      refDoc = await Booking.findById(bookingId);
      if (!refDoc) throw new Error("Booking not found");
      if (refDoc.user.toString() !== user._id.toString()) {
        throw new Error("Not authorized");
      }

      paymentType = "service";
      providerId = refDoc.provider;
      userId = refDoc.user;
    } else {
      refDoc = await Order.findById(orderId);
      if (!refDoc) throw new Error("Order not found");
      if (refDoc.user.toString() !== user._id.toString()) {
        throw new Error("Not authorized");
      }

      paymentType = "product_order";
      shopId = refDoc.shop;
      userId = refDoc.user;
    }

    // ✅ IDEMPOTENCY: Check for existing PENDING payment for this entity
    // This prevents creating multiple Razorpay orders for the same booking/order
    const existingPayment = await Payment.findOne({
      [bookingId ? 'booking' : 'order']: bookingId || orderId,
      status: 'pending',
      amount: amount,
      createdAt: { $gt: new Date(Date.now() - 20 * 60 * 1000) } // Recent (20 mins)
    }).session(session);

    if (existingPayment && existingPayment.transactionId) {
      logger.info(`Idempotency HIT: Reusing existing Razorpay order ${existingPayment.transactionId}`);
      return {
        orderId: existingPayment.transactionId,
        amount: Math.round(existingPayment.amount * 100),
        currency: "INR",
        paymentId: existingPayment._id,
        paymentDestination: existingPayment.paymentDestination,
        commission: {
          rate: existingPayment.paymentDestination === "company_account" ? 15 : 20,
          amount: existingPayment.totalCommission,
        },
      };
    }

    const receipt = `RCPT-${Date.now()}`;

    const razorpayOrder = await this.createRazorpayOrder(
      amount,
      "INR",
      receipt
    );

    if (!razorpayOrder.success) {
      throw new Error(razorpayOrder.error);
    }

    const payment = await Payment.create({
      transactionId: razorpayOrder.order.id,
      booking: bookingId || null,
      order: orderId || null,
      user: userId,
      provider: providerId,
      shop: shopId,
      amount,
      paymentMethod: "upi",
      paymentGateway: "razorpay",
      paymentDestination,
      paymentType,
      status: "pending",
    });

    await payment.calculateCommission();
    await payment.save();

    return {
      orderId: razorpayOrder.order.id,
      amount: razorpayOrder.order.amount,
      currency: razorpayOrder.order.currency,
      paymentId: payment._id,
      paymentDestination,
      commission: {
        rate: payment.paymentDestination === "company_account" ? 15 : 20,
        amount: payment.totalCommission,
      },
    };
  }

  /**
   * Verify & Process Payment
   */
  static async verifyAndProcessPayment(data, user, app = null) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        bookingId,
        orderId,
        paymentMethod = "online",
      } = data;

      if (
        !razorpay_order_id ||
        !razorpay_payment_id ||
        !razorpay_signature
      ) {
        throw new Error("Missing Razorpay details");
      }

      const isValid = this.verifyRazorpaySignature(
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      );

      if (!isValid) throw new Error("Invalid payment signature");

      let payment = await Payment.findOne({
        $or: [
          { transactionId: razorpay_order_id },
          { gatewayTransactionId: razorpay_payment_id },
        ],
      }).session(session);

      const entityType = bookingId ? "booking" : "order";
      const entity = bookingId
        ? await Booking.findById(bookingId).session(session)
        : await Order.findById(orderId).session(session);

      if (!entity) throw new Error(`${entityType} not found`);
      if (entity.user.toString() !== user._id.toString()) {
        throw new Error("Not authorized");
      }

      if (payment) {
        payment.status = "success";
        payment.paymentDate = new Date();
        payment.verified = true;
        payment.gatewayTransactionId = razorpay_payment_id;
        payment.paymentMethod = paymentMethod;
        await payment.save({ session });
      } else {
        const created = await Payment.create(
          [
            {
              transactionId: razorpay_order_id,
              user: user._id,
              amount:
                entityType === "booking"
                  ? entity.totalAmount
                  : entity.pricing.totalAmount,
              paymentMethod,
              paymentGateway: "razorpay",
              status: "success",
              gatewayTransactionId: razorpay_payment_id,
              paymentDate: new Date(),
              verified: true,
              booking: bookingId || null,
              order: orderId || null,
              provider: entity.provider || null,
              shop: entity.shop || null,
              paymentType:
                entityType === "booking"
                  ? "service"
                  : "product_order",
            },
          ],
          { session }
        );

        payment = created[0];
      }

      await payment.calculateCommission();
      await payment.save({ session });

      entity.payment = {
        method: paymentMethod,
        status: "paid",
        transactionId: razorpay_payment_id,
        gateway: "razorpay",
        paidAt: new Date(),
        _id: payment._id,
      };

      await entity.save({ session });

      await CommissionService.processCommission(payment._id, session);

      await session.commitTransaction();

      NotificationService.send(
        {
          recipient: user._id,
          recipientType: "User",
          type: "payment",
          title: "Payment Successful",
          message: `Your payment of ₹${payment.amount} was successful.`,
          data: { paymentId: payment._id },
        },
        app
      ).catch((e) =>
        logger.error(`Payment Notification Error: ${e.message}`)
      );

      return {
        payment,
        entity: {
          type: entityType,
          id: entity._id,
          status: entity.status,
        },
      };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }
}

// Export as CommonJS
module.exports = PaymentService;