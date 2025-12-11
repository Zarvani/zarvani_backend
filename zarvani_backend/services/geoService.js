// ============= services/geoService.js =============
const axios = require("axios");
const logger = require("../utils/logger");

class GeoService {
  // -----------------------------
  // CONFIG (Static Variables)
  // -----------------------------
  static API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  static GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
  static DISTANCE_MATRIX_URL = "https://maps.googleapis.com/maps/api/distancematrix/json";
  static PLACES_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";

  // -----------------------------
  // 📌 Helpers
  // -----------------------------
  static toRad(deg) {
    return deg * Math.PI / 180;
  }

  static calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  // -----------------------------
  // 📍 GEOCODING — Address → Coordinates
  // -----------------------------
  static async getCoordinatesFromAddress(address) {
    try {
      const addressString =
        typeof address === "string"
          ? address
          : [
              address.addressLine1,
              address.addressLine2,
              address.landmark,
              address.city,
              address.state,
              address.pincode,
              address.country,
            ]
              .filter(Boolean)
              .join(", ");

      const response = await axios.get(this.GEOCODE_URL, {
        params: {
          address: addressString,
          key: this.API_KEY,
        },
      });

      if (response.data.status !== "OK")
        return { success: false, error: "Unable to geocode address" };

      const result = response.data.results[0];
      const loc = result.geometry.location;

      return {
        success: true,
        coordinates: [loc.lng, loc.lat],
        formattedAddress: result.formatted_address,
        addressComponents: result.address_components,
      };
    } catch (error) {
      logger.error("Geocoding error:", error.message);
      return { success: false, error: error.message };
    }
  }

  // -----------------------------
  // 📍 Reverse Geocoding — Coordinates → Address
  // -----------------------------
  static async getAddressFromCoordinates(lat, lng) {
    try {
      const response = await axios.get(this.GEOCODE_URL, {
        params: {
          latlng: `${lat},${lng}`,
          key: this.API_KEY,
        },
      });

      if (response.data.status !== "OK")
        return { success: false, error: "Unable to reverse geocode" };

      const result = response.data.results[0];

      return {
        success: true,
        address: result.formatted_address,
        addressComponents: result.address_components,
      };
    } catch (error) {
      logger.error("Reverse geocoding error:", error.message);
      return { success: false, error: error.message };
    }
  }

  // -----------------------------
  // 🚗 ETA (Time + Distance)
  // -----------------------------
  static async calculateETA(origin, destination, mode = "driving") {
    try {
      const response = await axios.get(this.DISTANCE_MATRIX_URL, {
        params: {
          origins: `${origin.latitude},${origin.longitude}`,
          destinations: `${destination.latitude},${destination.longitude}`,
          mode,
          key: this.API_KEY,
        },
      });

      const element = response?.data?.rows?.[0]?.elements?.[0];

      if (!element || element.status !== "OK")
        return { success: false, error: "Unable to calculate ETA" };

      return {
        success: true,
        distance: element.distance.value / 1000,
        duration: element.duration.value / 60,
        distanceText: element.distance.text,
        durationText: element.duration.text,
      };
    } catch (error) {
      logger.error("ETA error:", error.message);
      return { success: false, error: error.message };
    }
  }

  // -----------------------------
  // 🏪 Nearby Shops (Google Places API)
  // -----------------------------
  static async findNearbyShops(lat, lng, radius = 5000, limit = 20) {
    try {
      const response = await axios.get(this.PLACES_URL, {
        params: {
          location: `${lat},${lng}`,
          radius,
          type: "grocery_or_supermarket",
          key: this.API_KEY,
        },
      });

      if (response.data.status !== "OK")
        return { success: false, error: "Unable to fetch nearby shops" };

      const shops = response.data.results.slice(0, limit).map((p) => ({
        name: p.name,
        address: p.vicinity,
        location: {
          latitude: p.geometry.location.lat,
          longitude: p.geometry.location.lng,
        },
        rating: p.rating,
        totalRatings: p.user_ratings_total,
        openNow: p.opening_hours?.open_now,
        photos: p.photos,
      }));

      return { success: true, shops };
    } catch (error) {
      logger.error("Nearby shops error:", error.message);
      return { success: false, error: error.message };
    }
  }

  // -----------------------------
  // 🗺️ MongoDB $near Search
  // -----------------------------
  static async findNearby(Model, coordinates, radiusKm = 10, filter = {}) {
    try {
      return await Model.find({
        ...filter,
        "address.location": {
          $near: {
            $geometry: { type: "Point", coordinates },
            $maxDistance: radiusKm * 1000,
          },
        },
      });
    } catch (error) {
      logger.error("MongoDB find nearby error:", error.message);
      return [];
    }
  }

  // -----------------------------
  // 📦 Batch Geocoding
  // -----------------------------
  static async batchGeocode(addressList) {
    try {
      const output = [];

      for (const addr of addressList) {
        const result = await this.getCoordinatesFromAddress(addr);
        output.push({ address: addr, ...result });

        await new Promise((r) => setTimeout(r, 100)); // Rate limit
      }

      return output;
    } catch (error) {
      logger.error("Batch geocoding error:", error.message);
      return [];
    }
  }
}

module.exports = GeoService;
