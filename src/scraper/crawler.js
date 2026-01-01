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
    let allProducts = [];
    let pageIndex = 1;
    let hasMore = true;

    try {
        browser = await startBrowser();
        const page = await browser.newPage();

        // Set User Agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        while (hasMore) {
            // Construct URL with pagination parameter (pi=1, pi=2, etc.)
            // Handle existing query params correctly
            const separator = categoryUrl.includes('?') ? '&' : '?';
            const pageUrl = `${categoryUrl}${separator}pi=${pageIndex}`;

            logger.info(`Navigating to ${categoryName} (Page ${pageIndex}): ${pageUrl}`);

            try {
                await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });

                // Wait for hydration or content
                try {
                    await page.waitForFunction(() => window['__single-search-result__PROPS'] || document.querySelector('.p-card-wrppr'), { timeout: 15000 });
                } catch (e) {
                    console.warn(`Timeout waiting for data/selectors on page ${pageIndex}, check if page is empty or blocked.`);
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

                if (products.length === 0) {
                    logger.info(`No products found on page ${pageIndex}. Stopping pagination.`);
                    hasMore = false;
                    break;
                }

                logger.info(`Extracted ${products.length} products from ${categoryName} (Page ${pageIndex})`);

                // Check for duplicates within this batch relative to allProducts (optional, but good practice)
                const existingIds = new Set(allProducts.map(p => p.productId));
                const newProducts = products.filter(p => !existingIds.has(p.productId));

                if (newProducts.length === 0 && products.length > 0) {
                    logger.warn(`Page ${pageIndex} returned products but all were duplicates. Stopping to avoid loops.`);
                    hasMore = false;
                    break;
                }

                // If fetchDetails is enabled, visit each NEW product page for detailed data
                if (fetchDetails && newProducts.length > 0) {
                    logger.info(`Fetching details for ${newProducts.length} new products...`);

                    for (let i = 0; i < newProducts.length; i++) {
                        const product = newProducts[i];
                        logger.info(`[Page ${pageIndex}] [${i + 1}/${newProducts.length}] Fetching details for: ${product.name.substring(0, 50)}...`);

                        try {
                            const details = await crawlProductDetails(page, product.url);
                            if (details) {
                                // Merge detail data, prioritize images from details
                                newProducts[i] = {
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

                allProducts.push(...newProducts);
                pageIndex++;

                // Optional: Safety break for testing so we don't go forever if user wants to test quickly
                // remove this for production
                // if (pageIndex > 3) break; 

            } catch (pageError) {
                logger.error(`Error processing page ${pageIndex}: ${pageError.message}`);
                // If a page fails, we try to move to the next one, or break? 
                // Usually safer to break to ensure we don't spam errors
                hasMore = false;
            }
        }

        return allProducts;

    } catch (error) {
        logger.error(`Crawl failed for ${categoryName}: ${error.message}`);
        return allProducts; // Return what we have so far
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

        // Extract description from DOM since JSON often has it as null
        const domDescription = await page.evaluate(() => {
            const el = document.querySelector('.content-description-container');
            if (el) return el.innerText.trim();

            // Fallback to iterating list contents (sometimes structure varies)
            const contents = Array.from(document.querySelectorAll('.product-description-content'))
                .map(e => e.innerText.trim())
                .join('\n\n');

            return contents || null;
        });

        if (detailData.product) {
            detailData.product.domDescription = domDescription;
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
