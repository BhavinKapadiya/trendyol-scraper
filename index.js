/**
 * TRENDYOL SCRAPER + SHOPIFY SYNC - COMPREHENSIVE SOLUTION
 * 
 * This script handles:
 * 1. Scraping products from Trendyol with full details (images, sizes, prices)
 * 2. Deduplication and validation
 * 3. Creating/updating Shopify products with ALL data
 * 4. Creating collections for each category
 * 5. Fixing images (downloads as base64 if direct URL fails)
 * 6. Updating prices for ALL variants
 * 7. Removing products with no images
 */

const { crawlCategory } = require('./src/scraper/crawler');
const { shopify } = require('./src/shopify/client');
const fs = require('fs');
const https = require('https');
const logger = require('./src/utils/logger');

// ==================== CONFIGURATION ====================

const FETCH_PRODUCT_DETAILS = true; // Always fetch full details

// Price Multiplier - reads from .env file (default is 1 if not set)
// Example: If PRICE_MULTIPLIER=3, then 100 TL becomes 300 SR
const PRICE_MULTIPLIER = parseFloat(process.env.PRICE_MULTIPLIER) || 1;


const CATEGORIES = [
    { name: 'Bluz', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20bluz&qt=trendyolmilla%20bluz&st=trendyolmilla%20bluz' },
    { name: 'Kazak', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20kazak&qt=trendyolmilla%20kazak&st=trendyolmilla%20kazak' },
    { name: 'Hırka', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20h%C4%B1rka&qt=trendyolmilla%20h%C4%B1rka&st=trendyolmilla%20h%C4%B1rka' },
    { name: 'Jeans', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20jean&qt=trendyolmilla%20jean&st=trendyolmilla%20jean' },
    { name: 'Elbise', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20elbise&qt=trendyolmilla%20elbise&st=trendyolmilla%20elbise' },
    { name: 'Pijama Takımı', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20pijama%20tak%C4%B1m%C4%B1&qt=trendyolmilla%20pijama%20tak%C4%B1m%C4%B1&st=trendyolmilla%20pijama%20tak%C4%B1m%C4%B1' },
    { name: 'Pantolon', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20pantolon&qt=trendyolmilla%20pantolon&st=trendyolmilla%20pantolon' },
    { name: 'Sweatshirt', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20sweatshirt&qt=trendyolmilla%20sweatshirt&st=trendyolmilla%20sweatshirt' },
];

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

const COLLECTIONS = [
    { title: 'Bluz', handle: 'bluz', rules: [{ column: 'type', relation: 'equals', condition: 'Bluz' }] },
    { title: 'Kazak', handle: 'kazak', rules: [{ column: 'type', relation: 'equals', condition: 'Kazak' }] },
    { title: 'Hırka', handle: 'hirka', rules: [{ column: 'type', relation: 'equals', condition: 'Hırka' }] },
    { title: 'Jeans', handle: 'jeans', rules: [{ column: 'type', relation: 'equals', condition: 'Jeans' }] },
    { title: 'Elbise', handle: 'elbise', rules: [{ column: 'type', relation: 'equals', condition: 'Elbise' }] },
    { title: 'Pijama Takımı', handle: 'pijama-takimi', rules: [{ column: 'type', relation: 'equals', condition: 'Pijama Takımı' }] },
    { title: 'Pantolon', handle: 'pantolon', rules: [{ column: 'type', relation: 'equals', condition: 'Pantolon' }] },
    { title: 'Sweatshirt', handle: 'sweatshirt', rules: [{ column: 'type', relation: 'equals', condition: 'Sweatshirt' }] },
];

// ==================== HELPER FUNCTIONS ====================

// Download image as base64 (for when Shopify can't access CDN URLs)
function downloadImageAsBase64(url) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 15000);

        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
                'Accept': 'image/*',
                'Referer': 'https://www.trendyol.com/'
            }
        }, (res) => {
            if (res.statusCode !== 200) {
                clearTimeout(timeout);
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                clearTimeout(timeout);
                const buffer = Buffer.concat(chunks);
                resolve(buffer.toString('base64'));
            });
            res.on('error', (e) => { clearTimeout(timeout); reject(e); });
        }).on('error', (e) => { clearTimeout(timeout); reject(e); });
    });
}

// Validate product data
function validateProduct(product) {
    const errors = [];

    if (!product.name) errors.push('Missing name');
    if (!product.price || product.price <= 0) errors.push('Invalid price');
    if (!product.productId) errors.push('Missing productId');

    return {
        isValid: errors.length === 0,
        errors
    };
}

// Deduplicate products by productId
function deduplicateProducts(products) {
    const seen = new Map();

    for (const product of products) {
        const key = product.productId || product.name;
        if (!seen.has(key) || product.images?.length > (seen.get(key).images?.length || 0)) {
            seen.set(key, product);
        }
    }

    return Array.from(seen.values());
}

