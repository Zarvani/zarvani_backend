const mongoose = require('mongoose');

const SERVICE_TYPE_IDS = {
  Electrician: 'SRV-ELEC',
  Plumber: 'SRV-PLMB',
  Carpenter: 'SRV-CARP',
  Mechanic: 'SRV-MECH',
  LaundryWorker: 'SRV-LAUN',
  Housekeeper: 'SRV-HKPR',
  Mover: 'SRV-MOVE',
};

const serviceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Userdata',
      required: true,
    },
    serviceDescription: {
      type: String,
      required: true,
    },
    serviceManType: {
      type: String,
      required: true,
      enum: Object.keys(SERVICE_TYPE_IDS),
    },
    serviceId: {
      type: String,
      unique: true,
    },
    files: {
      type: [String],
      validate: [
        {
          validator: function (files) {
            return files.length <= 3;
          },
          message: 'You can upload a maximum of 3 files.',
        },
        {
          validator: function (files) {
            return files.every(file => /\.(jpg|png|mp4)$/i.test(file));
          },
          message: 'Files must be in jpg, png, or mp4 format.',
        },
      ],
    },
  },
  { timestamps: true }
);

// Pre-save middleware to generate serviceId
serviceSchema.pre('save', function (next) {
  if (!this.serviceId && this.serviceManType in SERVICE_TYPE_IDS) {
    this.serviceId = `${SERVICE_TYPE_IDS[this.serviceManType]}-${Date.now()}`;
  }
  next();
});

module.exports = mongoose.model('Service', serviceSchema);
