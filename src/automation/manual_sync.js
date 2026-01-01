const fs = require('fs');
const path = require('path');
const { syncProducts } = require('../shopify/sync');
const logger = require('../utils/logger');

async function main() {
    logger.info('========================================');
    logger.info('MANUAL SYNC STARTING');
    logger.info('========================================\n');

    try {
        // Read products.json
        const productsPath = path.join(__dirname, '../../products.json');
        if (!fs.existsSync(productsPath)) {
            throw new Error('products.json not found!');
        }

        const rawData = fs.readFileSync(productsPath, 'utf8');
        const products = JSON.parse(rawData);

        logger.info(`Loaded ${products.length} products from products.json`);

        if (products.length > 0) {
            // Verify description exists in first product
            if (products[0].description) {
                logger.info('✅ Descriptions detected in product data.');
            } else {
                logger.warn('⚠️  Warning: First product has no description.');
            }

            // Sync
            await syncProducts(products);
        } else {
            logger.warn('No products to sync.');
        }

    } catch (error) {
        logger.error(`Sync failed: ${error.message}`);
        console.error(error);
    }
}

main();
