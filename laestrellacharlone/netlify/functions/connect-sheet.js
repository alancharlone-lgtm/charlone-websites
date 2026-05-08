const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    try {
        const body = JSON.parse(event.body);
        const storeId = body.storeId;
        const sheetId = body.sheetId;

        if (!storeId || !sheetId) {
            return { statusCode: 400, body: JSON.stringify({ error: "Missing parameters" }) };
        }

        const store = getStore("marketplace-config");
        await store.setJSON(storeId, { SHEET_ID: sheetId });

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true })
        };
    } catch (e) {
        return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
    }
};