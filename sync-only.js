const { syncProducts } = require('./src/shopify/sync');
const fs = require('fs');
const logger = require('./src/utils/logger');

async function syncOnly() {
    logger.info('Starting Shopify Sync (from existing products.json)...');
    
    // Check if products.json exists
    if (!fs.existsSync('products.json')) {
        logger.error('products.json not found! Run "node index.js" first to scrape products.');
        process.exit(1);
    }

    // Read products from JSON
    const products = JSON.parse(fs.readFileSync('products.json', 'utf8'));
    logger.info(`Loaded ${products.length} products from products.json`);

    // Sync to Shopify
    await syncProducts(products);
    
    logger.info('Shopify Sync Completed!');
}

syncOnly();
