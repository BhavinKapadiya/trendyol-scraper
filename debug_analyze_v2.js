const fs = require('fs');
const log = (msg) => fs.appendFileSync('debug_output.txt', msg + '\n');

log('Script started');
try {
    const html = fs.readFileSync('page_dump_kazak.html', 'utf8');
    log('File read, size: ' + html.length);
    const cheerio = require('cheerio');
    log('Cheerio required');
    const $ = cheerio.load(html);
    log('Cheerio loaded');
    log('Title: ' + $('title').text());

    // Check for scripts
    $('script').each((i, el) => {
        const c = $(el).html() || '';
        if (c.includes('__SEARCH_APP_INITIAL_STATE__') || c.includes('window.__')) {
            log(`Found global var in script ${i}`);
        }
    });
} catch (e) {
    log('Error: ' + e.message);
}
