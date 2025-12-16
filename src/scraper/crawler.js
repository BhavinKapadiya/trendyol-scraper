const { startBrowser } = require('./browser');
const { extractProductData } = require('./extractor');
const logger = require('../utils/logger');

async function crawlCategory(categoryUrl, categoryName) {
    let browser;
    try {
        browser = await startBrowser();
        const page = await browser.newPage();

        // Set User Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        logger.info(`Navigating to ${categoryName}: ${categoryUrl}`);
        await page.goto(categoryUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // Handle Infinite Scroll
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

        // Pass html and hydrationData separately
        const products = extractProductData(html, categoryName, hydrationData);

        logger.info(`Extracted ${products.length} products from ${categoryName}`);
        return products;

    } catch (error) {
        logger.error(`Crawl failed for ${categoryName}: ${error.message}`);
        return [];
    } finally {
        if (browser) await browser.close();
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

                // Stop scrolling if we reached the bottom or a limit
                // For safety, let's limit to 5000px or logic to stop when repeated
                // Trendyol is infinite, so we should probably stop after N products or strict finding end
                // Here we scroll a bit for demo purposes. In production, check for 'no more products' or previous height.
                if (totalHeight >= scrollHeight - window.innerHeight || totalHeight > 20000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

module.exports = { crawlCategory };
