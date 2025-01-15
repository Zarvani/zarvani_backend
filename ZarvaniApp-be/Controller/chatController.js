const twilio = require('twilio');
const mongoose = require("mongoose");
const chatId=require("../Model/ChatIdModel")
const Userdata= require("../Model/userModel")
const createOrGetConversation = async (req, res) => {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const donor = req.body.donor;
  const recipient = req.user.id;
  if (!recipient || !donor) {
    return res.status(400).send("Recipient and donor identities are required");
  }

  try {
    // Check if a conversation already exists
    const existingConversations = await client.conversations.v1.conversations.list();
    const conversation = existingConversations.find(
      (conv) =>
        conv.uniqueName === `${recipient}_${donor}` ||
        conv.uniqueName === `${donor}_${recipient}`
    );

    if (conversation) {
      // Check if the conversation SID is already saved in the database
      const existingChatId = await chatId.findOne({ conversationId: conversation.sid });

      if (existingChatId) {
        // Save the conversation SID to the ChatId schema
        await chatId.create({
          userId:donor,  
          recipientId:recipient,
          conversationId: conversation.sid,
        });
      }
      return res.send({ conversationSid: conversation.sid });
 }
    const newConversation = await client.conversations.v1.conversations.create({
      uniqueName: `${recipient}_${donor}`,
    });

    // Add participants
    await newConversation.participants.create({ identity: recipient });
    await newConversation.participants.create({ identity: donor });

    // Save the new conversation SID to the ChatId schema
    await chatId.create({
      userId:donor,  
      conversationId: newConversation.sid,
      recipientId:recipient,
    });
    res.send({ conversationSid: newConversation.sid });
  } catch (error) {
    console.error("Error creating or fetching conversation:", error);
    res.status(500).send("Failed to create or fetch conversation");
  }
};


const getConversationByDonor = async (req, res) => {
  const reciptent = req.body.reciptent;
  const donor = req.user.id; 
  if (!donor) {
    return res.status(400).send('Donor identity is required');
  }

  try {
      const conversation = await chatId. findOne({
      userId: donor,
      recipientId: reciptent, 
    });

    if (!conversation) {
      return res.status(404).send('No conversation found for this donor');
    }

    res.status(200).json({
      success: true,
      conversationId: conversation.conversationId, 
    });

  } catch (error) {
    console.error('Error fetching conversation for donor:', error);
    res.status(500).send('Failed to fetch conversation for donor');
  }
};



const sendMessage = async (req, res) => {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const { conversationSid, message } = req.body;
  const recipient=req.user.id;
  const avatarUrl = req.user.avatar?.url;
  if (!conversationSid || !recipient || !message) {
    return res.status(400).send('Conversation SID, recipient, and message are required');
  }

  try {
    
    await client.conversations.v1.conversations(conversationSid).messages.create({
      author: recipient,
      avtar:avatarUrl,
      body: message,
    });

    res.send({ message: 'Message sent successfully' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).send('Failed to send message');
  }
};
const fetchMessages = async (req, res) => {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const  conversation = req.params;
  const  conversationSid =conversation.id;
  if (!conversationSid) {
    return res.status(400).send('Conversation SID is required');
  }

  try {
    const messages = await client.conversations.v1.conversations(conversationSid).messages.list();

    const formattedMessages = messages.map(msg => ({
      author: msg.author,
      avtar:msg.avtar,
      body: msg.body,
      dateCreated: msg.dateCreated,
    }));

    res.send(formattedMessages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).send('Failed to fetch messages');
  }
};

const senderDetails= async (req,res)=>{
  const userId = req.user.id;
  if (!userId) {
    return res.status(400).send("User ID is required");
  }
  try {
    const chatDetails = await chatId.find({ userId }).select("recipientId");

    if (!chatDetails || chatDetails.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No recipient details found for this user",
      });
    }

    const recipientIds = chatDetails.map((chat) => chat.recipientId);

    const recipients = await Userdata.find({ _id: { $in: recipientIds } }).select(
      "firstname lastname avatar.url"
    );
    
    if (!recipients || recipients.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No recipient data found for the given recipient IDs",
      });
    }

    res.status(200).json({
      success: true,
      data: recipients,
    });
  } catch (error) {
    console.error("Error fetching recipient details:", error);
    res.status(500).send("Failed to fetch recipient details");
  }

}
 module.exports={
    createOrGetConversation,
  sendMessage,
  fetchMessages,
  getConversationByDonor,
  senderDetails
 }