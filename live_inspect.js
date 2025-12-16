const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        console.log('Navigating...');
        await page.goto('https://www.trendyol-milla.com/sr?wb=101476,103500,143760,148061,165523&lc=1092&qt=trendyolmilla&st=trendyolmilla&os=1', { waitUntil: 'networkidle2', timeout: 60000 });

        console.log('Page title:', await page.title());

        // Check for window variables
        const windowKeys = await page.evaluate(() => Object.keys(window).filter(k => k.startsWith('__')));
        console.log('Window keys starting with __:', windowKeys);

        // Check for product cards in DOM
        const cardCount = await page.evaluate(() => document.querySelectorAll('.p-card-wrppr').length);
        console.log('Card count (.p-card-wrppr):', cardCount);

        // Dump innerText to see if we have content
        const text = await page.evaluate(() => document.body.innerText.substring(0, 500));
        console.log('Body Text Snippet:', text.replace(/\n/g, ' '));

        // Dump potential JSON hydration
        const hydrationData = await page.evaluate(() => {
            if (window.__SEARCH_APP_INITIAL_STATE__) return 'Found __SEARCH_APP_INITIAL_STATE__';
            if (window.__PRODUCT_LIST_APP_INITIAL_STATE__) return 'Found __PRODUCT_LIST_APP_INITIAL_STATE__';
            return 'No standard hydration found';
        });
        console.log('Hydration check:', hydrationData);

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
    }
})();
