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
            // Create unique handle
            const handle = `trendyol-${product.productId || product.sku || Math.floor(Math.random() * 1000000)}`;

            // Check if product already exists (from pre-fetch or individual lookup)
            let existingProduct = productLookup[handle];

            // If not found in pre-fetch, try individual lookup
            if (!existingProduct) {
                existingProduct = await findProductByHandle(handle);
                if (existingProduct) {
                    productLookup[handle] = existingProduct; // Cache for future
                }
            }

            // Prepare tags from category
            const categoryTags = CATEGORY_TAGS[product.category] || [`category:${product.category.toLowerCase()}`];
            const allTags = [...categoryTags, 'trendyol', 'auto-imported'].join(', ');

            // Prepare extra fields
            const color = product.color || 'Default';
            const variants = (product.sizes && product.sizes.length > 0)
                ? product.sizes.map(size => ({
                    option1: size.name,
                    option2: color,
                    price: product.price.toString(),
                    sku: size.barcode || `${product.sku}-${size.name}`,
                    inventory_management: 'shopify',
                    inventory_policy: size.inStock ? 'continue' : 'deny',
                    inventory_quantity: size.inStock ? (product.stockCount || 10) : 0
                }))
                : [{
                    option1: 'Default Title',
                    price: product.price.toString(),
                    sku: product.sku,
                    inventory_management: 'shopify',
                    inventory_quantity: product.stockCount || 10
                }];

            if (existingProduct) {
                // UPDATE existing product - update ALL fields to match scraped data
                logger.info(`[${i + 1}/${scrapedProducts.length}] Updating: ${product.name.substring(0, 50)}...`);

                const productToUpdate = new shopify.rest.Product({ session: shopify.session });
                productToUpdate.id = existingProduct.id;

                // Update all fields
                productToUpdate.title = product.name;
                productToUpdate.body_html = (product.description || '') + `<br><br>Category: ${product.category}<br>Brand: ${product.brand || 'Trendyol'}`;
                productToUpdate.vendor = product.brand || "TRENDYOLMİLLA";
                productToUpdate.product_type = product.category; // THIS IS THE TYPE/CATEGORY FIELD
                productToUpdate.tags = allTags;

                // Update images
                if (product.images && product.images.length > 0) {
                    productToUpdate.images = product.images.map(url => ({ src: url }));
                }

                // Update first variant price (variant management is complex, so just update price)
                if (existingProduct.variants && existingProduct.variants.length > 0) {
                    productToUpdate.variants = [{
                        id: existingProduct.variants[0].id,
                        price: product.price.toString()
                    }];
                }

                await productToUpdate.save({ update: true });
                updated++;

            } else {
                // CREATE new product
                logger.info(`[${i + 1}/${scrapedProducts.length}] Creating: ${product.name.substring(0, 50)}...`);

                const newProduct = new shopify.rest.Product({ session: shopify.session });

                newProduct.title = product.name;
                newProduct.body_html = (product.description || '') + `<br><br>Category: ${product.category}<br>Brand: ${product.brand || 'Trendyol'}`;
                newProduct.vendor = product.brand || "TRENDYOLMİLLA";
                newProduct.product_type = product.category;
                newProduct.handle = handle;
                newProduct.tags = allTags;
                newProduct.images = product.images && product.images.length > 0
                    ? product.images.map(url => ({ src: url }))
                    : (product.image ? [{ src: product.image }] : []);
                newProduct.variants = variants;

                if (product.sizes && product.sizes.length > 0) {
                    newProduct.options = [
                        { name: "Size" },
                        { name: "Color" }
                    ];
                }

                await newProduct.save({ update: true });

                // Add to lookup to prevent duplicates within same batch
                productLookup[handle] = { handle, id: 'new' };
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