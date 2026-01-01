const path = require('path');
// Polyfill crypto for Node 18+ and Shopify API
if (!global.crypto) {
    global.crypto = require('crypto');
}
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('@shopify/shopify-api/adapters/node');

const { shopifyApi, Session, LogSeverity } = require('@shopify/shopify-api');
const { restResources } = require('@shopify/shopify-api/rest/admin/2024-01');
const logger = require('../utils/logger');

if (restResources) {
    logger.info(`Loaded REST resources: ${Object.keys(restResources).length} resources`);
} else {
    logger.error('Failed to load REST resources');
}

const { SHOPIFY_SHOP_NAME, SHOPIFY_ACCESS_TOKEN } = process.env;

if (!SHOPIFY_SHOP_NAME || !SHOPIFY_ACCESS_TOKEN) {
    logger.warn('Shopify credentials missing in .env. Sync will fail.');
}

// Ensure proper myShopify domain naming
const shopName = SHOPIFY_SHOP_NAME && !SHOPIFY_SHOP_NAME.includes('.')
    ? `${SHOPIFY_SHOP_NAME}.myshopify.com`
    : (SHOPIFY_SHOP_NAME || 'test.myshopify.com'); // Fallback for no-sync mode

let shopify;
let session;

if (!SHOPIFY_SHOP_NAME || !SHOPIFY_ACCESS_TOKEN) {
    logger.warn('Shopify credentials missing. Sync will be skipped.');
    // Create a dummy shopify object that won't crash but will fail if used
    const DummyResource = class {
        constructor() { throw new Error("Shopify not configured"); }
        static async all() { throw new Error("Shopify not configured"); }
        static async count() { throw new Error("Shopify not configured"); }
        static async find() { throw new Error("Shopify not configured"); }
        async save() { throw new Error("Shopify not configured"); }
    };

    shopify = {
        session: null,
        rest: new Proxy({}, {
            get: () => DummyResource
        })
    };
    session = null;
} else {
    shopify = shopifyApi({
        apiKey: 'dummy_key_for_custom_app',
        apiSecretKey: 'dummy_secret',
        apiVersion: '2024-01',
        isCustomStoreApp: true,
        adminApiAccessToken: SHOPIFY_ACCESS_TOKEN,
        isEmbeddedApp: false,
        hostName: shopName,
        scopes: ['write_products', 'read_products'],
        restResources,
        logger: {
            level: LogSeverity.Error,
        },
    });

    // Create a session for the library to use
    session = new Session({
        id: 'offline_session',
        shop: shopName,
        state: 'state',
        isOnline: false,
        accessToken: SHOPIFY_ACCESS_TOKEN,
    });
}

shopify.session = session;

module.exports = { shopify };
