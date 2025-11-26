const axios = require("axios");

async function getAddressFromCoords(latitude, longitude) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`;

    const res = await axios.get(url, {
      headers: { "User-Agent": "Node.js Server" }
    });

    const a = res.data.address;

    return {
      label: "Home",
      addressLine1: a.road || "ABC",
      addressLine2: a.suburb || "ABC",
      city: a.city || a.town || a.village || "",
      state: a.state || "",
      pincode: a.postcode || "",
      landmark: a.neighbourhood || "",
      location: {
        type: "Point",
        coordinates: [longitude, latitude]
      },
      isDefault: true
    };
  } catch (err) {
    console.log("Reverse geocode error:", err.message);
    return null;
  }
}

module.exports = getAddressFromCoords;
