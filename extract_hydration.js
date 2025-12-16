const fs = require('fs');
const log = (msg) => fs.appendFileSync('hydration_debug.txt', msg + '\n');

try {
    const html = fs.readFileSync('page_dump_kazak.html', 'utf8');
    log('HTML size: ' + html.length);

    // Look for window.__VARIABLE__ = { ... }
    const regex = /window\.(\w+)\s*=\s*(\{.*?\})/g;
    // This regex is risky for nested braces, but might catch the start.
    // Better: look for window.__SEARCH_APP_INITIAL_STATE__ explicitly.

    let match;
    // We'll scan for specific known keys first
    const knownKeys = ['__SEARCH_APP_INITIAL_STATE__', '__PRODUCT_LIST_APP_INITIAL_STATE__', '__initialState'];

    for (const key of knownKeys) {
        const idx = html.indexOf(key);
        if (idx !== -1) {
            log(`Found known key: ${key} at index ${idx}`);
            const snippet = html.substring(idx, idx + 200);
            log(`Snippet: ${snippet}`);
        }
    }

    // General scan
    // We just search for the string "window.__" and print the next 50 chars
    let pos = html.indexOf('window.__');
    while (pos !== -1) {
        const end = Math.min(pos + 100, html.length);
        log(`Found window.__ at ${pos}: ${html.substring(pos, end)}`);
        pos = html.indexOf('window.__', pos + 1);
    }

    // Also search for "products"
    const pIdx = html.indexOf('"products":');
    if (pIdx !== -1) {
        log(`Found "products": at ${pIdx}`);
        log(`Snippet: ${html.substring(pIdx - 50, pIdx + 100)}`);
    }

} catch (e) {
    log('Error: ' + e.message);
}
