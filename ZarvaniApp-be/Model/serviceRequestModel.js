const mongoose = require('mongoose');

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

module.exports = mongoose.model('Service', serviceSchema);
