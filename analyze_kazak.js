const fs = require('fs');
const cheerio = require('cheerio');

try {
    const html = fs.readFileSync('page_dump_kazak.html', 'utf8');
    const $ = cheerio.load(html);

    console.log('Title:', $('title').text());

    // Check for JSON data in scripts
    $('script').each((i, el) => {
        const content = $(el).html() || '';
        if (content.includes('window.__')) {
            console.log(`Found window global in script ${i}: ${content.substring(0, 100)}...`);
        }
        if (content.includes('"products"')) {
            console.log(`Found "products" key in script ${i}`);
        }
    });

    // List all unique classes on divs to spot patterns
    const classes = new Set();
    $('div').each((i, el) => {
        const cls = $(el).attr('class');
        if (cls) {
            cls.split(/\s+/).forEach(c => classes.add(c));
        }
    });

    console.log('Unique classes found:', classes.size);
    console.log('Sample classes:', Array.from(classes).slice(0, 50).join(', '));

    // Check for common product containers even if class names are obfuscated
    // e.g. look for <a> tags with hrefs containing 'ty' or 'product'
    const productLinks = [];
    $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && (href.includes('-p-') || href.includes('/p/'))) {
            productLinks.push(href);
        }
    });
    console.log(`Found ${productLinks.length} potential product links.`);
    if (productLinks.length > 0) {
        console.log('Sample link:', productLinks[0]);
        // Analyze parent of this link
        const parentClass = $('a[href="' + productLinks[0] + '"]').parent().attr('class');
        console.log('Parent class of product link:', parentClass);
    }

} catch (e) {
    console.error('Error analyzing:', e);
}
