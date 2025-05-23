const Order = require('../Model/orderModel');
const { v4: uuidv4 } = require('uuid'); 

// Create order (customer creates order - no assignment initially)
const createOrder = async (req, res) => {
    try {
      let { service, userData, files } = req.body;
      const userId = req.user.id; 
  
      if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
      }
  
      // Sanitize the price if it's a string with currency symbol
      if (typeof service.price === 'string') {
        service.price = parseFloat(service.price.replace(/[^0-9.]/g, ''));
      }
  
      const newOrder = new Order({
        userId,
        orderId: uuidv4(),
        service,
        userData,
        files,
        orderStatus: 'initiated', // Using your field name
        serviceProviderId: null, // No assignment initially
      });
  
      await newOrder.save();
  
      res.status(201).json({
        message: 'Order created successfully',
        order: newOrder,
      });
    } catch (error) {
      console.error('Error creating order:', error);
      res.status(500).json({ message: 'Server error' });
    }
};

// Get available orders by service category (for service providers to browse)
const getAvailableOrdersByCategory = async (req, res) => {
    try {
        const { category } = req.params;
        const providerId = req.user.id;
        
        if (!category) {
            return res.status(400).json({ message: 'Service category is required' });
        }

        if (!providerId) {
            return res.status(400).json({ message: 'Service provider authentication required' });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const sortBy = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

        // Query for unassigned orders in the category
        const query = {
            'service.category': { $regex: new RegExp(category, 'i') },
            orderStatus: 'initiated', // Only initiated orders
            serviceProviderId: null // Only unassigned orders
        };

        const skip = (page - 1) * limit;
        const sort = {};
        sort[sortBy] = sortOrder;

        const orders = await Order.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .populate('userId', 'name email phone')
            .lean();

        const totalOrders = await Order.countDocuments(query);
        const totalPages = Math.ceil(totalOrders / limit);

        res.status(200).json({
            message: 'Available orders retrieved successfully',
            data: {
                orders,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalOrders,
                    hasNext: page < totalPages,
                    hasPrev: page > 1,
                    limit
                }
            }
        });

    } catch (error) {
        console.error('Error fetching available orders:', error);
        res.status(500).json({ message: 'Server error while fetching orders' });
    }
};

// Service provider accepts an order
const acceptOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const providerId = req.user.id;
        const { estimatedCompletionTime, providerNote } = req.body;

        if (!providerId) {
            return res.status(400).json({ message: 'Service provider authentication required' });
        }

        // Find the order and check if it's still available
        const order = await Order.findOne({
            orderId: orderId,
            orderStatus: 'initiated',
            serviceProviderId: null
        });

        if (!order) {
            return res.status(404).json({ 
                message: 'Order not found or already assigned to another provider' 
            });
        }

        // Update order with service provider assignment
        order.serviceProviderId = providerId;
        order.orderStatus = 'accepted';
        
        if (estimatedCompletionTime) {
            order.estimatedCompletionTime = new Date(estimatedCompletionTime);
        }
        
        // Add provider note if provided
        if (providerNote) {
            order.providerNotes.push(providerNote);
        }

        await order.save();

        res.status(200).json({
            message: 'Order accepted successfully',
            order: order
        });

    } catch (error) {
        console.error('Error accepting order:', error);
        res.status(500).json({ message: 'Server error while accepting order' });
    }
};

// Service provider updates order status
const updateOrderStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const providerId = req.user.id;
        const { status, note, completionImages, estimatedCompletionTime } = req.body;

        const validStatuses = ['accepted', 'in-progress', 'completed', 'cancelled'];
        
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ 
                message: 'Invalid status. Valid statuses: ' + validStatuses.join(', ') 
            });
        }

        // Find order assigned to this provider
        const order = await Order.findOne({
            orderId: orderId,
            serviceProviderId: providerId
        });

        if (!order) {
            return res.status(404).json({ 
                message: 'Order not found or not assigned to you' 
            });
        }

        // Update order status
        order.orderStatus = status;
        
        if (estimatedCompletionTime) {
            order.estimatedCompletionTime = new Date(estimatedCompletionTime);
        }

        if (completionImages && status === 'completed') {
            order.completionImages = completionImages;
        }

        // Add provider note if provided
        if (note) {
            order.providerNotes.push(note);
        }

        // Add to status history manually if needed
        order.statusHistory.push({
            status: status,
            timestamp: new Date(),
            note: note || `Order status updated to ${status}`,
            updatedBy: providerId,
            updatedByModel: 'ServiceProvider',
            images: completionImages || []
        });

        await order.save();

        res.status(200).json({
            message: 'Order status updated successfully',
            order: order
        });

    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ message: 'Server error while updating order status' });
    }
};

