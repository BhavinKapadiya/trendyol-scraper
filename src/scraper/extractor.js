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
        let color = null;
        if (product.slicingAttributes) {
            color = product.slicingAttributes.DsmColor ||
                product.slicingAttributes.color ||
                null;
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

        // Extract all images with high-resolution URLs
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

        return {
            sku,
            color,
            sizes,
            availability: hasStock,
            stockCount,
            brand,
            description,
            images
        };

    } catch (error) {
        logger.error(`Error extracting product details: ${error.message}`);
        return null;
    }
}

module.exports = { extractProductData, extractProductDetails };
