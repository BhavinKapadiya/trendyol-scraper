const https = require('https');

function checkRedirect(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            console.log(`Status: ${res.statusCode}`);
            console.log('Headers:', res.headers);
            if (res.statusCode >= 300 && res.statusCode < 400) {
                console.log(`Redirects to: ${res.headers.location}`);
            }
            resolve();
        }).on('error', (e) => {
            console.error(e);
            resolve();
        });
    });
}

(async () => {
    console.log('Checking https://www.trendyol-milla.com/');
    await checkRedirect('https://www.trendyol-milla.com/');

    console.log('\nChecking https://www.trendyol-milla.com/sr?q=kazak');
    await checkRedirect('https://www.trendyol-milla.com/sr?q=kazak');
})();
