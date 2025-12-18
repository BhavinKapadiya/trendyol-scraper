const { crawlCategory } = require('./src/scraper/crawler');
const fs = require('fs');
const logger = require('./src/utils/logger');

// Configuration
const FETCH_PRODUCT_DETAILS = true; // Set to true to scrape SKU, sizes, colors, availability

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
    logger.info(`Detailed product scraping: ${FETCH_PRODUCT_DETAILS ? 'ENABLED' : 'DISABLED'}`);

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
    
    // Save to JSON
    fs.writeFileSync('products.json', JSON.stringify(allProducts, null, 2));
    logger.info(`\n========================================`);
    logger.info(`Scraping completed in ${duration} minutes`);
    logger.info(`Saved ${allProducts.length} products to products.json`);
    
    // Log sample of extracted data
    if (allProducts.length > 0 && FETCH_PRODUCT_DETAILS) {
        const sample = allProducts[0];
        logger.info(`\nSample product data:`);
        logger.info(`  SKU: ${sample.sku || 'N/A'}`);
        logger.info(`  Color: ${sample.color || 'N/A'}`);
        logger.info(`  Sizes: ${sample.sizes ? sample.sizes.map(s => s.name).join(', ') : 'N/A'}`);
        logger.info(`  Availability: ${sample.availability !== undefined ? sample.availability : 'N/A'}`);
    }
}

if (require.main === module) {
    main();
}
