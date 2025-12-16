console.log('Script started');
const fs = require('fs');
try {
    const html = fs.readFileSync('page_dump_kazak.html', 'utf8');
    console.log('File read, size:', html.length);
    const cheerio = require('cheerio');
    console.log('Cheerio required');
    const $ = cheerio.load(html);
    console.log('Cheerio loaded');
    console.log('Title:', $('title').text());
} catch (e) {
    console.error('Error:', e);
}
