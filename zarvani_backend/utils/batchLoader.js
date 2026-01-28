/**
 * Batch Loading Utilities
 * Helps prevent N+1 query problems by batching database queries
 */

/**
 * Batch load documents by IDs
 * @param {Model} Model - Mongoose model
 * @param {Array} ids - Array of document IDs
 * @param {String} selectFields - Fields to select
 * @returns {Map} Map of id -> document
 */
async function batchLoadByIds(Model, ids, selectFields = '') {
    if (!ids || ids.length === 0) return new Map();

    // Remove duplicates and filter out null/undefined
    const uniqueIds = [...new Set(ids.filter(id => id))];

    // Fetch all documents in one query
    const query = Model.find({ _id: { $in: uniqueIds } }).lean();

    if (selectFields) {
        query.select(selectFields);
    }

    const documents = await query;

    // Create a map for O(1) lookup
    const docMap = new Map();
    documents.forEach(doc => {
        docMap.set(doc._id.toString(), doc);
    });

    return docMap;
}

/**
 * Batch load and attach related documents
 * @param {Array} items - Array of items to attach data to
 * @param {String} foreignKey - Foreign key field name in items
 * @param {Model} Model - Mongoose model to load from
 * @param {String} attachKey - Key name to attach loaded data to
 * @param {String} selectFields - Fields to select
 */
async function batchLoadAndAttach(items, foreignKey, Model, attachKey, selectFields = '') {
    if (!items || items.length === 0) return;

    // Extract foreign key IDs
    const ids = items.map(item => item[foreignKey]).filter(id => id);

    // Batch load
    const docMap = await batchLoadByIds(Model, ids, selectFields);

    // Attach to items
    items.forEach(item => {
        if (item[foreignKey]) {
            const key = item[foreignKey].toString();
            item[attachKey] = docMap.get(key) || null;
        }
    });
}

/**
 * Batch load nested documents (e.g., delivery boys from shops)
 * @param {Array} items - Array of items
 * @param {String} foreignKey - Foreign key field name
 * @param {Model} Model - Mongoose model
 * @param {String} nestedPath - Path to nested array (e.g., 'deliveryBoys')
 * @param {String} nestedIdField - ID field in nested array (e.g., '_id')
 * @param {String} attachKey - Key to attach result to
 */
async function batchLoadNested(items, foreignKey, Model, nestedPath, nestedIdField, attachKey) {
    if (!items || items.length === 0) return;

    // Extract IDs
    const ids = items.map(item => item[foreignKey]).filter(id => id);
    if (ids.length === 0) return;

    const uniqueIds = [...new Set(ids)];

    // Build query to find documents with nested arrays containing these IDs
    const query = {};
    query[`${nestedPath}.${nestedIdField}`] = { $in: uniqueIds };

    const documents = await Model.find(query).lean();

    // Create map of nested items
    const nestedMap = new Map();
    documents.forEach(doc => {
        if (doc[nestedPath] && Array.isArray(doc[nestedPath])) {
            doc[nestedPath].forEach(nested => {
                nestedMap.set(nested[nestedIdField].toString(), nested);
            });
        }
    });

    // Attach to items
    items.forEach(item => {
        if (item[foreignKey]) {
            const key = item[foreignKey].toString();
            item[attachKey] = nestedMap.get(key) || null;
        }
    });
}

/**
 * Group items by a field value
 * @param {Array} items - Array of items
 * @param {String} field - Field to group by
 * @returns {Map} Map of field value -> array of items
 */
function groupBy(items, field) {
    const groups = new Map();

    items.forEach(item => {
        const key = item[field]?.toString() || 'null';
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(item);
    });

    return groups;
}

/**
 * Batch load with custom query
 * @param {Model} Model - Mongoose model
 * @param {Object} query - MongoDB query
 * @param {String} selectFields - Fields to select
 * @param {String} keyField - Field to use as map key (default: '_id')
 * @returns {Map} Map of key -> document
 */
async function batchLoadCustom(Model, query, selectFields = '', keyField = '_id') {
    const queryBuilder = Model.find(query).lean();

    if (selectFields) {
        queryBuilder.select(selectFields);
    }

    const documents = await queryBuilder;

    const docMap = new Map();
    documents.forEach(doc => {
        const key = doc[keyField]?.toString() || doc[keyField];
        docMap.set(key, doc);
    });

    return docMap;
}

module.exports = {
    batchLoadByIds,
    batchLoadAndAttach,
    batchLoadNested,
    groupBy,
    batchLoadCustom
};
