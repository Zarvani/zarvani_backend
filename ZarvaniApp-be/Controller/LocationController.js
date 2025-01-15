const Location = require('..//Model/locationModel');

const updateLocationIfChanged = async (req, res) => {
  try {
    const { latitude, longitude,timestamp } = req.body;
    const userId = req.user.id;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required.' });
    }

    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Latitude and longitude are required.' });
    }

    // Update if exists or create a new document
    const updatedLocation = await Location.findOneAndUpdate(
      { userId }, // Find document by userId
      { latitude, longitude, timestamp},
      { new: true, upsert: true } // Return updated document and create if not found
    );

    return res.status(200).json({
      message: 'Location updated successfully.',
      success:true,
      location: updatedLocation,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error while updating location.' });
  }
};

module.exports={updateLocationIfChanged};