// ============= utils/responseHandler.js =============
class ResponseHandler {
    static success(res, data, message = 'Success', statusCode = 200) {
        return res.status(statusCode).json({
            success: true,
            message,
            data
        });
    }

    static error(res, message = 'Error', statusCode = 500) {
        return res.status(statusCode).json({
            success: false,
            message
        });
    }

    static paginated(res, data, page, limit, total, extraMeta = {}) {
        return res.status(200).json({
            success: true,
            data,
            meta: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / limit),
                ...extraMeta
            }
        });
    }
}

module.exports = ResponseHandler;
