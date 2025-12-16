const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        console.log('Navigating to https://www.trendyol-milla.com/');
        const response = await page.goto('https://www.trendyol-milla.com/', { waitUntil: 'domcontentloaded' });
        console.log('Final URL:', page.url());
        console.log('Status:', response.status());

        // Check if it redirected to trendyol.com
        if (page.url().includes('trendyol.com')) {
            console.log('Redirected to trendyol.com domain.');
        } else {
            console.log('Stayed on trendyol-milla.com (or other).');
        }
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await browser.close();
    }
})();
