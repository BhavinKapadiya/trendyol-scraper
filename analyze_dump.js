const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('page_dump_v2.html', 'utf8');
const $ = cheerio.load(html);

console.log('Analyzing scripts...');
$('script').each((i, el) => {
    const content = $(el).html();
    if (content && content.includes('"price"')) {
        console.log(`Found "price" in script index ${i}`);
        console.log('Snippet:', content.substring(0, 500));
        // Try to identify variable name
        const match = content.match(/window\.(.+?)\s*=/);
        if (match) {
            console.log('Variable:', match[1]);
        }
    }
});

// Also check for "p-card" structure in body for sanity
if (html.includes('p-card')) {
    console.log('Found "p-card" string in HTML');
} else {
    console.log('"p-card" NOT found in HTML');
}
