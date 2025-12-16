const cron = require('node-cron');
const { crawlCategory } = require('../scraper/crawler'); // Adjustment needed for path
const { syncProducts } = require('../shopify/sync');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

// Config
const CRON_SCHEDULE = '0 0 * * *'; // Daily at midnight
// const CRON_SCHEDULE = '*/5 * * * *'; // Every 5 minutes for testing

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

logger.info(`Initializing Cron Job with schedule: ${CRON_SCHEDULE}`);

const task = cron.schedule(CRON_SCHEDULE, async () => {
    logger.info('Running Scheduled Job...');

    const allProducts = [];

    for (const cat of CATEGORIES) {
        try {
            const products = await crawlCategory(cat.url, cat.name);
            allProducts.push(...products);
        } catch (e) {
            logger.error(`Error crawling ${cat.name}: ${e.message}`);
        }
    }

    // Sync to Shopify
    await syncProducts(allProducts);

    logger.info('Scheduled Job Completed.');
});

task.start();

// For manual triggering (optional)
if (process.argv.includes('--run-now')) {
    (async () => {
        logger.info('Manual run triggered');
        const allProducts = [];
        for (const cat of CATEGORIES) {
            const products = await crawlCategory(cat.url, cat.name);
            allProducts.push(...products);
        }
        await syncProducts(allProducts);
    })();
}
