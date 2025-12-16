require('dotenv').config();
const { shopifyApi, LATEST_API_VERSION, Session } = require('@shopify/shopify-api');
const logger = require('../utils/logger');

const { SHOPIFY_SHOP_NAME, SHOPIFY_ACCESS_TOKEN } = process.env;

if (!SHOPIFY_SHOP_NAME || !SHOPIFY_ACCESS_TOKEN) {
    logger.warn('Shopify credentials missing in .env. Sync will fail.');
}

const shopify = shopifyApi({
    apiKey: 'dummy_key_for_custom_app', // Custom apps don't use API key for REST calls if using Access Token in header usually, but library might need it
    apiSecretKey: 'dummy_secret',
    apiVersion: LATEST_API_VERSION,
    isCustomStoreApp: true, // simplified configuration
    adminApiAccessToken: SHOPIFY_ACCESS_TOKEN,
    isEmbeddedApp: false,
    hostName: SHOPIFY_SHOP_NAME,
    scopes: ['write_products', 'read_products'],
});

// Create a dummy session for the library to use
const session = new Session({
    id: 'offline_session',
    shop: SHOPIFY_SHOP_NAME,
    state: 'state',
    isOnline: false,
    accessToken: SHOPIFY_ACCESS_TOKEN,
});

shopify.session = session;

module.exports = { shopify };
