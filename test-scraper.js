const { crawlProductDetails } = require('./src/scraper/crawler');
const logger = require('./src/utils/logger');

// Test URL from the user's example
const testUrl = 'https://www.trendyol-milla.com/trendyolmilla/lacivert-slogan-nakisli-dugme-detayli-regular-kalip-kalin-ici-polarli-orme-sweatshirt-twoaw25sw00015-p-831637641';

async function test() {
    logger.info('🧪 Testing product details extraction...\n');
    logger.info(`URL: ${testUrl}\n`);

    try {
        const details = await crawlProductDetails(testUrl);
        
        if (!details) {
            logger.error('❌ No details returned!');
            return;
        }

        logger.info('✅ Product details extracted successfully!\n');
        
        // Check for isFallback flag
        if (details.product && details.product.isFallback) {
            logger.warn('⚠️  WARNING: Still using fallback extraction!');
        } else {
            logger.info('✅ Using proper JSON extraction (not fallback)');
        }
        
        // Check images
        const images = details.product?.images || details.images || [];
        logger.info(`\n📸 Images found: ${images.length}`);
        if (images.length > 0) {
            logger.info(`   First image: ${images[0].substring(0, 80)}...`);
            logger.info(`   Last image: ${images[images.length - 1].substring(0, 80)}...`);
        }
        
        // Check variants/sizes
        const sizes = details.sizes || [];
        logger.info(`\n👕 Sizes/Variants found: ${sizes.length}`);
        if (sizes.length > 0) {
            sizes.forEach((size, i) => {
                logger.info(`   ${i + 1}. ${size.name} - ${size.inStock ? '✅ In Stock' : '❌ Out of Stock'}${size.price ? ` - ${size.price} TL` : ''}`);
            });
        }
        
        // Check price
        const price = details.product?.winnerVariant?.price?.sellingPrice?.value || 
                     details.product?.price?.sellingPrice?.value || 
                     'Not found';
        logger.info(`\n💰 Price: ${price} TL`);
        
        // Full output for review
        logger.info('\n📋 Full extracted data:');
        console.log(JSON.stringify(details, null, 2));
        
    } catch (error) {
        logger.error(`❌ Test failed: ${error.message}`);
        console.error(error);
    }
}

test();
