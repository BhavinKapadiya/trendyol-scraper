const fs = require('fs');

const files = ['live_output.txt', 'bracket_debug.txt', 'blob_output.txt', 'debug_output.txt'];

files.forEach(f => {
    if (fs.existsSync(f)) {
        try {
            // Try reading as utf-16le first (since powershell redirection often does this)
            let content = fs.readFileSync(f, 'utf16le');
            // If it looks like garbage, maybe it was utf8?
            // But 'view_file' complained about utf-16le, so it probably is.
            fs.writeFileSync(f + '.utf8', content, 'utf8');
        } catch (e) {
            // Try utf8
            try {
                let content = fs.readFileSync(f, 'utf8');
                fs.writeFileSync(f + '.utf8', content, 'utf8');
            } catch (e2) { }
        }
    }
});