// ==================== STEP 1: SCRAPE ====================

async function scrapeAllCategories() {
    logger.info('========================================');
    logger.info('STEP 1: SCRAPING PRODUCTS FROM TRENDYOL');
    logger.info('========================================\n');

    let allProducts = [];

    for (const category of CATEGORIES) {
        logger.info(`\n📦 Scraping: ${category.name}`);
        try {
            const products = await crawlCategory(category.url, category.name, FETCH_PRODUCT_DETAILS);
            logger.info(`   Found ${products.length} products`);
            allProducts = allProducts.concat(products);

            // Save progress after each category
            fs.writeFileSync('products.json', JSON.stringify(deduplicateProducts(allProducts), null, 2));
            logger.info(`   [Checkpoint] Saved ${allProducts.length} products so far.`);

        } catch (error) {
            logger.error(`   Failed to scrape ${category.name}: ${error.message}`);
        }
    }

    // Deduplicate
    const uniqueProducts = deduplicateProducts(allProducts);
    logger.info(`\n✅ Total scraped: ${allProducts.length}, After deduplication: ${uniqueProducts.length}`);

    // Validate
    const validProducts = [];
    for (const product of uniqueProducts) {
        const { isValid, errors } = validateProduct(product);
        if (isValid) {
            validProducts.push(product);
        } else {
            logger.warn(`Invalid product skipped: ${product.name?.substring(0, 40)}... - ${errors.join(', ')}`);
        }
    }

    logger.info(`✅ Valid products: ${validProducts.length}`);

    // Save to JSON
    fs.writeFileSync('products.json', JSON.stringify(validProducts, null, 2));
    logger.info(`💾 Saved to products.json\n`);

    return validProducts;
}

// ==================== STEP 2: CREATE COLLECTIONS ====================

async function createCollections() {
    logger.info('========================================');
    logger.info('STEP 2: CREATING SHOPIFY COLLECTIONS');
    logger.info('========================================\n');

    for (const category of COLLECTIONS) {
        try {
            // Check if exists
            const existing = await shopify.rest.SmartCollection.all({
                session: shopify.session,
                handle: category.handle,
                limit: 1
            });

            if (existing.data && existing.data.length > 0) {
                logger.info(`⏭️  ${category.title} - Already exists`);
                continue;
            }

            // Create
            const collection = new shopify.rest.SmartCollection({ session: shopify.session });
            collection.title = category.title;
            collection.handle = category.handle;
            collection.rules = category.rules;
            collection.disjunctive = false;
            collection.published = true;
            collection.sort_order = 'best-selling';

            await collection.save();
            logger.info(`✅ ${category.title} - Created`);

            await new Promise(r => setTimeout(r, 300));
        } catch (error) {
            logger.error(`❌ ${category.title} - Failed: ${error.message}`);
        }
    }

    logger.info('');
}

// ==================== STEP 3: SYNC TO SHOPIFY ====================

