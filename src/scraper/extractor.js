const cheerio = require('cheerio');
const logger = require('../utils/logger');

function extractProductData(html, categoryName, hydrationData) {
    const $ = cheerio.load(html);

    // Check for hydration data (passed from crawler)
    // hydrationData might be the full object or just the data property
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
                category: p.category ? p.category.name : 'Unknown',
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
            // Price often has discounted and selling price. We want the selling price.
            const priceText = el.find('.prc-box-vrntd').text().trim();
            // Parse price (e.g., "129,99 TL")
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

module.exports = { extractProductData };
