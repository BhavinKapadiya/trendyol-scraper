const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    // Launch args to minimize detection
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080'
        ]
    });
    const page = await browser.newPage();

    // Evasion: Overwrite webdriver property
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });
    });

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    try {
        console.log('Navigating...');
        // Try a simple category first
        await page.goto('https://www.trendyol.com/sr?q=trendyolmilla%20bluz', { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Wait for something specific
        try {
            await page.waitForSelector('.product-card-container', { timeout: 10000 }); // Try another common class
        } catch {
            console.log('Wait 1 timeout');
        }

        // Brief sleep
        await new Promise(r => setTimeout(r, 5000));

        // Get text
        const text = await page.evaluate(() => document.body.innerText);
        fs.writeFileSync('body_text.txt', text);
        console.log('Text length:', text.length);
        console.log('Text preview:', text.substring(0, 200));

        // Get HTML
        const html = await page.content();
        fs.writeFileSync('page_dump_v3.html', html);

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
    }
})();
