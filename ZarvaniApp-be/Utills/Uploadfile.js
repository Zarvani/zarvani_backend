const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const uploadDocument = async (req, res, model, documentField) => {
    try {
        const userId = req.user.id;
        const file = req.file;
  
        const s3 = new S3Client({
            region: process.env.AWS_S3_REGION_NAME,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
        });
        
        
        const uploadToS3 = async (file, folder, userId) => {
            const bucketName = process.env.AWS_STORAGE_BUCKET_NAME;
            const filePath = `${userId}/${folder}/${file.originalname}`;
        
            const params = {
                Bucket: bucketName,
                Key: filePath,
                Body: file.buffer,
                ContentType: file.mimetype,
            };
        
            try {
                const command = new PutObjectCommand(params);
                await s3.send(command);
                const fileUrl = `https://${bucketName}.s3.${process.env.AWS_S3_REGION_NAME}.amazonaws.com/${filePath}`;
                return fileUrl;
            } catch (error) {
                console.error("Error uploading to S3:", error);
                throw error;
            }
        };
        
        if (!file) {
            return res.status(400).json({ message: "Please upload a file" });
        }

        const fileUrl = await uploadToS3(file, documentField, userId);

        const updateData = { [documentField]: fileUrl,isVerified: false };
        const document = await model.findOneAndUpdate(
            { userId },
            updateData,
            { new: true, upsert: true }
        ).select('-__v');
        res.status(200).json({
            success: true,
            message: `${documentField} uploaded successfully. Awaiting admin approval.`,
        });
    } catch (error) {
        res.status(500).json({ message: `Error uploading ${documentField}`, error });
    }
};

const getAllDocument = async (req, res, model) => {
    try {
        const userId = req.params.id;
        
        const userDocuments = await model.find({ userId });

        if (!userDocuments || userDocuments.length === 0) {
            return res.status(404).json({ message: "No documents found for this user" });
        }

        res.status(200).json({
            message: "Documents fetched successfully",
            userDocuments,
        });
    } catch (error) {
        console.error("Error fetching documents:", error);
        res.status(500).json({ message: "Error fetching documents", error });
    }
};

module.exports = { uploadDocument,getAllDocument };
