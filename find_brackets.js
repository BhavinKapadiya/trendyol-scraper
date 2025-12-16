const fs = require('fs');
const html = fs.readFileSync('page_dump_kazak.html', 'utf8');

const regex = /window\["(.+?)"\]\s*=/g;
let match;
const log = (msg) => fs.appendFileSync('bracket_debug.txt', msg + '\n');

while ((match = regex.exec(html)) !== null) {
    log(`Found key: ${match[1]}`);
}

if (html.includes('__single-search-result_preload-images__PROPS')) {
    log('Confirmed __single...PROPS exists via string include');
} else {
    log('Could NOT find __single...PROPS via string include');
}
