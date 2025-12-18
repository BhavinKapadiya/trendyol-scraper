const { crawlCategory } = require('./src/scraper/crawler');
const fs = require('fs');
const logger = require('./src/utils/logger');
const { syncProducts } = require('./src/shopify/sync');

// Categories based on user input
// Categories based on user input
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

async function main() {
    logger.info('Starting Scraper Job');

    const allProducts = [];

    for (const cat of CATEGORIES) {
        const products = await crawlCategory(cat.url, cat.name);
        allProducts.push(...products);
    }

    // Save to JSON
    fs.writeFileSync('products.json', JSON.stringify(allProducts, null, 2));
    logger.info(`Saved ${allProducts.length} products to products.json`);

    // Sync to Shopify
    try {
        await syncProducts(allProducts);
    } catch (error) {
        logger.error(`Sync failed: ${error.message}`);
    }
}

if (require.main === module) {
    main();
}
