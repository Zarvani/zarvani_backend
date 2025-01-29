const Location=require('../Model/locationModel')

const applyAdditionalFilters = (users, { country, state, gender, city, bloodGroup, organDonations }) => {
    let filteredUsers = users;

    if (country) {
        filteredUsers = filteredUsers.filter(user => user.country === country);
    }
    if (state) {
        filteredUsers = filteredUsers.filter(user => user.state === state);
    }
    if (gender) {
        filteredUsers = filteredUsers.filter(user => user.gender === gender);
    }
    if (city) {
        filteredUsers = filteredUsers.filter(user => user.city === city);
    }
    if (bloodGroup) {
        filteredUsers = filteredUsers.filter(user => user.bloodGroup === bloodGroup);
    }
    if (organDonations) {
        filteredUsers = filteredUsers.filter(user => 
            user.organDonations && user.organDonations.some(donation => organDonations.includes(donation))
        );
    }

    return filteredUsers;
};
const calculateDistance = (point1, point2) => {
    const R = 6371e3; // Radius of Earth in meters
    const φ1 = point1.latitude * Math.PI / 180;
    const φ2 = point2.latitude * Math.PI / 180;
    const Δφ = (point2.latitude - point1.latitude) * Math.PI / 180;
    const Δλ = (point2.longitude - point1.longitude) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; 
};

// Function to filter donors based on radius and location
const filterWorkerByLocation = async (userdetail, radius, latitude, longitude) => {
    const radiusInMeters = radius === "50" ? 50000 : 100000; // 50km or 100km in meters

    // Fetch recipient's location
    const recipientLocation = { latitude: parseFloat(latitude), longitude: parseFloat(longitude) };

    // Fetch all donor locations and calculate distance
    const donorLocations = await Location.find({ userId: { $in: userdetail.map(user => user._id) } });

    // Filter donors based on the radius and distance
    return userdetail.filter(user => {
        const donorLocation = donorLocations.find(location => location.userId.toString() === user._id.toString());
        if (donorLocation) {
            const distance = calculateDistance(recipientLocation, donorLocation);
            return distance <= radiusInMeters;
        }
        return false;
    });
};

module.exports={applyAdditionalFilters,filterWorkerByLocation}