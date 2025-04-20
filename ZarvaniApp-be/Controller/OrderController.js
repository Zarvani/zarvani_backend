const Order = require('../Model/orderModel');
const { v4: uuidv4 } = require('uuid'); 


const createOrder = async (req, res) => {
    try {
      let { service, userData, files } = req.body;
      const userId = req.user.id; 
  
      if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
      }
  
      // Sanitize the price if it's a string with currency symbol
      if (typeof service.price === 'string') {
        service.price = parseFloat(service.price.replace(/[^0-9.]/g, '')); // Removes ₹ and keeps the number
      }
  
      const newOrder = new Order({
        userId,
        orderId: uuidv4(),
        service,
        userData,
        files,
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
  

module.exports = {
  createOrder,
};
