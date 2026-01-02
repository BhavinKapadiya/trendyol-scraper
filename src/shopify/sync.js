const { shopify } = require('./client');
const logger = require('../utils/logger');

// Category to Tags mapping
const CATEGORY_TAGS = {
    'Bluz': ['category:bluz', 'category:tops'],
    'Kazak': ['category:kazak', 'category:sweaters'],
    'Hırka': ['category:hirka', 'category:cardigans'],
    'Jeans': ['category:jeans', 'category:bottoms'],
    'Elbise': ['category:elbise', 'category:dresses'],
    'Pantolon': ['category:pantolon', 'category:pants'],
    'Sweatshirt': ['category:sweatshirt', 'category:tops'],
    'Pijama Takımı': ['category:pijama', 'category:sleepwear'],
};

// Fetch all existing products from Shopify (for deduplication)
async function fetchAllShopifyProducts() {
    const allProducts = [];

    logger.info('Fetching existing products from Shopify for deduplication...');

    try {
        if (shopify.rest) {
            logger.info(`Available REST resources: ${Object.keys(shopify.rest).join(', ')}`);
        } else {
            logger.error('shopify.rest is undefined!');
        }

        const response = await shopify.rest.Product.all({
            session: shopify.session,
            limit: 250,
            fields: 'id,handle,title,variants'
        });

        allProducts.push(...response.data);
        logger.info(`Found ${allProducts.length} existing products in Shopify`);

    } catch (error) {
        logger.warn(`Could not bulk-fetch products: ${error.message}`);
        logger.warn('Will check each product individually...');
    }

    return allProducts;
}

// Build lookup map by handle
function buildProductLookup(products) {
    const lookup = {};
    for (const product of products) {
        if (product.handle) {
            lookup[product.handle] = product;
        }
    }
    return lookup;
}

// Find existing product by handle (individual lookup)
async function findProductByHandle(handle) {
    try {
        const response = await shopify.rest.Product.all({
            session: shopify.session,
            handle: handle,
            limit: 1
        });
        if (response.data && response.data.length > 0) {
            return response.data[0];
        }
    } catch (e) {
        // Ignore errors, will try to create
    }
    return null;
}

