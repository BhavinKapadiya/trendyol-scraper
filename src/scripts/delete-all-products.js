require('dotenv').config();
const { shopify } = require('../shopify/client');
const logger = require('../utils/logger');

async function deleteAllProducts() {
    logger.info('========================================');
    logger.info('⚠️  DELETING ALL SHOPIFY PRODUCTS ⚠️');
    logger.info('========================================\n');

    let deletedCount = 0;
    let params = { limit: 250 };
    let hasNext = true;

    while (hasNext) {
        try {
            const products = await shopify.rest.Product.all({
                session: shopify.session,
                ...params,
            });

            if (products.data.length === 0) {
                hasNext = false;
                break;
            }

            logger.info(`Found ${products.data.length} products to delete...`);

            // Delete in parallel chunks of 10 for speed
            const chunks = [];
            for (let i = 0; i < products.data.length; i += 10) {
                chunks.push(products.data.slice(i, i + 10));
            }

            for (const chunk of chunks) {
                await Promise.all(chunk.map(async (p) => {
                    try {
                        await shopify.rest.Product.delete({
                            session: shopify.session,
                            id: p.id
                        });
                        deletedCount++;
                        // dots for progress
                        process.stdout.write('.');
                    } catch (err) {
                        logger.error(`Failed to delete ${p.id}: ${err.message}`);
                    }
                }));
                // Small delay to respect rate limit
                await new Promise(r => setTimeout(r, 500));
            }
            console.log(''); // New line after dots

            // Pagination currently resets because pages shift as we delete. 
            // So we just keep asking for the first page until empty?
            // Actually, cursor-based pagination might get confused if we delete items.
            // Safest strategy: Just keep calling without cursor until 0 returned.
            params = { limit: 250 };

        } catch (error) {
            logger.error(`Error deleting products: ${error.message}`);
            break;
        }
    }

    logger.info(`\n✅ Deleted ${deletedCount} total products.`);
}

deleteAllProducts();
