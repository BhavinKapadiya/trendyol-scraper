const cron = require('node-cron');
const { crawlCategory } = require('../scraper/crawler');
const { syncProducts } = require('../shopify/sync');
const logger = require('../utils/logger');
const fs = require('fs');

// Configuration
const CRON_SCHEDULE = '0 0 * * *'; // Daily at midnight
const FETCH_PRODUCT_DETAILS = true;

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

// Merge products for deduplication
function mergeProducts(existingProducts, newProducts) {
    const productMap = {};
    for (const p of existingProducts) {
        if (p.productId) productMap[p.productId] = p;
    }
    for (const p of newProducts) {
        if (p.productId) {
            productMap[p.productId] = { ...productMap[p.productId], ...p, lastUpdated: new Date().toISOString() };
        }
    }
    return Object.values(productMap);
}

async function runJob() {
    const startTime = new Date();
    logger.info(`\n========================================`);
    logger.info(`[${startTime.toISOString()}] Starting Scheduled Job...`);
    logger.info(`Detailed scraping: ${FETCH_PRODUCT_DETAILS ? 'ENABLED' : 'DISABLED'}`);

    const allProducts = [];

    for (let i = 0; i < CATEGORIES.length; i++) {
        const cat = CATEGORIES[i];
        try {
            logger.info(`[${i + 1}/${CATEGORIES.length}] Scraping: ${cat.name}`);
            const products = await crawlCategory(cat.url, cat.name, FETCH_PRODUCT_DETAILS);
            allProducts.push(...products);
        } catch (e) {
            logger.error(`Error crawling ${cat.name}: ${e.message}`);
        }
    }
    
    logger.info(`Scraped ${allProducts.length} products`);
    
    // Merge with existing products.json
    let mergedProducts = allProducts;
    const productsFile = 'products.json';
    if (fs.existsSync(productsFile)) {
        try {
            const existing = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
            mergedProducts = mergeProducts(existing, allProducts);
        } catch (e) {
            logger.warn('Could not load existing products.json');
        }
    }
    
    // Save to JSON
    fs.writeFileSync(productsFile, JSON.stringify(mergedProducts, null, 2));
    logger.info(`Saved ${mergedProducts.length} products to ${productsFile}`);

    // Sync to Shopify
    logger.info('Starting Shopify sync...');
    await syncProducts(mergedProducts);

    const duration = ((Date.now() - startTime.getTime()) / 1000 / 60).toFixed(2);
    logger.info(`[${new Date().toISOString()}] Job completed in ${duration} minutes`);
    logger.info(`========================================\n`);
}

// Initialize cron
logger.info(`Cron Job initialized with schedule: ${CRON_SCHEDULE} (daily at midnight)`);
logger.info('Waiting for next scheduled run...');
logger.info('Use --run-now flag to run immediately: node src/automation/cron_job.js --run-now');

const task = cron.schedule(CRON_SCHEDULE, runJob);
task.start();

// Manual trigger option
if (process.argv.includes('--run-now')) {
    logger.info('Manual run triggered via --run-now flag');
    runJob();
}
