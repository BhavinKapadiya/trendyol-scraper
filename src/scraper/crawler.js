const { startBrowser } = require('./browser');
const { extractProductData, extractProductDetails } = require('./extractor');
const logger = require('../utils/logger');

// Extract product ID from URL
function extractProductId(url) {
    const match = url.match(/-p-(\d+)/);
    return match ? match[1] : null;
}

async function crawlCategory(categoryUrl, categoryName, fetchDetails = false, limit = 1000) {
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
                        // Respect the passed limit
                        if (allProducts.length + i >= limit) {
                            logger.info(`🛑 LIMIT REACHED: Stopped at exactly ${limit} products.`);
                            newProducts.splice(i);
                            hasMore = false;
                            break;
                        }

                        const product = newProducts[i];
                        logger.info(`[Page ${pageIndex}] [${i + 1}/${newProducts.length}] Fetching details for: ${product.name.substring(0, 50)}...`);

                        try {
                            const details = await crawlProductDetails(product.url, browser);
                            if (details) {
                                // Merge detail data, prioritize images from details
                                newProducts[i] = {
                                    ...product,
                                    ...details,
                                    // Use detail images if available, otherwise fall back to category image as array
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
async function crawlProductDetails(url, existingBrowser = null) {
    let browser;
    let page;
    try {
        // Use existing browser if provided, otherwise start a new one
        if (existingBrowser) {
            browser = existingBrowser;
        } else {
            browser = await startBrowser();
        }

        page = await browser.newPage();

        // Increase navigation timeout to 90 seconds
        await page.setDefaultNavigationTimeout(90000);

        // Block images/fonts to save bandwidth
        // DISABLED FOR DEBUGGING: Page seems broken without resources
        // await page.setRequestInterception(true);
        /*
        page.on('request', (req) => {
            if (['image', 'font', 'stylesheet'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });
        */

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

                        // Click "Show More" if found while scrolling
                        const showMoreBtn = document.querySelector('.show-more-button');
                        if (showMoreBtn) showMoreBtn.click();

                        // Scroll until we hit the bottom or 2500px 
                        if (totalHeight >= 2500 || totalHeight >= scrollHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });
            // Wait a bit for content to render after scrolling
            await new Promise(r => setTimeout(r, 10000));
        } catch (e) { /* ignore scroll errors */ }

        // 2. Extract Data (Try JSON first, then DOM fallback)
        const detailData = await page.evaluate(() => {
            // Helper to get text safely
            const getText = (sel) => document.querySelector(sel)?.innerText?.trim();
            const getAllText = (sel) => Array.from(document.querySelectorAll(sel)).map(e => e.innerText.trim()).join('\n');

            // --- STRATEGY 1: JSON Data (Updated for new Trendyol Envoy architecture) ---
            // Trendyol now uses Envoy micro-frontend architecture with different window variables
            let jsonData = null;
            let productData = null;

            // Try new Envoy variables first
            const envoyProductDetail = window['__envoy_product-detail__PROPS'];
            const envoyProductInfo = window['__envoy_product-info__PROPS'];
            const envoyImageGallery = window['__envoy_product-image-gallery__PROPS'];

            // Fallback to older variable names
            const legacyData = window.__PRODUCT_DETAIL_APP_INITIAL_STATE__ ||
                window.__PRELOADED_STATE__ ||
                window.__SEARCH_APP_INITIAL_STATE__;

            // Extract product data from Envoy structure
            if (envoyProductDetail && envoyProductDetail.product) {
                productData = envoyProductDetail.product;
                console.log('[Scraper] Using __envoy_product-detail__PROPS');
            } else if (legacyData && legacyData.product) {
                productData = legacyData.product;
                console.log('[Scraper] Using legacy window variable');
            }

            // If we found product data, enhance it with additional Envoy sources
            if (productData) {
                // Add additional image data from gallery if available
                if (envoyImageGallery && envoyImageGallery.images && productData.images.length === 0) {
                    productData.images = envoyImageGallery.images.map(img => img.url || img);
                }

                // Add additional product info if available
                if (envoyProductInfo && envoyProductInfo.productFeatures) {
                    productData.features = envoyProductInfo.productFeatures;
                }
            }


            // --- STRATEGY 2: DOM Description (Aggressive Search) ---
            let domDescription = '';

            // 1. Try EXACT Verified Selectors first
            const descContainer = document.querySelector('.content-description-container') ||
                document.querySelector('.product-description-content') ||
                document.querySelector('.product-desc-content') ||
                document.querySelector('.product-detail-wrapper') ||
                document.querySelector('.attributes-list') ||
                document.querySelector('ul.detail-attr-container');

            if (descContainer) {
                // Formatting: if it's the verified container, map the p tags
                if (descContainer.classList.contains('content-description-container')) {
                    const contents = Array.from(descContainer.querySelectorAll('.product-description-content'));

                    if (contents.length > 0) {
                        domDescription = contents.map(p => p.innerHTML).join('<br>');
                    } else {
                        // Fallback using direct innerHTML if structured content is missing
                        domDescription = descContainer.innerHTML;
                    }
                } else if (descContainer.tagName === 'UL') {
                    domDescription = Array.from(descContainer.querySelectorAll('li'))
                        .map(li => `• ${li.innerText.trim()}`)
                        .join('<br>');
                } else {
                    domDescription = descContainer.innerHTML;
                }
            }

            // 2. Fallback: Header Hunting (English & Turkish)
            if (!domDescription || domDescription.length < 50) {
                // ADDED h1, h2 to selectors (Previously missing, causing failure on some pages)
                const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, .text-heading, strong, b, div, font'));
                const targetHeaders = ['Ürün Bilgileri', 'Ürün Açıklaması', 'Product Information', 'Product Description', 'Additional Information'];

                const infoHeading = headings.find(h => targetHeaders.some(t => h.innerText.includes(t)));
                if (infoHeading) {
                    // Strategy: The header is usually inside the content container.
                    // Grab the parent element's HTML to capture the context.
                    // Check if parent is reasonable (not body/html)
                    const parent = infoHeading.parentElement;
                    if (parent && parent.tagName !== 'BODY' && parent.tagName !== 'HTML') {
                        // Use the parent's content (removing the header itself if possible, but keeping it is also fine)
                        domDescription = parent.innerHTML;
                    } else {
                        // Fallback to siblings if parent is too generic
                        let contentEl = infoHeading.nextElementSibling;
                        while (contentEl && (contentEl.tagName === 'P' || contentEl.tagName === 'UL' || contentEl.tagName === 'DIV')) {
                            domDescription += contentEl.outerHTML;
                            contentEl = contentEl.nextElementSibling;
                        }
                    }
                }
            }

            // 3. Fallback: User specific 'font' tag hint (if Google Translate artifacts exist)
            if (!domDescription) {
                const fonts = Array.from(document.querySelectorAll('font'));
                const descFont = fonts.find(f => f.innerText.includes('Product Description'));
                if (descFont && descFont.parentElement) {
                    domDescription = descFont.parentElement.innerHTML;
                }
            }

            // Final Sanity Check: If description looks like footer SEO junk, kill it
            if (domDescription && (domDescription.includes('internal-linking') || domDescription.includes('Popüler Marka'))) {
                domDescription = '';
            }

            // Clean up description (remove script tags, etc if raw HTML)
            if (domDescription) {
                domDescription = domDescription.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gm, "");
            }

            // If we found a DOM description, use it
            if (productData) {
                // Attach new DOM description if it exists and is meaningful
                // We prioritize DOM because JSON is often empty for description
                if (domDescription && domDescription.length > 10) {
                    productData.description = domDescription;
                }

                // NORMALIZE IMAGES: Ensure it's an array of strings with full resolution URLs
                if (Array.isArray(productData.images)) {
                    productData.images = productData.images.map(img => {
                        let imageUrl = '';

                        // Handle different image formats
                        if (typeof img === 'string') {
                            imageUrl = img;
                        } else if (img && typeof img === 'object') {
                            // Try different possible properties
                            imageUrl = img.url || img.src || img.large || img.original || '';
                        }

                        // Ensure full URL (handle relative URLs)
                        if (imageUrl && !imageUrl.startsWith('http')) {
                            imageUrl = 'https://cdn.dsmcdn.com' + imageUrl;
                        }

                        // Convert to high-res URLs if they're thumbnail versions
                        if (imageUrl && imageUrl.includes('/mnresize/')) {
                            imageUrl = imageUrl.replace('/mnresize/400/-/', '/');
                            imageUrl = imageUrl.replace('/mnresize/600/-/', '/');
                        }

                        return imageUrl;
                    }).filter(url => url && url.startsWith('http')); // Remove empty/invalid
                }

                // If JSON images are empty or not found, try DOM images
                if (!productData.images || productData.images.length === 0) {
                    productData.images = Array.from(document.querySelectorAll('.product-slide img, .gallery-modal-content img, .detail-section-img, .gallery-container img'))
                        .map(img => {
                            let src = img.getAttribute('src') || img.getAttribute('data-src');
                            // Convert to high-res
                            if (src && src.includes('/mnresize/')) {
                                src = src.replace('/mnresize/400/-/', '/');
                                src = src.replace('/mnresize/600/-/', '/');
                            }
                            return src;
                        })
                        .filter(src => src && src.startsWith('http'));
                }

                // EXTRACT GROUP CODE (For merging color variants)
                // Try to find a common ID that is shared across all colors of this product
                const groupCode = productData.productGroupId ||
                    productData.productCode ||
                    productData.contentGroup ||
                    productData.modelCode ||
                    (productData.attributes ? productData.attributes.find(a => a.key === 'modelCode')?.value : null);

                // Add to product data
                productData.groupCode = groupCode;

                // Also extract the COLOR name explicitly if possible
                const colorAttr = productData.attributes ? productData.attributes.find(a => a.shareableKey === 'Renk' || a.key === 'Ren') : null;
                if (colorAttr) {
                    productData.color = colorAttr.value;
                }

                // CRITICAL FIX: Extract price from alternative locations if missing
                if (!productData.price) {
                    // 1. Try merchantListing
                    if (productData.merchantListing?.listing?.price) {
                        productData.price = productData.merchantListing.listing.price;
                    }
                    // 2. Try first variant
                    else if (productData.variants && productData.variants.length > 0 && productData.variants[0].price) {
                        productData.price = productData.variants[0].price;
                    }
                }

                // CRITICAL FIX: If price is STILL missing, force scrape from DOM
                if (!productData.price) {
                    const getMetaPrice = () => {
                        const p = document.querySelector('meta[property="product:price:amount"]')?.content ||
                            document.querySelector('meta[property="og:price:amount"]')?.content;
                        return p ? parseFloat(p) : 0;
                    };

                    const getDomPrice = () => {
                        const el = document.querySelector('.product-price-container span') ||
                            document.querySelector('.prc-dsc') ||
                            document.querySelector('.price-box') ||
                            document.querySelector('.ps-product__price');
                        if (!el) return 0;
                        const text = el.innerText;
                        return parseFloat(text.replace(/[^0-9.,]/g, '').replace(',', '.'));
                    };

                    const domPriceVal = getMetaPrice() || getDomPrice();

                    if (domPriceVal > 0) {
                        productData.price = { sellingPrice: { value: domPriceVal } };
                    }
                }

                return { product: productData };
            }

            // --- STRATEGY 3: Full DOM Fallback ---
            const getMeta = (name) => document.querySelector(`meta[property = "og:${name}"]`)?.content;
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





        if (detailData) {
            // Merge the browser-extracted color into the product details if not already present
            if (detailData.extractedColor) {
               if (!detailData.product) detailData.product = {};
               detailData.product.fallbackColor = detailData.extractedColor;
            }
        }

        const cleanedDetails = extractProductDetails(detailData);
        return cleanedDetails;

    } catch (error) {
        logger.error(`Error crawling product details for ${url}: ${error.message}`);
        return null; // Return null to indicate failure
    } finally {
        if (page) await page.close();
        // Do NOT close browser here if it was passed in
        if (!existingBrowser && browser) {
            await browser.close();
        }
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
