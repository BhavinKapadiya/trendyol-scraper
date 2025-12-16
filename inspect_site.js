const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // Set a real user agent to avoid bot detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        console.log('Navigating to Trendyol search page...');
        // Using a search query for Trendyolmilla Bluz
        await page.goto('https://www.trendyol.com/sr?q=trendyolmilla%20bluz', { waitUntil: 'networkidle2', timeout: 60000 });

        // Wait for at least one product card to appear
        try {
            await page.waitForSelector('.p-card-wrppr', { timeout: 10000 });
            console.log('Product cards found via .p-card-wrppr');
        } catch (e) {
            console.log('Selector .p-card-wrppr not found, dumping anyway to check structure');
        }

        const content = await page.content();
        fs.writeFileSync('page_dump_v2.html', content);
        console.log('Page dumped to page_dump_v2.html');

    } catch (e) {
        console.error('Error during inspection:', e);
    } finally {
        await browser.close();
    }
})();
