const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('page_dump_kazak.html', 'utf8');
const $ = cheerio.load(html);

$('script').each((i, el) => {
    const content = $(el).html() || '';
    if (content.length > 500) {
        console.log(`Script ${i} length: ${content.length}`);
        if (content.includes('"price"')) console.log(`  - Contains "price"`);
        if (content.includes('"id"')) console.log(`  - Contains "id"`);
        console.log(`  - Start: ${content.substring(0, 50).replace(/\n/g, '')}...`);
    }
});