// Get orders assigned to service provider
const getMyOrders = async (req, res) => {
    try {
        const providerId = req.user.id;
        
        if (!providerId) {
            return res.status(400).json({ message: 'Service provider authentication required' });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const status = req.query.status;
        const sortBy = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

        const query = {
            serviceProviderId: providerId
        };

        if (status) {
            query.orderStatus = status;
        }

        const skip = (page - 1) * limit;
        const sort = {};
        sort[sortBy] = sortOrder;

        const orders = await Order.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .populate('userId', 'name email phone')
            .lean();

        const totalOrders = await Order.countDocuments(query);
        const totalPages = Math.ceil(totalOrders / limit);

        res.status(200).json({
            message: 'Your orders retrieved successfully',
            data: {
                orders,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalOrders,
                    hasNext: page < totalPages,
                    hasPrev: page > 1,
                    limit
                }
            }
        });

    } catch (error) {
        console.error('Error fetching provider orders:', error);
        res.status(500).json({ message: 'Server error while fetching your orders' });
    }
};

// Get user's orders (for customers to track their orders)
const getUserOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        
        if (!userId) {
            return res.status(400).json({ message: 'User authentication required' });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const status = req.query.status;
        const sortBy = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

        const query = {
            userId: userId
        };

        if (status) {
            query.orderStatus = status;
        }

        const skip = (page - 1) * limit;
        const sort = {};
        sort[sortBy] = sortOrder;

        const orders = await Order.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .populate('serviceProviderId', 'name email phone businessName')
            .lean();

        const totalOrders = await Order.countDocuments(query);
        const totalPages = Math.ceil(totalOrders / limit);

        res.status(200).json({
            message: 'Your orders retrieved successfully',
            data: {
                orders,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalOrders,
                    hasNext: page < totalPages,
                    hasPrev: page > 1,
                    limit
                }
            }
        });

    } catch (error) {
        console.error('Error fetching user orders:', error);
        res.status(500).json({ message: 'Server error while fetching your orders' });
    }
};

// Get order details with full status history
const getOrderDetails = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;

        const order = await Order.findOne({ orderId: orderId })
            .populate('userId', 'name email phone')
            .populate('serviceProviderId', 'name email phone businessName')
            .lean();

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Check if user has permission to view this order
        const isCustomer = order.userId._id.toString() === userId;
        const isProvider = order.serviceProviderId && order.serviceProviderId._id.toString() === userId;

        if (!isCustomer && !isProvider) {
            return res.status(403).json({ message: 'Unauthorized to view this order' });
        }

        res.status(200).json({
            message: 'Order details retrieved successfully',
            data: {
                order
            }
        });

    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).json({ message: 'Server error while fetching order details' });
    }
};

// Get all service categories
const getServiceCategories = async (req, res) => {
    try {
        const categories = await Order.distinct('service.category');
        
        res.status(200).json({
            message: 'Service categories retrieved successfully',
            data: {
                categories: categories.filter(cat => cat)
            }
        });

    } catch (error) {
        console.error('Error fetching service categories:', error);
        res.status(500).json({ message: 'Server error while fetching categories' });
    }
};

// Add provider note to existing order
const addProviderNote = async (req, res) => {
    try {
        const { orderId } = req.params;
        const providerId = req.user.id;
        const { note } = req.body;

        if (!note) {
            return res.status(400).json({ message: 'Note is required' });
        }

        const order = await Order.findOne({
            orderId: orderId,
            serviceProviderId: providerId
        });

        if (!order) {
            return res.status(404).json({ 
                message: 'Order not found or not assigned to you' 
            });
        }

        order.providerNotes.push(note);
        await order.save();

        res.status(200).json({
            message: 'Note added successfully',
            order: order
        });

    } catch (error) {
        console.error('Error adding provider note:', error);
        res.status(500).json({ message: 'Server error while adding note' });
    }
};

module.exports = {
    createOrder,
    getAvailableOrdersByCategory,
    acceptOrder,
    updateOrderStatus,
    getMyOrders,
    getUserOrders,
    getOrderDetails,
    getServiceCategories,
    addProviderNote
};