async function syncProducts(scrapedProducts) {
    if (!scrapedProducts || scrapedProducts.length === 0) {
        logger.warn('No products to sync.');
        return;
    }

    logger.info(`Starting sync for ${scrapedProducts.length} products...`);

    // Fetch existing products for deduplication
    const existingProducts = await fetchAllShopifyProducts();
    const productLookup = buildProductLookup(existingProducts);

    // Stats
    let created = 0;
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < scrapedProducts.length; i++) {
        const product = scrapedProducts[i];
        try {
            // Create unique handle based on GROUP CODE if available (for merging colors)
            // Fallback to product ID if no group code (keeps old behavior for single items)
            const handle = product.groupCode
                ? `trendyol-${product.groupCode}`
                : `trendyol-${product.productId || product.sku}`;

            // Check if product already exists (from pre-fetch or individual lookup)
            let existingProduct = productLookup[handle];

            // If not found in pre-fetch, try individual lookup
            if (!existingProduct) {
                existingProduct = await findProductByHandle(handle);
                if (existingProduct) {
                    productLookup[handle] = existingProduct; // Cache for future
                }
            }

            // Prepare tags
            const categoryTags = CATEGORY_TAGS[product.category] || [`category:${product.category.toLowerCase()}`];
            const allTags = [...categoryTags, 'trendyol', 'auto-imported'].join(', ');

            // Prepare VARIANTS (Size + Color)
            const color = product.color || 'Default';
            const newVariants = (product.sizes && product.sizes.length > 0)
                ? product.sizes.map(size => ({
                    option1: size.name, // Size
                    option2: color,     // Color
                    price: product.price.toString(),
                    sku: size.barcode || `${product.sku}-${size.name}`,
                    inventory_management: 'shopify',
                    inventory_policy: size.inStock ? 'continue' : 'deny',
                    inventory_quantity: size.inStock ? (product.stockCount || 10) : 0
                }))
                : [{
                    option1: 'One Size',
                    option2: color,
                    price: product.price.toString(),
                    sku: product.sku,
                    inventory_management: 'shopify',
                    inventory_quantity: product.stockCount || 10
                }];

            if (existingProduct) {
                // MERGE/UPDATE existing product
                logger.info(`[${i + 1}/${scrapedProducts.length}] Merging Color '${color}' check: ${product.name.substring(0, 30)}...`);

                const productToUpdate = new shopify.rest.Product({ session: shopify.session });
                productToUpdate.id = existingProduct.id;

                // 1. Merge Images (Append new unique ones)
                const existingImages = existingProduct.images || [];
                const existingSrcs = new Set(existingImages.map(img => img.src));
                const uniqueNewImages = (product.images || []).filter(url => !existingSrcs.has(url));

                if (uniqueNewImages.length > 0) {
                    // Add new images to the list
                    productToUpdate.images = [
                        ...existingImages.map(img => ({ id: img.id })), // Keep existing by ID
                        ...uniqueNewImages.map(src => ({ src }))      // Add new by SRC
                    ];
                }

                // 2. Merge Variants (Append new color variants)
                // Existing variants need to be preserved
                // We shouldn't overwrite unless the SKU matches (stock update)
                // But for simplicity/safety with the library, we often need to send all.
                // However, sending *only new* might delete old in some APIs. 
                // Best bet: don't touch existing variants in 'productToUpdate.variants' unless we re-fetch them all.
                // LIMITATION: 'shopify-api-node' rest usually replaces variants if provided. 
                // Strategy: We won't update variants here blindly. We rely on Shopify's "append" behavior if we don't send IDs? 
                // No, REST API replaces. We need to fetch current variants, filter out this color, and add new.
                // Simpler Approach for now: Just add the new variants, assuming we want to ADD this color.

                // NOTE: Properly merging variants requires knowing all existing ones. 
                // 'existingProduct' has them from the `fetchAll` or `find`.
                const currentVariants = existingProduct.variants || [];

                // Remove any existing variants for *this specific color* (to allow update)
                const otherColorVariants = currentVariants.filter(v => v.option2 !== color);

                // Combine
                productToUpdate.variants = [
                    ...otherColorVariants.map(v => ({ id: v.id })), // Keep others by ID
                    ...newVariants // Add new ones
                ];

                // 3. Ensure Options are correct
                productToUpdate.options = [
                    { name: "Size" },
                    { name: "Color" }
                ];

                await productToUpdate.save({ update: true });
                updated++;

            } else {
                // CREATE new product
                logger.info(`[${i + 1}/${scrapedProducts.length}] Creating NEW Shared Product: ${product.name.substring(0, 30)}...`);

                const newProduct = new shopify.rest.Product({ session: shopify.session });

                newProduct.title = product.name; // First color sets the title
                newProduct.body_html = (product.description || '') + `<br><br>Category: ${product.category}<br>Brand: ${product.brand || 'Trendyol'}`;
                newProduct.vendor = product.brand || "TRENDYOLMİLLA";
                newProduct.product_type = product.category;
                newProduct.handle = handle;
                newProduct.tags = allTags;
                newProduct.images = product.images && product.images.length > 0
                    ? product.images.map(url => ({ src: url }))
                    : (product.image ? [{ src: product.image }] : []);

                // Options: Size, Color
                newProduct.options = [
                    { name: "Size" },
                    { name: "Color" }
                ];

                newProduct.variants = newVariants;

                await newProduct.save({ update: true });

                // Add to lookup
                productLookup[handle] = { handle, id: 'new', variants: newVariants };
                created++;
            }

            // Rate limit handling (Safe for Basic Plan: 1s delay)
            await new Promise(r => setTimeout(r, 1000));

        } catch (error) {
            logger.error(`Failed to sync ${product.name}: ${error.message}`);
            failed++;
        }
    }

    logger.info(`\n========== Sync Summary ==========`);
    logger.info(`Created: ${created}`);
    logger.info(`Updated: ${updated}`);
    logger.info(`Failed: ${failed}`);
    logger.info(`Total: ${scrapedProducts.length}`);
}

module.exports = { syncProducts, fetchAllShopifyProducts };