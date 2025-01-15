const app= require("./App")
const dotenv = require('dotenv');
const path = require('path');
const ConnectDB=require("./Database/Databaseconnect")

const configPath = path.resolve(__dirname, '../ZarvaniApp-be/config/config.env');

dotenv.config({ path: configPath });
ConnectDB();

const sever=app.listen(process.env.PORT, () => {
    console.log(`Server is running on http://localhost:${process.env.PORT}`);
  
  });