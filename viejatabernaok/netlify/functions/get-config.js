const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
    const storeId = event.queryStringParameters.storeId;
    if (!storeId) return { statusCode: 400, body: JSON.stringify({ error: "Missing storeId" }) };

    try {
        const store = getStore("marketplace-config");
        const config = await store.getJSON(storeId);
        
        if (!config) {
            return { statusCode: 404, body: JSON.stringify({ error: "Config not found" }) };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(config)
        };
    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};