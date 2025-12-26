const { startBrowser } = require('./browser');
const { extractProductData, extractProductDetails } = require('./extractor');
const logger = require('../utils/logger');

// Extract product ID from URL
function extractProductId(url) {
    const match = url.match(/-p-(\d+)/);
    return match ? match[1] : null;
}

async function crawlCategory(categoryUrl, categoryName, fetchDetails = false) {
    let browser;
    try {
        browser = await startBrowser();
        const page = await browser.newPage();

        // Set User Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        logger.info(`Navigating to ${categoryName}: ${categoryUrl}`);
        await page.goto(categoryUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait for hydration or content
        try {
            await page.waitForFunction(() => window['__single-search-result__PROPS'] || document.querySelector('.p-card-wrppr'), { timeout: 15000 });
        } catch (e) {
            console.warn("Timeout waiting for data/selectors, proceeding...");
        }

        // Extract hydration data
        const hydrationData = await page.evaluate(() => {
            return window['__single-search-result__PROPS'] || window['__initialState'] || null;
        });

        // Get HTML for legacy check
        const html = await page.content();

        // Extract basic product data from category page
        let products = extractProductData(html, categoryName, hydrationData);

        // Add productId to each product
        products = products.map(p => ({
            ...p,
            productId: extractProductId(p.url)
        }));

        logger.info(`Extracted ${products.length} products from ${categoryName}`);

        // If fetchDetails is enabled, visit each product page for detailed data
        if (fetchDetails && products.length > 0) {
            logger.info(`Fetching details for ${products.length} products...`);
            
            for (let i = 0; i < products.length; i++) {
                const product = products[i];
                logger.info(`[${i + 1}/${products.length}] Fetching details for: ${product.name.substring(0, 50)}...`);
                
                try {
                    const details = await crawlProductDetails(page, product.url);
                    if (details) {
                        // Merge detail data, prioritize images from details
                        products[i] = { 
                            ...product, 
                            ...details,
                            // Use detail images if available, otherwise fall back to category image as array
                            images: details.images && details.images.length > 0 
                                ? details.images 
                                : (product.image ? [product.image] : [])
                        };
                    }
                } catch (error) {
                    logger.error(`Failed to fetch details for ${product.url}: ${error.message}`);
                }
                
                // Small delay between requests to be respectful
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        return products;

    } catch (error) {
        logger.error(`Crawl failed for ${categoryName}: ${error.message}`);
        return [];
    } finally {
        if (browser) await browser.close();
    }
}

// Crawl individual product page for detailed data
async function crawlProductDetails(page, productUrl) {
    try {
        await page.goto(productUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait for product detail data
        try {
            await page.waitForFunction(() => window['__envoy_product-detail__PROPS'], { timeout: 10000 });
        } catch (e) {
            logger.warn(`No product detail data found for ${productUrl}`);
            return null;
        }

        // Extract hydration data from product detail page
        const detailData = await page.evaluate(() => {
            return window['__envoy_product-detail__PROPS'] || null;
        });

        if (!detailData) {
            return null;
        }

        return extractProductDetails(detailData);

    } catch (error) {
        logger.error(`Error crawling product details: ${error.message}`);
        return null;
    }
}

async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight - window.innerHeight || totalHeight > 20000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

module.exports = { crawlCategory, crawlProductDetails, extractProductId };
