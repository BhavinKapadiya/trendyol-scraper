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
                            const details = await crawlProductDetails(product.url);
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
async function crawlProductDetails(url) {
    let browser;
    try {
        browser = await startBrowser();
        const page = await browser.newPage();

        // Block images/fonts to save bandwidth
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'font', 'stylesheet'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        logger.info(`Fetching details for: ${url.substring(0, 50)}...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // 1. Try to close "Select Country" popup if it exists
        try {
            const popupClose = await page.$('.country-selection-modal-close, .modal-close, .onboarding-popover__close');
            if (popupClose) {
                await popupClose.click();
                await new Promise(r => setTimeout(r, 1000));
            }
        } catch (e) { /* ignore */ }

        // 1.5. Scroll down to trigger lazy loading of description/reviews
        try {
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 100;
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;

                        // Scroll until we hit the bottom or 2000px (enough for description)
                        if (totalHeight >= 2000 || totalHeight >= scrollHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });
            // Wait a bit for content to render after scrolling
            await new Promise(r => setTimeout(r, 1500));
        } catch (e) { /* ignore scroll errors */ }

        // 2. Extract Data (Try JSON first, then DOM fallback)
        const detailData = await page.evaluate(() => {
            // Helper to get text safely
            const getText = (sel) => document.querySelector(sel)?.innerText?.trim();
            const getAllText = (sel) => Array.from(document.querySelectorAll(sel)).map(e => e.innerText.trim()).join('\n');

            // --- STRATEGY 1: JSON Data ---
            const jsonData = window.__PRODUCT_DETAIL_APP_INITIAL_STATE__ || window.__PRELOADED_STATE__ || window.__SEARCH_APP_INITIAL_STATE__;
            let productData = null;

            if (jsonData && jsonData.product) {
                productData = jsonData.product;
            }

            // --- STRATEGY 2: DOM Description (The User's Request) ---
            // Look for specific containers or "Product Information" headers
            let domDescription = '';

            // Try specific selectors for "Ürün Bilgileri" / "Product Details"
            const descContainer = document.querySelector('.product-detail-wrapper') ||
                document.querySelector('.attributes-list') ||
                document.querySelector('.product-desc-content');

            if (descContainer) {
                domDescription = descContainer.innerText.trim();
            } else {
                // Fallback: Search for headers
                const headings = Array.from(document.querySelectorAll('h3, h4, .text-heading'));
                const infoHeading = headings.find(h => h.innerText.includes('Ürün Bilgileri') || h.innerText.includes('Product Information'));
                if (infoHeading && infoHeading.nextElementSibling) {
                    domDescription = infoHeading.nextElementSibling.innerText.trim();
                }
            }

            // If we found a DOM description, use it
            if (productData) {
                // Attach new DOM description if better
                if (domDescription && domDescription.length > (productData.description || '').length) {
                    productData.description = domDescription;
                }

                // NORMALIZE IMAGES: Ensure it's an array of strings
                if (Array.isArray(productData.images)) {
                    productData.images = productData.images.map(img => {
                        if (typeof img === 'string') return img;
                        return img.url || img.src || img.large || ''; // Handle potential object structure
                    }).filter(url => url && url.startsWith('http')); // Remove empty/invalid
                }

                // If JSON images are empty, try DOM images
                if (!productData.images || productData.images.length === 0) {
                    productData.images = Array.from(document.querySelectorAll('.product-slide img, .gallery-modal-content img, .detail-section-img'))
                        .map(img => img.getAttribute('src') || img.getAttribute('data-src'))
                        .filter(src => src);
                }

                return { product: productData };
            }

            // --- STRATEGY 3: Full DOM Fallback ---
            const getMeta = (name) => document.querySelector(`meta[property="og:${name}"]`)?.content;
            const getPrice = () => {
                const el = document.querySelector('.product-price-container, .prc-dsc, .price-box');
                return el ? parseFloat(el.innerText.replace(/[^0-9.,]/g, '').replace(',', '.')) : 0;
            };

            // Improved Image Selector for Fallback
            const domImages = Array.from(document.querySelectorAll('.product-slide img, .gallery-modal-content img, .detail-section-img, .gallery-container img'))
                .map(img => img.getAttribute('src') || img.getAttribute('data-src')) // Get 'src' or lazy-load 'data-src'
                .filter(src => src && src.startsWith('http'));

            const domProduct = {
                name: getMeta('title') || getText('.pr-new-br') || document.title,
                description: domDescription || getMeta('description') || getText('.product-desc'),
                images: domImages.length > 0 ? domImages : (getMeta('image') ? [getMeta('image')] : []),
                price: { sellingPrice: { value: getPrice() } },
                variants: [],
                brand: { name: getText('.pr-new-br a') || 'Trendyol' }
            };

            return { product: domProduct, isFallback: true };
        });

        await browser.close();

        if (detailData && (detailData.product || detailData.isFallback)) {
            // Normalize fallback data structure match expected extractor format
            if (detailData.isFallback) {
                return {
                    product: {
                        name: detailData.product.name,
                        images: detailData.product.images,
                        price: detailData.product.price,
                        brand: detailData.product.brand,
                        description: detailData.product.description,
                        isFallback: true
                    }
                };
            }
            return detailData;
        }

        logger.warn(`No product detail data found for ${url}`);
        return null;

    } catch (error) {
        logger.error(`Failed to fetch details for ${url}: ${error.message}`);
        if (browser) await browser.close();
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