async function syncToShopify(products) {
    logger.info('========================================');
    logger.info('STEP 3: SYNCING PRODUCTS TO SHOPIFY');
    logger.info('========================================\n');

    // Fetch existing Shopify products
    logger.info('Fetching existing Shopify products...');
    const response = await shopify.rest.Product.all({
        session: shopify.session,
        limit: 250
    });
    logger.info(`Found ${response.data.length} existing products\n`);

    // Build lookup by title
    const shopifyByTitle = {};
    for (const p of response.data) {
        shopifyByTitle[p.title] = p;
    }

    let created = 0, updated = 0, failed = 0;

    for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const existingProduct = shopifyByTitle[product.name];

        try {
            // Prepare images (try base64 first, then URL)
            const jsonImages = product.images?.length > 0
                ? product.images
                : (product.image ? [product.image] : []);

            let shopifyImages = [];
            if (jsonImages.length > 0) {
                // Try first 4 images with base64
                for (const url of jsonImages.slice(0, 4)) {
                    try {
                        const base64 = await downloadImageAsBase64(url);
                        shopifyImages.push({ attachment: base64 });
                    } catch {
                        shopifyImages.push({ src: url });
                    }
                }
            }

            // Prepare tags
            const categoryTags = CATEGORY_TAGS[product.category] || [`category:${product.category?.toLowerCase()}`];
            const allTags = [...categoryTags, 'trendyol', 'auto-imported'].join(', ');

            // Prepare variants
            const color = product.color || 'Default';
            const variants = (product.sizes && product.sizes.length > 0)
                ? product.sizes.map(size => ({
                    option1: size.name,
                    option2: color,
                    price: (product.price * PRICE_MULTIPLIER).toFixed(2),
                    sku: size.barcode || `${product.sku}-${size.name}`,
                    inventory_management: 'shopify',
                    inventory_policy: size.inStock ? 'continue' : 'deny',
                    inventory_quantity: size.inStock ? 10 : 0
                }))
                : [{
                    option1: 'Default Title',
                    price: (product.price * PRICE_MULTIPLIER).toFixed(2),
                    sku: product.sku,
                    inventory_management: 'shopify',
                    inventory_quantity: 10
                }];

            if (existingProduct) {
                // UPDATE existing product
                logger.info(`[${i + 1}/${products.length}] UPDATING: ${product.name.substring(0, 50)}...`);

                const productToUpdate = new shopify.rest.Product({ session: shopify.session });
                productToUpdate.id = existingProduct.id;
                productToUpdate.title = product.name;
                productToUpdate.body_html = `Category: ${product.category}<br>Brand: ${product.brand || 'Trendyol'}`;
                productToUpdate.vendor = product.brand || "TRENDYOLMİLLA";
                productToUpdate.product_type = product.category;
                productToUpdate.tags = allTags;

                // Update images if we have more than Shopify
                const existingImageCount = existingProduct.images?.length || 0;
                if (shopifyImages.length > existingImageCount) {
                    productToUpdate.images = shopifyImages;
                }

                // Update ALL variant prices
                if (existingProduct.variants && existingProduct.variants.length > 0) {
                    productToUpdate.variants = existingProduct.variants.map(v => ({
                        id: v.id,
                        price: (product.price * PRICE_MULTIPLIER).toFixed(2)
                    }));
                }

                await productToUpdate.save({ update: true });
                updated++;

            } else {
                // CREATE new product
                logger.info(`[${i + 1}/${products.length}] CREATING: ${product.name.substring(0, 50)}...`);

                const handle = `trendyol-${product.productId}`;

                const newProduct = new shopify.rest.Product({ session: shopify.session });
                newProduct.title = product.name;
                newProduct.body_html = `Category: ${product.category}<br>Brand: ${product.brand || 'Trendyol'}`;
                newProduct.vendor = product.brand || "TRENDYOLMİLLA";
                newProduct.product_type = product.category;
                newProduct.handle = handle;
                newProduct.tags = allTags;
                newProduct.images = shopifyImages;
                newProduct.variants = variants;

                if (product.sizes && product.sizes.length > 0) {
                    newProduct.options = [{ name: "Size" }, { name: "Color" }];
                }

                await newProduct.save({ update: true });
                created++;
            }

            // Rate limit
            await new Promise(r => setTimeout(r, 500));

        } catch (error) {
            logger.error(`[${i + 1}/${products.length}] FAILED: ${error.message}`);
            failed++;
        }
    }

    logger.info(`\n✅ Created: ${created}, Updated: ${updated}, Failed: ${failed}\n`);
}

// ==================== STEP 4: CLEANUP (Remove products with 0 images) ====================

async function cleanupNoImageProducts() {
    logger.info('========================================');
    logger.info('STEP 4: CLEANUP - REMOVING 0-IMAGE PRODUCTS');
    logger.info('========================================\n');

    const response = await shopify.rest.Product.all({
        session: shopify.session,
        limit: 250
    });

    const noImageProducts = response.data.filter(p => !p.images || p.images.length === 0);
    logger.info(`Found ${noImageProducts.length} products with no images`);

    let deleted = 0;
    for (const product of noImageProducts) {
        try {
            await shopify.rest.Product.delete({
                session: shopify.session,
                id: product.id
            });
            logger.info(`🗑️  Deleted: ${product.title.substring(0, 50)}...`);
            deleted++;
            await new Promise(r => setTimeout(r, 200));
        } catch (error) {
            logger.error(`Failed to delete: ${error.message}`);
        }
    }

    logger.info(`\n✅ Deleted ${deleted} products with no images\n`);
}

// ==================== MAIN ====================

async function main() {
    const startTime = Date.now();

    logger.info('\n🚀 TRENDYOL SCRAPER + SHOPIFY SYNC - STARTING\n');
    logger.info(`Started at: ${new Date().toISOString()}`);
    logger.info(`💰 Price Multiplier: ${PRICE_MULTIPLIER}x (set in .env file)\n`);

    try {
        // Step 1: Scrape
        const products = await scrapeAllCategories();

        // Step 2: Create collections
        await createCollections();

        // Step 3: Sync to Shopify
        await syncToShopify(products);

        // Step 4: Cleanup
        await cleanupNoImageProducts();

        const duration = Math.round((Date.now() - startTime) / 1000 / 60);
        logger.info('========================================');
        logger.info('🎉 ALL DONE!');
        logger.info(`Total time: ${duration} minutes`);
        logger.info('========================================\n');

    } catch (error) {
        logger.error(`\n❌ FATAL ERROR: ${error.message}`);
        logger.error(error.stack);
    }
}

main();