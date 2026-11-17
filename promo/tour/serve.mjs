// Static server for the tour: serves the repo root so the page can import the built package.
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const types = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.html': 'text/html',
    '.json': 'application/json',
    '.map': 'application/json',
    '.avif': 'image/avif',
    '.png': 'image/png',
    '.atlas': 'text/plain',
};

export function serve(port = 0) {
    const server = createServer((req, res) => {
        let file = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));

        try {
            if (!file.startsWith(root)) throw new Error('outside');
            if (statSync(file).isDirectory()) file = join(file, 'index.html');
            res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
            res.end(readFileSync(file));
        } catch {
            res.statusCode = 404;
            res.end();
        }
    });

    return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const server = await serve(Number(process.argv[2] ?? 5199));

    console.log(`http://127.0.0.1:${server.address().port}/promo/tour/`);
}
