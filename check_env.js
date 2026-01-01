const fs = require('fs');
const path = require('path');
try {
    const envPath = path.resolve(__dirname, '.env');
    const outPath = path.resolve(__dirname, 'env_check_result.txt');

    let output = 'Checking .env at: ' + envPath + '\n';

    if (!fs.existsSync(envPath)) {
        output += '.env file NOT FOUND\n';
    } else {
        const content = fs.readFileSync(envPath, 'utf8');
        const lines = content.split('\n');
        let hasShopName = false;
        let hasToken = false;

        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('SHOPIFY_SHOP_NAME=') && trimmed.length > 'SHOPIFY_SHOP_NAME='.length) hasShopName = true;
            if (trimmed.startsWith('SHOPIFY_ACCESS_TOKEN=') && trimmed.length > 'SHOPIFY_ACCESS_TOKEN='.length) hasToken = true;
        });

        output += `SHOPIFY_SHOP_NAME found: ${hasShopName}\n`;
        output += `SHOPIFY_ACCESS_TOKEN found: ${hasToken}\n`;
    }

    fs.writeFileSync(outPath, output);

} catch (err) {
    fs.writeFileSync('env_check_result.txt', 'Error: ' + err.message);
}
