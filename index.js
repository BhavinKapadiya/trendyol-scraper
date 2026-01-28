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
    // { name: 'Kazak', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20kazak&qt=trendyolmilla%20kazak&st=trendyolmilla%20kazak' },
    // { name: 'Hırka', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20h%C4%B1rka&qt=trendyolmilla%20h%C4%B1rka&st=trendyolmilla%20h%C4%B1rka' },
    // { name: 'Jeans', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20jean&qt=trendyolmilla%20jean&st=trendyolmilla%20jean' },
    // { name: 'Elbise', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20elbise&qt=trendyolmilla%20elbise&st=trendyolmilla%20elbise' },
    // { name: 'Pijama Takımı', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20pijama%20tak%C4%B1m%C4%B1&qt=trendyolmilla%20pijama%20tak%C4%B1m%C4%B1&st=trendyolmilla%20pijama%20tak%C4%B1m%C4%B1' },
    // { name: 'Pantolon', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20pantolon&qt=trendyolmilla%20pantolon&st=trendyolmilla%20pantolon' },
    // { name: 'Sweatshirt', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20sweatshirt&qt=trendyolmilla%20sweatshirt&st=trendyolmilla%20sweatshirt' },
];

const CATEGORY_TAGS = {
    'Bluz': ['category:bluz', 'category:tops'],
    // 'Kazak': ['category:kazak', 'category:sweaters'],
    // 'Hırka': ['category:hirka', 'category:cardigans'],
    // 'Jeans': ['category:jeans', 'category:bottoms'],
    // 'Elbise': ['category:elbise', 'category:dresses'],
    // 'Pantolon': ['category:pantolon', 'category:pants'],
    // 'Sweatshirt': ['category:sweatshirt', 'category:tops'],
    // 'Pijama Takımı': ['category:pijama', 'category:sleepwear'],
};

const COLLECTIONS = [
    { title: 'Bluz', handle: 'bluz', rules: [{ column: 'type', relation: 'equals', condition: 'Bluz' }] },
    // { title: 'Kazak', handle: 'kazak', rules: [{ column: 'type', relation: 'equals', condition: 'Kazak' }] },
    // { title: 'Hırka', handle: 'hirka', rules: [{ column: 'type', relation: 'equals', condition: 'Hırka' }] },
    // { title: 'Jeans', handle: 'jeans', rules: [{ column: 'type', relation: 'equals', condition: 'Jeans' }] },
    // { title: 'Elbise', handle: 'elbise', rules: [{ column: 'type', relation: 'equals', condition: 'Elbise' }] },
    // { title: 'Pijama Takımı', handle: 'pijama-takimi', rules: [{ column: 'type', relation: 'equals', condition: 'Pijama Takımı' }] },
    // { title: 'Pantolon', handle: 'pantolon', rules: [{ column: 'type', relation: 'equals', condition: 'Pantolon' }] },
    // { title: 'Sweatshirt', handle: 'sweatshirt', rules: [{ column: 'type', relation: 'equals', condition: 'Sweatshirt' }] },
];

// ==================== HELPER FUNCTIONS ====================

