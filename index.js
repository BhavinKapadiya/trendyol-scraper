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

const fs = require('fs');
const https = require('https');
const logger = require('./src/utils/logger');

// Polyfill for Node 18+ compatibility (Must be first)
if (!global.crypto) {
    global.crypto = require('crypto');
}
if (!global.File) {
    try {
        const { File } = require('node:buffer');
        global.File = File || class File {
            constructor(parts, filename, properties) {
                this.parts = parts;
                this.name = filename;
                this.type = properties?.type || '';
                this.lastModified = properties?.lastModified || Date.now();
            }
        };
    } catch (e) {
        global.File = class File {
            constructor(parts, filename, properties) {
                this.parts = parts;
                this.name = filename;
                this.type = properties?.type || '';
                this.lastModified = properties?.lastModified || Date.now();
            }
        };
    }
}

const { crawlCategory } = require('./src/scraper/crawler');
const { shopify } = require('./src/shopify/client');

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

    // Limit per category and batch size for variant discovery
    const LIMIT_PER_CATEGORY = 400; // 400 products per category for production
    const BATCH_SIZE = 10; // Process 10 products at a time, then queue variants

    for (const category of CATEGORIES) {
        logger.info(`\n📦 Scraping: ${category.name}`);
        try {
            const products = await crawlCategory(category.url, category.name, FETCH_PRODUCT_DETAILS, LIMIT_PER_CATEGORY, BATCH_SIZE);
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

// Group products by Model Code to merge variants
function groupVariants(products) {
    const groups = new Map();

    for (const p of products) {
        // Use groupCode (Model Code) or fallback to specific productId
        const key = p.groupCode || p.productId || p.name;
        
        if (!groups.has(key)) {
            groups.set(key, {
                ...p, // Base info from first variant
                _variants: [], // Store all merged variants here
                _imagesByColor: new Map(), // ⭐ NEW: Store images by color
                _colors: new Set()
            });
        }

        const group = groups.get(key);
        
        // Add images BY COLOR (not all merged together)
        const color = p.color || p.extractedColor || 'Default';
        
        if (p.images && p.images.length > 0) {
            if (!group._imagesByColor.has(color)) {
                group._imagesByColor.set(color, []);
            }
            // Add images for this specific color
            p.images.forEach(img => {
                const colorImages = group._imagesByColor.get(color);
                if (!colorImages.includes(img)) {
                    colorImages.push(img);
                }
            });
        }

        // Add this specific color variant
        group._colors.add(color);

        // Process sizes for this color
        if (p.sizes && p.sizes.length > 0) {
            p.sizes.forEach(size => {
                group._variants.push({
                    color: color,  // ⭐ Color is now first
                    size: size.name,
                    price: size.price || p.price,
                    sku: size.barcode || `${p.sku}-${size.name}-${color}`,
                    inStock: size.inStock,
                    image: p.image // Link to the main image of this specific color variant
                });
            });
        } else {
            // Single variant product (no sizes)
            group._variants.push({
                color: color,  // ⭐ Color is now first
                size: 'One Size',
                price: p.price,
                sku: p.sku || `${p.productId}-${color}`,
                inStock: true,
                image: p.image
            });
        }
    }

    return Array.from(groups.values());
}


// ==================== STEP 3: SYNC TO SHOPIFY ====================

async function syncToShopify(products) {
    logger.info('========================================');
    logger.info('STEP 3: SYNCING PRODUCTS TO SHOPIFY');
    logger.info('========================================\n');

    // Group variants first
    logger.info(`Grouping ${products.length} scraped items by Model Code...`);
    const groupedProducts = groupVariants(products);
    logger.info(`ℹ️  Merged into ${groupedProducts.length} unique Shopify products.`);


    // Fetch ALL existing Shopify products (Pagination)
    logger.info('Fetching ALL existing Shopify products to check for duplicates...');
    let allShopifyProducts = [];
    let params = { limit: 250 };

    do {
        const response = await shopify.rest.Product.all({
            session: shopify.session,
            ...params,
        });

        allShopifyProducts = allShopifyProducts.concat(response.data);
        params = response.page_info ? response.page_info.nextPage : null;
        logger.info(`   Fetched ${allShopifyProducts.length} products so far...`);

    } while (params);

    logger.info(`✅ Found ${allShopifyProducts.length} total existing products\n`);

    // Build lookup by HANDLE (more stable than title for groups)
    const shopifyByHandle = {};
    for (const p of allShopifyProducts) {
        shopifyByHandle[p.handle] = p;
    }

    let created = 0, updated = 0, failed = 0;

    for (let i = 0; i < groupedProducts.length; i++) {
        const product = groupedProducts[i];
        // Generate handle from Group Code
        const handle = `trendyol-${String(product.groupCode || product.productId).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const existingProduct = shopifyByHandle[handle] || allShopifyProducts.find(p => p.title === product.name);

        try {
            // ⭐ PHASE 2: Collect ALL images from ALL colors
            const allImageUrls = [];
            const imageUrlToColor = new Map(); // Track which color each image belongs to
            
            for (const [color, images] of product._imagesByColor) {
                images.forEach(url => {
                    if (!allImageUrls.includes(url)) {
                        allImageUrls.push(url);
                        imageUrlToColor.set(url, color);
                    }
                });
            }
            
            // Limit to 20 images max to avoid timeouts
            const uniqueImages = allImageUrls.slice(0, 20);
            
            let shopifyImages = [];
            if (uniqueImages.length > 0) {
                // Download and upload ALL images
                for (const url of uniqueImages) {
                    let attempts = 0;
                    const maxRetries = 3;
                    let success = false;

                    while (attempts < maxRetries && !success) {
                        try {
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 10000);

                            const imageRes = await fetch(url, {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                    'Referer': 'https://www.trendyol.com/'
                                },
                                signal: controller.signal
                            });
                            clearTimeout(timeoutId);

                            if (imageRes.ok) {
                                const arrayBuffer = await imageRes.arrayBuffer();
                                const base64 = Buffer.from(arrayBuffer).toString('base64');
                                shopifyImages.push({ 
                                    attachment: base64,
                                    _sourceUrl: url  // Track original URL for variant mapping
                                });
                                success = true;
                            } else {
                                throw new Error(`Status ${imageRes.status}`);
                            }
                        } catch (err) {
                            attempts++;
                            if (attempts === maxRetries) {
                                logger.error(`   [Image Fail] ${url} failed.`);
                                // Push URL as fallback
                                shopifyImages.push({ 
                                    src: url,
                                    _sourceUrl: url
                                });
                            } else {
                                await new Promise(r => setTimeout(r, 1000));
                            }
                        }
                    }
                }
            }

            // Prepare tags
            const categoryTags = CATEGORY_TAGS[product.category] || [`category:${product.category?.toLowerCase()}`];
            const allTags = [...categoryTags, 'trendyol', 'auto-imported'].join(', ');

            // Prepare variants (Shopify Format)
            // ⭐ Options: [Color, Size] - Color is now primary!
            const shopifyVariants = product._variants.map(v => ({
                option1: v.color,  // ⭐ SWAPPED: Color first
                option2: v.size,   // ⭐ SWAPPED: Size second
                price: (v.price * PRICE_MULTIPLIER).toFixed(2),
                sku: v.sku,
                inventory_management: 'shopify',
                inventory_policy: v.inStock ? 'continue' : 'deny',
                inventory_quantity: v.inStock ? 50 : 0
            }));

            if (existingProduct) {
                // UPDATE existing product
                logger.info(`[${i + 1}/${groupedProducts.length}] UPDATING: ${product.name.substring(0, 50)}... (${product._colors.size} colors)`);

                const productToUpdate = new shopify.rest.Product({ session: shopify.session });
                productToUpdate.id = existingProduct.id;
                productToUpdate.title = product.name;
                productToUpdate.body_html = product.description || `Category: ${product.category}<br>Brand: ${product.brand || 'Trendyol'}`;
                productToUpdate.vendor = product.brand || "TRENDYOLMİLLA";
                productToUpdate.product_type = product.category;
                productToUpdate.tags = allTags;

                // Update images only if we have significantly more (saving bandwidth)
                if (shopifyImages.length > (existingProduct.images?.length || 0)) {
                   productToUpdate.images = shopifyImages;
                }

                // Force update variants
                // Note: Updating variants on existing product is tricky, usually better to replace but that loses history
                // For now, we just update main info. Full variant sync requires deleting/recreating or complex logic.
                // logger.warn('   Skipping variant update for existing product to avoid data loss. Delete product to re-sync variants.');

                await productToUpdate.save({ update: true });
                updated++;

            } else {
                // CREATE new product
                logger.info(`[${i + 1}/${groupedProducts.length}] CREATING: ${product.name.substring(0, 50)}... (${product._colors.size} colors)`);

                const newProduct = new shopify.rest.Product({ session: shopify.session });
                newProduct.title = product.name;
                newProduct.body_html = product.description || `Category: ${product.category}<br>Brand: ${product.brand || 'Trendyol'}`;
                newProduct.vendor = product.brand || "TRENDYOLMİLLA";
                newProduct.product_type = product.category;
                newProduct.handle = handle;
                newProduct.tags = allTags;
                newProduct.images = shopifyImages;
                newProduct.variants = shopifyVariants;
                
                // ⭐ Define Options - Color is now PRIMARY!
                newProduct.options = [{ name: "Color" }, { name: "Size" }];

                // Save product first (this uploads images and assigns IDs)
                await newProduct.save({ update: true });
                
                // ⭐ PHASE 2: Now assign image_id to each variant based on its color
                // Fetch the created product back to get image IDs
                const createdProduct = await shopify.rest.Product.find({
                    session: shopify.session,
                    id: newProduct.id
                });
                
                // Create mapping: sourceUrl → Shopify image ID
                const urlToImageId = new Map();
                if (createdProduct.images && createdProduct.images.length > 0) {
                    createdProduct.images.forEach((img, index) => {
                        // Match by position since we can't store custom data
                        const sourceUrl = shopifyImages[index]?._sourceUrl;
                        if (sourceUrl && img.id) {
                            urlToImageId.set(sourceUrl, img.id);
                        }
                    });
                }
                
                // Update each variant with its color-specific image
                if (createdProduct.variants && createdProduct.variants.length > 0) {
                    for (const variant of createdProduct.variants) {
                        try {
                            const variantColor = variant.option1; // Color is option1 now!
                            
                            // Get images for this color
                            const colorImages = product._imagesByColor.get(variantColor);
                            if (colorImages && colorImages.length > 0) {
                                // Assign first image of this color to the variant
                                const firstImageUrl = colorImages[0];
                                const imageId = urlToImageId.get(firstImageUrl);
                                
                                if (imageId) {
                                    // Update variant with image_id
                                    const variantToUpdate = new shopify.rest.Variant({ session: shopify.session });
                                    variantToUpdate.id = variant.id;
                                    variantToUpdate.image_id = imageId;
                                    await variantToUpdate.save({ update: true });
                   logger.info(`      ✓ Assigned image to ${variantColor} variant`);
                                } else {
                                    logger.warn(`      ⚠ No imageId found for ${variantColor} (URL: ${firstImageUrl})`);
                                }
                            } else {
                                logger.warn(`      ⚠ No images found for color: ${variantColor}`);
                            }
                            
                            // Small delay to avoid rate limiting
                            await new Promise(r => setTimeout(r, 500));
                        } catch (variantError) {
                            logger.error(`      Failed to assign image to variant ${variant.option1}: ${variantError.message}`);
                        }
                    }
                }
                
                created++;
            }

            // Rate limit
            await new Promise(r => setTimeout(r, 2000));

        } catch (error) {
            logger.error(`[${i + 1}/${groupedProducts.length}] FAILED: ${error.message}`);
            // Log detail
             if (error.response && error.response.body) {
                logger.error(JSON.stringify(error.response.body));
             }
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
        let products = [];

        // Check for manual sync flag
        if (process.argv.includes('--sync-only')) {
            logger.info('🔄 MANUAL SYNC MODE DETECTED');

            // Prefer clean file if it exists
            if (fs.existsSync('products_clean.json')) {
                logger.info('   Loading from CLEAN file (products_clean.json)...');
                const rawData = fs.readFileSync('products_clean.json', 'utf8');
                products = JSON.parse(rawData);
            } else if (fs.existsSync('products.json')) {
                logger.info('   Loading from RAW file (products.json)...');
                const rawData = fs.readFileSync('products.json', 'utf8');
                products = JSON.parse(rawData);
            } else {
                throw new Error('No products file found! Cannot sync.');
            }
            logger.info(`   Loaded ${products.length} products to sync.`);
        } else {
            // Step 1: Normal Scrape
            products = await scrapeAllCategories();
        }

        // Step 2: Create collections
        await createCollections();

        // Step 3: Sync to Shopify
        await syncToShopify(products);

        // Step 4: Cleanup
        // DISABLED FOR DEBUGGING: Prevent deletion of products if image upload fails
        // await cleanupNoImageProducts();

        const duration = Math.round((Date.now() - startTime) / 1000 / 60);
        logger.info('========================================');
        logger.info('🎉 ALL DONE!');
        logger.info(`Total time: ${duration} minutes`);

        // REST PERIOD: Wait 1 hour before letting PM2 restart the process
        // This prevents server overload and API spam
        const REST_MINUTES = 60;
        logger.info(`\n😴 Resting for ${REST_MINUTES} minutes before next run...`);
        logger.info('========================================\n');

        await new Promise(r => setTimeout(r, REST_MINUTES * 60 * 1000));

    } catch (error) {
        logger.error(`\n❌ FATAL ERROR: ${error.message}`);
        logger.error(error.stack);
    }
}

main();