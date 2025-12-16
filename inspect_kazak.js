const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });
    const page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    const targetUrl = 'https://www.trendyol-milla.com/sr?wb=101476,103500,143760,148061,165523&lc=1092&qt=trendyolmilla&st=trendyolmilla&os=1';

    try {
        console.log(`Navigating to ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        console.log('Final URL:', page.url());

        // Check for product card wrapper
        try {
            await page.waitForSelector('.p-card-wrppr', { timeout: 10000 });
            console.log('Found .p-card-wrppr');
        } catch {
            console.log('Did not find .p-card-wrppr');
        }

        // Dump content
        const content = await page.content();
        fs.writeFileSync('page_dump_kazak.html', content);
        console.log('Dumped to page_dump_kazak.html');

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
    }
})();
