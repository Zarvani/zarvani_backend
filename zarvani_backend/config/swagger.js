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
                url: 'http://localhost:4000',
                description: 'Development server',
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