// Download image as base64 (for when Shopify can't access CDN URLs)
function downloadImageAsBase64(url) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 30000); // Increased to 30s

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

    // Limit per category (approx 300 products)
    const LIMIT_PER_CATEGORY = 800;

    for (const category of CATEGORIES) {
        logger.info(`\n📦 Scraping: ${category.name}`);
        try {
            const products = await crawlCategory(category.url, category.name, FETCH_PRODUCT_DETAILS, LIMIT_PER_CATEGORY);
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

// ==================== STEP 3: SYNC TO SHOPIFY (SPLIT PRODUCTS STRATEGY) ====================

const Deduplicator = require('./src/shopify/deduplicator');

async function syncToShopify(products) {
    logger.info('========================================');
    logger.info('STEP 3: SYNCING PRODUCTS TO SHOPIFY (STRICT DEDUPLICATION MODE)');
    logger.info('========================================\n');

    const dedupe = new Deduplicator();

    // 1. Group Products by Connectivity (The Fix for Missing GroupCode)
    // We strictly need to know which other products belong to the same "Style" to generate links.
    const productsByModel = new Map();

    for (const product of products) {
        // LOGIC: Use the sorted list of ALL related Product IDs to form a unique Group Key.
        // This ensures Product A and Product B land in the same bucket if they are related.
        const allIds = [String(product.productId)];
        if (product.colorVariants) {
            product.colorVariants.forEach(v => {
                if (v.sku) allIds.push(String(v.sku));
            });
        }
        // Dedupe and Sort
        const uniqueIds = [...new Set(allIds)].sort();
        const groupKey = `GROUP-${uniqueIds.join('-')}`;

        if (!productsByModel.has(groupKey)) {
            productsByModel.set(groupKey, []);
        }
        productsByModel.get(groupKey).push(product);
    }

    logger.info(`📋 Grouped ${products.length} scraped items into ${productsByModel.size} unique Model Groups for linking.`);


    let created = 0;
    let skipped = 0;
    let failed = 0;
    let index = 0;

    // 2. Iterate Over EVERY Scraped Product (Individual Sync)
    for (const product of products) {
        index++;

        try {
            // A. Determine Color Name
            let colorName = product.color;

            // Find Peers for this product
            let myGroupKey = null;
            // EFFICIENT LOOKUP: Re-calculate key for current product
            const allIds = [String(product.productId)];
            if (product.colorVariants) {
                product.colorVariants.forEach(v => {
                    if (v.sku) allIds.push(String(v.sku));
                });
            }
            const uniqueIds = [...new Set(allIds)].sort();
            myGroupKey = `GROUP-${uniqueIds.join('-')}`;

            const peers = productsByModel.get(myGroupKey) || [product];

            // Fallback: Peer Lookup
            if (!colorName) {
                if (peers) {
                    for (const peer of peers) {
                        if (peer.productId === product.productId) continue;
                        const match = peer.colorVariants?.find(cv => cv.sku == product.productId);
                        if (match && match.color) { colorName = match.color; break; }
                    }
                }
            }
            // Fallback: Title Extraction
            if (!colorName && product.name) {
                colorName = product.name.split(' ')[0];
            }
            colorName = colorName || 'Default';
            colorName = colorName.charAt(0).toUpperCase() + colorName.slice(1); // "Siyah"

            // B. Generate Unique Handle for THIS product
            let baseHandle = product.url.split('/').pop().split('?')[0];
            baseHandle = baseHandle.replace(/-p-\d+$/, '');
            const handle = `${baseHandle}-${colorName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

            // ==========================================
            // DEDUPLICATION CHECK 1: PRODUCT LEVEL
            // ==========================================
            const productExists = await dedupe.checkProductExists(handle, product.productId);
            
            if (productExists.exists) {
                logger.info(`[${index}/${products.length}] ⏭️  SKIP PRODUCT: ${handle} (Reason: ${productExists.skipReason})`);
                skipped++;
                continue; // STRICTLY SKIP
            }


            // C. Generate HTML Links (Styled like Buttons)
            const peerLinks = peers.map(peer => {
                let pColor = peer.color;

                // Resolving color for PEER
                if (!pColor) {
                    // Check MY variants to see what I call the peer? YES.
                    const variantEntry = product.colorVariants?.find(cv => cv.sku == peer.productId);
                    if (variantEntry && variantEntry.color) pColor = variantEntry.color;
                }
                // Check peer's title
                if (!pColor && peer.name) pColor = peer.name.split(' ')[0];
                pColor = pColor || 'Default';
                pColor = pColor.charAt(0).toUpperCase() + pColor.slice(1);

                // Peer Handle
                let pBase = peer.url.split('/').pop().split('?')[0].replace(/-p-\d+$/, '');
                const pHandle = `${pBase}-${pColor.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

                const isActive = (peer.productId === product.productId);

                // BUTTON STYLE (pill/capsule)
                return `<a href="/products/${pHandle}" title="${pColor}" style="
                    display: inline-block;
                    margin-right: 10px;
                    margin-bottom: 10px;
                    padding: 8px 16px;
                    border: 1px solid ${isActive ? '#000' : '#e5e5e5'};
                    background-color: ${isActive ? '#f5f5f5' : '#fff'};
                    color: ${isActive ? '#000' : '#333'};
                    text-decoration: none;
                    border-radius: 20px;
                    font-size: 14px;
                    font-family: inherit;
                    transition: all 0.2s ease;
                    text-transform: capitalize;
                    cursor: ${isActive ? 'default' : 'pointer'};
                    ${isActive ? 'font-weight: 600; pointer-events: none;' : ''}
                " 
                onmouseover="this.style.borderColor='#999'" 
                onmouseout="this.style.borderColor='${isActive ? '#000' : '#e5e5e5'}'"
                >${pColor}</a>`;
            }).join('');

            const colorSwatchesHtml = `
                <div style="margin-bottom: 25px;">
                    <p style="margin-bottom: 12px; font-weight: 600; font-size: 15px;">Colors:</p>
                    <div style="display: flex; flex-wrap: wrap; align-items: center;">
                        ${peerLinks}
                    </div>
                </div>
            `;

            // D. Description
            const finalDescription = colorSwatchesHtml + (product.description || `Category: ${product.category}`);


            // E. Images (Upload ALL images for this product)
            const shopifyImagesPayload = [];
            let allImages = [];
            if (product.images) allImages.push(...product.images);
            if (product.image) allImages.push(product.image);
            allImages = [...new Set(allImages)]; // Dedupe

            // FILTER: Remove images from other variants using "Majority Vote"
            if (allImages.length > 2) {
                try {
                    const getVariantId = (url) => {
                        const parts = url.split('/');
                        if (parts.length < 5) return 'unknown';
                        return parts[parts.length - 3];
                    };

                    const idCounts = {};
                    allImages.forEach(url => {
                        const vId = getVariantId(url);
                        idCounts[vId] = (idCounts[vId] || 0) + 1;
                    });

                    let bestId = null;
                    let maxCount = 0;
                    for (const [vId, count] of Object.entries(idCounts)) {
                        if (count > maxCount) {
                            maxCount = count;
                            bestId = vId;
                        }
                    }

                    if (bestId && bestId !== 'unknown') {
                        if (maxCount >= 1) {
                            allImages = allImages.filter(url => getVariantId(url) === bestId);
                        }
                    }
                } catch (err) {
                    // Safety: Do nothing if parsing fails
                }
            }

            let imgPosition = 1;
            for (const url of allImages) {
                // Try upload
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000);
                    const imageRes = await fetch(url, {
                        signal: controller.signal,
                        headers: { 'User-Agent': 'Mozilla/5.0' }
                    });
                    clearTimeout(timeoutId);
                    if (imageRes.ok) {
                        const buf = await imageRes.arrayBuffer();
                        const base64 = Buffer.from(buf).toString('base64');
                        shopifyImagesPayload.push({
                            position: imgPosition++,
                            attachment: base64,
                            filename: `img-${handle}-${imgPosition}-${Date.now()}.jpg`
                        });
                    } else {
                        shopifyImagesPayload.push({ position: imgPosition++, src: url });
                    }
                } catch (e) {
                    shopifyImagesPayload.push({ position: imgPosition++, src: url });
                }
            }


            // F. Variants (Only Sizes)
            // ==========================================
            // DEDUPLICATION CHECK 2: VARIANT SKU LEVEL
            // ==========================================
            const variantsPayload = [];
            const sizeList = product.sizes && product.sizes.length > 0 ? product.sizes : [{ name: 'One Size', inStock: true, price: product.price, barcode: product.sku }];

            for (const size of sizeList) {
                const sku = size.barcode || `${product.productId}-${size.name}`;
                
                // STRICT CHECK: Does this SKU exist anywhere?
                const skuExists = await dedupe.checkSkuExists(sku);
                
                if (skuExists) {
                    logger.info(`   ⚠️ Skipping Variant SKU ${sku} (Already exists)`);
                    continue; 
                }

                variantsPayload.push({
                    option1: size.name,    // Size
                    price: (product.price * PRICE_MULTIPLIER).toFixed(2),
                    sku: sku,
                    inventory_management: 'shopify',
                    inventory_policy: size.inStock ? 'continue' : 'deny',
                    inventory_quantity: size.inStock ? 10 : 0
                });
            }

            if (variantsPayload.length === 0) {
                 logger.warn(`   ⚠️ All variants skipped for ${handle}. Skipping product creation.`);
                 skipped++;
                 continue;
            }


            // G. Tags
            const categoryTags = CATEGORY_TAGS[product.category] || [`category:${product.category?.toLowerCase()}`];
            // ADD external_id tag for indexing
            const allTags = [...categoryTags, 'trendyol', 'auto-imported', `model:${product.groupCode}`, `color:${colorName}`, `external_id:${product.productId}`].join(', ');

            // H. Save to Shopify
            
            // NOTE: We only CREATE here. Dedup check prevented updates to existing products to match "Strict No Duplicate" rule.
            // If you wanted to validly UPDATE existing products, we would have returned the ID in dedupe check and used it here.
            // But requirement was "Do NOT allow any duplicate... to be pushed". Implicitly implies if it exists, leave it alone.
            
            logger.info(`[${index}/${products.length}] CREATING Product: ${handle}`);
            const newProduct = new shopify.rest.Product({ session: shopify.session });
            newProduct.title = product.name; // Keep full title including color
            newProduct.body_html = finalDescription;
            newProduct.vendor = product.brand || "TRENDYOLMİLLA";
            newProduct.product_type = product.category;
            newProduct.handle = handle;
            newProduct.tags = allTags;
            newProduct.images = shopifyImagesPayload;
            newProduct.variants = variantsPayload;
            newProduct.options = [{ name: "Size" }]; // Only Size option
            
            // Add Metafield
            newProduct.metafields = [
                {
                    namespace: "source",
                    key: "external_product_id",
                    value: String(product.productId),
                    type: "single_line_text_field"
                }
            ];

            await newProduct.save({ update: true });
            created++;
            

            // Sync Delay
            await new Promise(r => setTimeout(r, 2000)); // 2s is enough for individual items

        } catch (error) {
            logger.error(`[${index}/${products.length}] FAILED Product ${product.productId}: ${error.message}`);
            failed++;
        }
    }

    logger.info(`\n✅ Created: ${created}, Skipped: ${skipped}, Failed: ${failed}\n`);
}
    // No explicit cleanup needed as we want to keep all


logger.info('========================================');
logger.info('STEP 4: CLEANUP - REMOVING 0-IMAGE PRODUCTS');
logger.info('========================================\n');

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
    logger.info(`Command Args: ${JSON.stringify(process.argv)}`);
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