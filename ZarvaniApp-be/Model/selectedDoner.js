const mongoose=require('mongoose');
 const selectDonerSchema= new mongoose.Schema({
     userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Userdata',
        required: true,
      },
      donerId:{
        type: String,
        required: true,
      },
      selectedDate:{
        type: Date,
        default: Date.now,
      },
      expireDate:{
        type: Date,
        required: true,
      }
 })

 module.exports=mongoose.model('SelectedDoner',selectDonerSchema);