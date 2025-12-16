const { shopify } = require('./client');
const logger = require('../utils/logger');

async function syncProducts(scrapedProducts) {
    if (!scrapedProducts || scrapedProducts.length === 0) {
        logger.warn('No products to sync.');
        return;
    }

    logger.info(`Starting sync for ${scrapedProducts.length} products...`);

    // Create a session? No, we use the client directly usually or REST resource.
    // Using Admin API usually requires a session or direct REST client.
    // We'll assume custom app access token which uses specific header or client config.

    for (const product of scrapedProducts) {
        try {
            // Check if product exists (by handle or title)
            // Note: This is an expensive operation loop. In production, we'd fetch all products first or use GraphQL.
            // We'll search by title for simplicity in this MVP.

            const searchResponse = await shopify.rest.Product.all({
                session: shopify.session,
                title: product.productName,
                limit: 1
            });

            const existingProduct = searchResponse.data[0];

            if (existingProduct) {
                // Update
                logger.info(`Updating product: ${product.productName}`);
                const updateData = {
                    id: existingProduct.id,
                    variants: [{
                        id: existingProduct.variants[0].id,
                        price: product.price.toString()
                    }],
                    // images: [{ src: product.imageUrl }] // Updating images can be tricky, appending vs replacing
                };
                await new shopify.rest.Product({ session: shopify.session }).save(updateData);
            } else {
                // Create
                logger.info(`Creating product: ${product.productName}`);
                const newProduct = new shopify.rest.Product({ session: shopify.session });
                newProduct.title = product.productName;
                newProduct.body_html = `Category: ${product.category}`;
                newProduct.vendor = "Trendyol Milla";
                newProduct.product_type = product.category;
                newProduct.variants = [{
                    price: product.price.toString(),
                    inventory_management: null // unlimited
                }];
                newProduct.images = [{ src: product.imageUrl }];

                await newProduct.save({
                    update: true,
                });
            }
        } catch (error) {
            logger.error(`Failed to sync product ${product.productName}: ${error.message}`);
        }
    }
}

module.exports = { syncProducts };
