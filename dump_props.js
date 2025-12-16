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

        const props = await page.evaluate(() => {
            return window['__single-search-result__PROPS'];
        });

        if (props) {
            console.log('Found props!');
            fs.writeFileSync('props_dump.json', JSON.stringify(props, null, 2));
            console.log('Wrote props_dump.json');
        } else {
            console.log('Props not found on window.');
        }

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
    }
})();
