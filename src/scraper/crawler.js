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

                    // Use a dynamic queue to handle discovered variants
                    const productQueue = [...newProducts];
                    const processedUrls = new Set(productQueue.map(p => p.url));

                    for (let i = 0; i < productQueue.length; i++) {
                        // LIMIT RE-INTRODUCED: Limit to 1000 products per category for demo.
                        // Limit check
                        if (allProducts.length + i >= limit) {
                            logger.info(`🛑 LIMIT REACHED: Stopped at ${limit} products for ${categoryName}.`);
                            // Remove unprocessed items
                            productQueue.splice(i);
                            hasMore = false;
                            break;
                        }

                        const product = productQueue[i];
                        logger.info(`[Page ${pageIndex}] [${i + 1}/${productQueue.length}] Fetching details for: ${product.name ? product.name.substring(0, 50) : product.url}...`);

                        try {
                            const details = await crawlProductDetails(product.url, browser);
                            if (details) {
                                // Merge detail data
                                // Update the product object in the queue (or create a new one if it was just a raw variant)
                                const failedProduct = {
                                    ...product,
                                    ...details,
                                    // Use detail images if available, otherwise fall back to category image as array
                                    images: details.images && details.images.length > 0
                                        ? details.images
                                        : (product.image ? [product.image] : [])
                                };

                                // Update the item in the queue with full details
                                productQueue[i] = failedProduct;

                                // HANDLE DISCOVERED COLOR VARIANTS
                                if (details.colorVariants && details.colorVariants.length > 0) {
                                    logger.info(`   🎨 Found ${details.colorVariants.length} color variants.`);

                                    for (const variant of details.colorVariants) {
                                        // Check if we've already seen this variant URL
                                        if (!processedUrls.has(variant.url)) {
                                            logger.info(`      -> Adding new variant to queue: ${variant.color} (${variant.url})`);

                                            // Add to queue
                                            productQueue.push({
                                                url: variant.url,
                                                name: `${product.name} - ${variant.color}`, // Temporary name until scraped
                                                productId: extractProductId(variant.url),
                                                image: product.image, // Temporary placeholder
                                                price: product.price  // Temporary placeholder
                                            });

                                            // Mark as seen
                                            processedUrls.add(variant.url);
                                        }
                                    }
                                }
                            }
                        } catch (error) {
                            logger.error(`Failed to fetch details for ${product.url}: ${error.message}`);
                        }

                        // Small delay between requests to be respectful
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }

                    // Replace newProducts with the fully processed productQueue
                    // This ensures all discovered variants are included in the batch
                    // We need to clear the original array and push the new items
                    newProducts.length = 0;
                    newProducts.push(...productQueue);
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

        // Resource Blocking (Enabled for reliability/speed)
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'font', 'stylesheet', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        logger.info(`Fetching details for: ${url.substring(0, 50)}...`);
        
        // RETRY LOGIC for Connection Closed / Timeouts
        const MAX_RETRIES = 3;
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (attempt > 1) logger.info(`   🔄 Retry attempt ${attempt}/${MAX_RETRIES} for ${url}...`);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
                lastError = null;
                break; // Success
            } catch (err) {
                lastError = err;
                if (err.message.includes('Connection closed') || err.message.includes('Timeout')) {
                     // Wait before retry
                     await new Promise(r => setTimeout(r, 5000));
                     // If browser crashed, we might need a new page, but usually page.goto throws.
                     // Ideally we'd restart browser but let's try simple retry first.
                     continue; 
                } else {
                    throw err; // Other errors, rethrow
                }
            }
        }

        if (lastError) throw lastError;

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
                // Priority: 1. Name Regex (Most reliable based on inspection) 2. JSON attributes
                let groupCode = productData.modelCode || productData.productGroupId;

                // Try to extract from Name (e.g. "Bluz TWOAW26BZ00138")
                // Regex looks for 8+ uppercase alphanumeric chars at the end of string or usually appearing as a code
                const nameModelMatch = productData.name ? productData.name.match(/\b([A-Z0-9]{8,})\b/) : null;
                if (nameModelMatch) {
                    groupCode = nameModelMatch[1];
                }

                // Fallbacks from JSON
                if (!groupCode) {
                    groupCode = productData.productCode ||
                        productData.contentGroup ||
                        (productData.attributes ? productData.attributes.find(a => a.key === 'modelCode')?.value : null);
                }

                // Add to product data
                productData.groupCode = groupCode;

                // EXTRACT COLOR
                // 1. Try JSON
                let extractedColor = productData.color || (productData.attributes ? productData.attributes.find(a => a.key === 'Renk' || a.key === 'Color' || a.shareableKey === 'Renk')?.value : null);

                // 2. Try DOM (Renk: X)
                if (!extractedColor) {
                    // Look for elements containing "Renk:"
                    const colorLabel = Array.from(document.querySelectorAll('span, div, p, label')).find(el => el.innerText.includes('Renk:'));
                    if (colorLabel) {
                        // Likely "Renk: Siyah" or sibling
                        const text = colorLabel.innerText;
                        const parts = text.split(':');
                        if (parts.length > 1) {
                            extractedColor = parts[1].trim();
                        } else {
                            // Maybe sibling?
                            const sibling = colorLabel.nextElementSibling;
                            if (sibling) extractedColor = sibling.innerText.trim();
                        }
                    }
                }

                productData.color = extractedColor || 'Default';

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

                // --- CRITICAL FIX: Extract Color Variants from JSON-LD ---
                const colorVariants = [];
                try {
                    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
                    const productGroupScript = scripts.find(s => s.innerText.includes('"@type":"ProductGroup"') || s.innerText.includes('"@type": "ProductGroup"'));

                    if (productGroupScript) {
                        const jsonLd = JSON.parse(productGroupScript.innerText);
                        const hasVariant = jsonLd.hasVariant || jsonLd['hasVariant'];

                        if (hasVariant && Array.isArray(hasVariant)) {
                            hasVariant.forEach(v => {
                                if (v.offers && v.offers.url) {
                                    colorVariants.push({
                                        url: v.offers.url,
                                        color: v.color,
                                        name: v.name,
                                        sku: v.sku
                                    });
                                }
                            });
                        }
                    }
                } catch (e) {
                    // console.error('Error parsing JSON-LD for variants', e);
                }

                return { product: productData, colorVariants };
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

        if (page) await page.close();
        if (!existingBrowser && browser) await browser.close();

        if (detailData && (detailData.product || detailData.isFallback)) {
            const prod = detailData.product || {};

            // CLEAN DATA EXTRACTION
            // 1. Description: DOM > Product Description > Empty
            let finalDescription = prod.description || '';

            // 2. Images: Product Images > Fallback Image
            let finalImages = [];
            if (prod.images && Array.isArray(prod.images)) {
                finalImages = prod.images;
            } else if (prod.image) {
                finalImages = [prod.image];
            }

            // 3. Sizes/Variants
            let finalSizes = [];
            if (prod.variants && Array.isArray(prod.variants)) {
                finalSizes = prod.variants.map(v => ({
                    name: v.value,
                    inStock: v.inStock,
                    barcode: v.barcode,
                    price: v.price?.value
                }));
            }

            // Return CLEAN structure
            // domDescription is not available here, it's used inside evaluate to populate prod.description
            const descriptionToUse = prod.description || '';

            // 4. Price: Robust extraction

            let finalPrice = 0;
            if (typeof prod.price === 'number') {
                finalPrice = prod.price;
            } else if (prod.price) {
                finalPrice = prod.price.sellingPrice?.value
                    || prod.price.discountedPrice?.value
                    || prod.price.value
                    || 0;
            }

            return {
                productId: prod.productId || prod.id,
                name: prod.name,
                category: prod.category?.name || 'Unknown',
                brand: prod.brand?.name || "Trendyol",
                price: finalPrice,
                description: descriptionToUse,
                images: finalImages,
                sizes: finalSizes,
                url: url,
                colorVariants: detailData.colorVariants || []
            };
        }

        logger.warn(`No product detail data found for ${url}`);
        return null;

    } catch (error) {
        logger.error(`Failed to fetch details for ${url}: ${error.message} `);
        if (page) await page.close();
        if (!existingBrowser && browser) await browser.close();
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
