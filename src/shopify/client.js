require('dotenv').config();
require('@shopify/shopify-api/adapters/node');

const { shopifyApi, Session, LogSeverity } = require('@shopify/shopify-api');
const { restResources } = require('@shopify/shopify-api/rest/admin/2024-01');
const logger = require('../utils/logger');

const { SHOPIFY_SHOP_NAME, SHOPIFY_ACCESS_TOKEN } = process.env;

if (!SHOPIFY_SHOP_NAME || !SHOPIFY_ACCESS_TOKEN) {
    logger.warn('Shopify credentials missing in .env. Sync will fail.');
}

// Ensure proper myShopify domain naming
const shopName = SHOPIFY_SHOP_NAME && !SHOPIFY_SHOP_NAME.includes('.') 
    ? `${SHOPIFY_SHOP_NAME}.myshopify.com` 
    : SHOPIFY_SHOP_NAME;

const shopify = shopifyApi({
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
        level: LogSeverity.Error, // Only show errors, suppress warnings
    },
});

// Create a session for the library to use
const session = new Session({
    id: 'offline_session',
    shop: shopName,
    state: 'state',
    isOnline: false,
    accessToken: SHOPIFY_ACCESS_TOKEN,
});

shopify.session = session;

module.exports = { shopify };
