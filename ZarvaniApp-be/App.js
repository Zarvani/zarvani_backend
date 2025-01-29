const express = require('express');
const app = express();
const cookieParser = require("cookie-parser");
const cors = require('cors');
const userRouter = require("./Route/UserRouter");
const Middleware = require('./Middleware/Middleware');
const verifyRouter=require("./Route/VerifyRouter")
const documentUpload=require('./Route/DocumentRoute')
const adminVerify=require("./Route/AdminRouter")
const subscribe=require("./Route/subscriberRoute")
const location=require("./Route/locationRoute")

app.use(express.json());
app.use(cookieParser());

app.use(cors({
    origin: '*',
    credentials: true, 
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS','PATCH'], 
    allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
}));

app.use("/api/v1", userRouter);
app.use("/api/v1", verifyRouter);
app.use("/api/v1", documentUpload);
app.use("/api/v1", adminVerify);
app.use("/api/v1", subscribe);
app.use("/api/v1", location);
app.use(Middleware);

module.exports = app;