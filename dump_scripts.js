const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('page_dump_kazak.html', 'utf8');
const $ = cheerio.load(html);

const indices = [7, 23];
indices.forEach(i => {
    const content = $('script').eq(i).html();
    if (content) {
        fs.writeFileSync(`script_${i}.js`, content);
        console.log(`Wrote script_${i}.js (${content.length} chars)`);
    } else {
        console.log(`Script ${i} empty`);
    }
});
