

// ============= services/geoService.js =============
const axios = require('axios');
const logger = require('../utils/logger');

class GeoService {
  // Calculate distance between two coordinates using Haversine formula
  static calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the Earth in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return distance; // Distance in km
  }
  
  static toRad(value) {
    return value * Math.PI / 180;
  }
  
  // Get coordinates from address using Google Maps API
  static async getCoordinatesFromAddress(address) {
    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/geocode/json',
        {
          params: {
            address: `${address.addressLine1}, ${address.city}, ${address.state}, ${address.pincode}`,
            key: process.env.GOOGLE_MAPS_API_KEY
          }
        }
      );
      
      if (response.data.status === 'OK' && response.data.results.length > 0) {
        const location = response.data.results[0].geometry.location;
        return {
          success: true,
          coordinates: [location.lng, location.lat] // [longitude, latitude] for MongoDB
        };
      }
      
      return { success: false, error: 'Address not found' };
    } catch (error) {
      logger.error(`Geocoding error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  
  // Find nearby providers or shops
  static async findNearby(Model, coordinates, radiusInKm = 10, filter = {}) {
    try {
      const results = await Model.find({
        ...filter,
        'address.location': {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: coordinates // [longitude, latitude]
            },
            $maxDistance: radiusInKm * 1000 // Convert km to meters
          }
        }
      });
      
      return results;
    } catch (error) {
      logger.error(`Find nearby error: ${error.message}`);
      return [];
    }
  }
  
  // Get route distance and duration using Google Maps Directions API
  static async getRouteInfo(origin, destination) {
    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/directions/json',
        {
          params: {
            origin: `${origin[1]},${origin[0]}`, // lat,lng
            destination: `${destination[1]},${destination[0]}`,
            key: process.env.GOOGLE_MAPS_API_KEY
          }
        }
      );
      
      if (response.data.status === 'OK' && response.data.routes.length > 0) {
        const route = response.data.routes[0].legs[0];
        return {
          success: true,
          distance: route.distance.value / 1000, // Convert to km
          duration: route.duration.value / 60, // Convert to minutes
          distanceText: route.distance.text,
          durationText: route.duration.text
        };
      }
      
      return { success: false, error: 'Route not found' };
    } catch (error) {
      logger.error(`Route info error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

module.exports = GeoService;