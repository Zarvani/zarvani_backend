const swaggerJSDoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Yetzo API Documentation',
            version: '1.0.0',
            description: 'API reference for the Yetzo Service Marketplace Backend',
            contact: {
                name: 'Yetzo Support',
                email: 'admin@zarvani.com',
            },
        },
        servers: [
            {
                url: process.env.BASE_URL || `http://localhost:${process.env.PORT || 4000}`,
                description: 'Current Environment',
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
    },
    // Paths to files containing OpenAPI definitions
    apis: ['./routes/*.js', './models/*.js', './controllers/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;
