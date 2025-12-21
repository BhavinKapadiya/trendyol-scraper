const { crawlCategory } = require('./src/scraper/crawler');
const { syncProducts } = require('./src/shopify/sync');
const fs = require('fs');
const logger = require('./src/utils/logger');

// Configuration
const FETCH_PRODUCT_DETAILS = true;
const SYNC_TO_SHOPIFY = true; // Set to false to only scrape without syncing

// Categories
const CATEGORIES = [
    { name: 'Bluz', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20bluz&qt=trendyolmilla%20bluz&st=trendyolmilla%20bluz' },
    { name: 'Kazak', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20kazak&qt=trendyolmilla%20kazak&st=trendyolmilla%20kazak' },
    { name: 'Hırka', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20hırka&qt=trendyolmilla%20hırka&st=trendyolmilla%20hırka' },
    { name: 'Jeans', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20jeans&qt=trendyolmilla%20jeans&st=trendyolmilla%20jeans' },
    { name: 'Elbise', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20elbise&qt=trendyolmilla%20elbise&st=trendyolmilla%20elbise' },
    { name: 'Pijama Takımı', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20pijama&qt=trendyolmilla%20pijama&st=trendyolmilla%20pijama' },
    { name: 'Pantolon', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20pantolon&qt=trendyolmilla%20pantolon&st=trendyolmilla%20pantolon' },
    { name: 'Sweatshirt', url: 'https://www.trendyol-milla.com/sr?q=trendyolmilla%20sweatshirt&qt=trendyolmilla%20sweatshirt&st=trendyolmilla%20sweatshirt' },
];

// Merge new products with existing (deduplication by productId)
function mergeProducts(existingProducts, newProducts) {
    const productMap = {};
    
    // Add existing products to map
    for (const p of existingProducts) {
        if (p.productId) {
            productMap[p.productId] = p;
        }
    }
    
    // Merge/overwrite with new products
    let newCount = 0;
    let updatedCount = 0;
    
    for (const p of newProducts) {
        if (p.productId) {
            if (productMap[p.productId]) {
                updatedCount++;
            } else {
                newCount++;
            }
            productMap[p.productId] = {
                ...productMap[p.productId],
                ...p,
                lastUpdated: new Date().toISOString()
            };
        }
    }
    
    logger.info(`Merged: ${newCount} new, ${updatedCount} updated`);
    return Object.values(productMap);
}

async function main() {
    logger.info('Starting Scraper Job');
    logger.info(`Detailed scraping: ${FETCH_PRODUCT_DETAILS ? 'ENABLED' : 'DISABLED'}`);
    logger.info(`Shopify sync: ${SYNC_TO_SHOPIFY ? 'ENABLED' : 'DISABLED'}`);

    const allProducts = [];
    const startTime = Date.now();

    for (let i = 0; i < CATEGORIES.length; i++) {
        const cat = CATEGORIES[i];
        logger.info(`\n[Category ${i + 1}/${CATEGORIES.length}] Scraping: ${cat.name}`);
        
        const products = await crawlCategory(cat.url, cat.name, FETCH_PRODUCT_DETAILS);
        allProducts.push(...products);
        
        logger.info(`Total products so far: ${allProducts.length}`);
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    
    // Load existing products and merge (deduplication)
    let mergedProducts = allProducts;
    if (fs.existsSync('products.json')) {
        try {
            const existing = JSON.parse(fs.readFileSync('products.json', 'utf8'));
            mergedProducts = mergeProducts(existing, allProducts);
        } catch (e) {
            logger.warn('Could not load existing products.json, saving fresh');
        }
    }
    
    // Save to JSON
    fs.writeFileSync('products.json', JSON.stringify(mergedProducts, null, 2));
    logger.info(`\n========================================`);
    logger.info(`Scraping completed in ${duration} minutes`);
    logger.info(`Saved ${mergedProducts.length} products to products.json`);
    
    // Sample output
    if (allProducts.length > 0 && FETCH_PRODUCT_DETAILS) {
        const sample = allProducts[0];
        logger.info(`\nSample product:`);
        logger.info(`  SKU: ${sample.sku || 'N/A'}`);
        logger.info(`  Color: ${sample.color || 'N/A'}`);
        logger.info(`  Sizes: ${sample.sizes ? sample.sizes.map(s => s.name).join(', ') : 'N/A'}`);
    }

    // Sync to Shopify
    if (SYNC_TO_SHOPIFY) {
        logger.info(`\n========================================`);
        logger.info(`Starting Shopify Sync...`);
        await syncProducts(mergedProducts);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main, CATEGORIES };
