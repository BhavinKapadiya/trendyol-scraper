const cheerio = require('cheerio');
const logger = require('../utils/logger');

function extractProductData(html, categoryName, hydrationData) {
    const $ = cheerio.load(html);

    // Check for hydration data (passed from crawler)
    const data = hydrationData && hydrationData.data ? hydrationData.data : hydrationData;

    if (data && data.products) {
        console.log(`[Extractor] Using hydration data with ${data.products.length} products`);
        const dt = new Date().toISOString();

        return data.products.map(p => {
            // Construct full URL
            let productUrl = p.url;
            if (!productUrl.startsWith('http')) {
                productUrl = 'https://www.trendyol-milla.com' + productUrl;
            }

            return {
                category: p.category ? p.category.name : categoryName,
                name: p.name,
                price: p.price ? p.price.current : 0,
                rating: p.ratingScore ? p.ratingScore.averageRating : 0,
                popularity: p.socialProof ? (p.socialProof.find(s => s.key === 'favoriteCount') || {}).value : 'N/A',
                image: p.images && p.images.length > 0 ? p.images[0] : (p.image || ''),
                url: productUrl,
                timestamp: dt
            };
        });
    }

    const products = [];
    // Fallback to DOM selectors (legacy)
    const cards = $('.p-card-wrppr');

    if (cards.length === 0) {
        logger.warn('No product cards found with selector .p-card-wrppr. HTML might be different or empty.');
    }

    cards.each((i, element) => {
        try {
            const el = $(element);
            const linkTag = el.find('a').first();
            const productUrl = 'https://www.trendyol-milla.com' + linkTag.attr('href');

            // Image
            const imgTag = el.find('.p-card-img');
            const imageUrl = imgTag.attr('src');

            // Description / Brand
            const brand = el.find('.prdct-desc-cntnr-ttl').text().trim();
            const name = el.find('.prdct-desc-cntnr-name').text().trim();
            const productName = `${brand} ${name}`;

            // Price
            const priceText = el.find('.prc-box-vrntd').text().trim();
            const price = parseFloat(priceText.replace('TL', '').replace(/\./g, '').replace(',', '.').trim());

            if (productName && price) {
                products.push({
                    category: categoryName,
                    productName,
                    price,
                    currency: 'TRY',
                    imageUrl,
                    productUrl,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (e) {
            logger.error(`Error extracting product: ${e.message}`);
        }
    });

    return products;
}

// Extract variant links from JSON-LD ProductGroup schema
function extractVariantLinks(htmlContent) {
    try {
        const $ = cheerio.load(htmlContent);
        const jsonLdScripts = $('script[type="application/ld+json"]');
        
        for (let i = 0; i < jsonLdScripts.length; i++) {
            try {
                const scriptContent = $(jsonLdScripts[i]).html();
                if (!scriptContent) continue;
                
                const json = JSON.parse(scriptContent);
                
                // Check if this is a ProductGroup with variants
                if (json['@type'] === 'ProductGroup' && json.hasVariant && Array.isArray(json.hasVariant)) {
                    logger.info(`   [Variant Discovery] Found ${json.hasVariant.length} color variants in ProductGroup`);
                    
                    const variants = json.hasVariant.map(variant => {
                        const url = variant.url || variant['@id'] || variant.offers?.url;
                        if (!url) {
                            logger.warn(`   [Variant Discovery] Variant missing URL: ${JSON.stringify(variant).substring(0, 100)}`);
                        }
                        return {
                            productId: variant.sku,
                            url: url,
                            color: variant.color,
                            name: variant.name
                        };
                    }).filter(v => v.url); // Only return variants with valid URLs
                    
                    logger.info(`   [Variant Discovery] ${variants.length} variants have valid URLs`);
                    return variants;
                }
            } catch (parseError) {
                // Skip invalid JSON-LD blocks
                continue;
            }
        }
        
        // No variants found
        return [];
    } catch (error) {
        logger.error(`Error extracting variant links: ${error.message}`);
        return [];
    }
}

// Extract detailed product information from product detail page
function extractProductDetails(detailData) {
    try {
        const product = detailData.product || detailData;

        if (!product) {
            return null;
        }

        // Extract SKU/Product Code
        const sku = product.productCode || null;

        // Extract color from slicingAttributes
        // Extract color from slicingAttributes or Attributes or Fallback
        let color = null;
        
        // 1. Try explicit fallback from Crawler DOM extraction
        if (detailData.extractedColor || (product.fallbackColor)) {
             color = detailData.extractedColor || product.fallbackColor;
        }

        // 2. Try Attributes (Array search)
        if (!color && product.attributes && Array.isArray(product.attributes)) {
            const colorAttr = product.attributes.find(a => a.key === 'Renk' || a.name === 'Renk');
            if (colorAttr) {
                color = colorAttr.value.name || colorAttr.value;
            }
        }

        // 3. Try Slicing Attributes (Legacy/Standard)
        if (!color && product.slicingAttributes) {
            color = product.slicingAttributes.DsmColor ||
                product.slicingAttributes.color ||
                null;
        }

        // Clean up color (remove codes like "-1001" if purely numeric/code-like suffix, but keep valid names)
        // Example: "Siyah-1001" -> "Siyah"
        if (color && color.includes('-')) {
             // Heuristic: If suffix is digits, strip it
             const parts = color.split('-');
             if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
                 parts.pop();
                 color = parts.join('-');
             }
        }

        // Extract sizes and availability from variants
        const sizes = [];
        let hasStock = false;

        if (product.variants && Array.isArray(product.variants)) {
            product.variants.forEach(variant => {
                // Handle different variant structures (Envoy vs legacy)
                const sizeName = variant.beautifiedValue || 
                               variant.value || 
                               variant.attributeValue || 
                               variant.name || 
                               'Unknown';
                
                const variantPrice = variant.price?.value || 
                                   variant.price?.sellingPrice?.value || 
                                   product.winnerVariant?.price?.sellingPrice?.value || 
                                   null;
                
                const sizeInfo = {
                    name: sizeName,
                    inStock: variant.inStock === true,
                    barcode: variant.barcode || null,
                    price: variantPrice
                };
                sizes.push(sizeInfo);

                if (sizeInfo.inStock) {
                    hasStock = true;
                }
            });
        }

        // Get stock count if available
        let stockCount = null;
        if (product.winnerVariant && product.winnerVariant.quantity !== undefined) {
            stockCount = product.winnerVariant.quantity;
        }

        // Get brand if available
        const brand = product.brand ? product.brand.name : null;

        // Get description if available (prioritize DOM extraction)
        const description = product.domDescription || product.description || null;

        // Resulting extracted images
        const images = [];
        if (product.images && Array.isArray(product.images)) {
            product.images.forEach(img => {
                let imageUrl = img.url || img;
                
                // Handle relative URLs
                if (imageUrl && !imageUrl.startsWith('http')) {
                    imageUrl = 'https://cdn.dsmcdn.com' + imageUrl;
                }
                
                // Convert thumbnail URLs to full resolution
                if (imageUrl && imageUrl.includes('/mnresize/')) {
                    imageUrl = imageUrl.replace('/mnresize/400/-/', '/');
                    imageUrl = imageUrl.replace('/mnresize/600/-/', '/');
                }
                
                if (imageUrl) {
                    images.push(imageUrl);
                }
            });
        }

        // EXTRACT GROUP CODE (For merging color variants)
        const groupCode = product.productGroupId ||
            product.productCode ||
            product.contentGroup ||
            product.modelCode ||
            (product.attributes ? product.attributes.find(a => a.key === 'modelCode')?.value : null) ||
            sku; // Fallback to SKU if nothing else found

        // EXTRACT PRICE (for queue variants) - Always return a number!
        let price = null;
        if (product.price) {
            // Try to extract numeric value from various price structures
            const priceValue = product.price.sellingPrice?.value || 
                              product.price.originalPrice?.value || 
                              product.price.discountedPrice?.value ||
                              product.price.value ||  // If price is object with value property
                              product.price;          // If price is already a number
            
            // Ensure it's a number
            price = typeof priceValue === 'number' ? priceValue : parseFloat(priceValue) || null;
        } else if (product.winnerVariant?.price) {
            const priceValue = product.winnerVariant.price.sellingPrice?.value || 
                              product.winnerVariant.price.value;
            price = typeof priceValue === 'number' ? priceValue : parseFloat(priceValue) || null;
        }

        // EXTRACT RATING (for queue variants)
        const rating = product.ratingScore?.averageRating || 
                      product.rating || 
                      0;

        // EXTRACT POPULARITY (for queue variants)  
        const popularity = product.socialProof?.find(s => s.key === 'favoriteCount')?.value || 
                          product.favoriteCount ||
                          'N/A';

        // Use first image as main image if images array exists
        const image = images.length > 0 ? images[0] : null;

        return {
            sku,
            groupCode,
            color,
            sizes,
            availability: hasStock,
            stockCount,
            brand,
            description,
            images,
            price,
            rating,
            popularity,
            image
        };

    } catch (error) {
        logger.error(`Error extracting product details: ${error.message}`);
        return null;
    }
}
module.exports = { extractProductData, extractProductDetails, extractVariantLinks };
