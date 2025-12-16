try {
    const ex = require('./src/scraper/extractor');
    console.log('Extractor loaded successfully');
} catch (e) {
    console.error('Syntax Error:', e.message);
}
