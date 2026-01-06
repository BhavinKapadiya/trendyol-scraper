const fs = require('fs');
const path = require('path');

const inputFile = path.resolve(__dirname, '../../products.json');
const outputFile = path.resolve(__dirname, '../../products_clean.json');

console.log('🧹 STARTING CLEANUP...');
console.log(`Reading from: ${inputFile}`);

try {
    const rawData = fs.readFileSync(inputFile, 'utf8');
    const products = JSON.parse(rawData);

    console.log(`Found ${products.length} products. Processing...`);

    const cleanProducts = products.map((item, index) => {
        // EXTRACT DESCRIPTION
        // Priority: item.description -> item.product.description
        let description = item.description;
        if (!description || description.trim() === "") {
            if (item.product && item.product.description) {
                description = item.product.description;
            }
        }

        // EXTRACT IMAGES
        // Priority: item.product.images -> item.images -> item.image
        let images = [];
        if (item.product && item.product.images && Array.isArray(item.product.images)) {
            images = item.product.images;
        } else if (item.images && Array.isArray(item.images)) {
            images = item.images;
        } else if (item.image) {
            images = [item.image];
        }

        // EXTRACT VARIANTS / SIZES
        // The crawler usually puts processed sizes in item.sizes
        // But if that's missing, we can look at item.product.variants
        let sizes = item.sizes;
        // If sizes is missing or empty, try to rebuild it from raw variants
        if ((!sizes || sizes.length === 0) && item.product && item.product.variants) {
            sizes = item.product.variants.map(v => ({
                name: v.value,
                inStock: v.inStock,
                barcode: v.barcode,
                price: v.price?.value
            }));
        }

        // ATTRIBUTES (Optional, for tags)
        // We can extract some key attributes for tags
        let tags = [`category:${item.category.toLowerCase()}`, 'trendyol', 'auto-imported'];
        if (item.product && item.product.attributes) {
            // Add top 5 attributes as tags
            item.product.attributes.slice(0, 5).forEach(attr => {
                if (attr.value && attr.value.name) {
                    tags.push(`${attr.key.name}:${attr.value.name}`);
                }
            });
        }

        return {
            productId: item.productId,
            name: item.name,
            category: item.category,
            brand: item.product?.brand?.name || "Trendyol",
            price: item.price,
            description: description || "", // Ensure it's not undefined
            images: images,
            sizes: sizes,
            tags: tags,
            url: item.url
        };
    });

    // Write to new file
    fs.writeFileSync(outputFile, JSON.stringify(cleanProducts, null, 2));

    console.log('========================================');
    console.log(`✅ CLEANUP COMPLETE`);
    console.log(`Saved ${cleanProducts.length} clean products to: ${outputFile}`);
    console.log('========================================');

    // Log the first product to verify
    if (cleanProducts.length > 0) {
        console.log('\nPREVIEW (First Product):');
        console.log('Name:', cleanProducts[0].name);
        console.log('Description Length:', cleanProducts[0].description.length);
        console.log('Image Count:', cleanProducts[0].images.length);
        console.log('Images:', cleanProducts[0].images);
    }

} catch (error) {
    console.error('❌ ERROR:', error.message);
}
