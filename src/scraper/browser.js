const puppeteer = require('puppeteer');
const logger = require('../utils/logger');

async function startBrowser() {
    logger.info('Starting browser...');
    try {
        const browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            defaultViewport: null,
        });
        return browser;
    } catch (error) {
        logger.error(`Failed to start browser: ${error.message}`);
        throw error;
    }
}

module.exports = { startBrowser };
