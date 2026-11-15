#!/usr/bin/env node
/**
 * Serves the built site to the phones of the local network, for the pages of the lab. It
 * serves apps/site/dist, the production build, so a phone runs the code a host would serve.
 * It also takes the result that a lab page sends at its end and writes it into
 * apps/site/lab-results as a JSON file, which git ignores. A phone so leaves its result on
 * this computer, and nobody has to copy it by hand.
 *
 * The phone must be in the same network. It reaches the server over plain HTTP, where a
 * browser offers WebGL2 but no WebGPU, no clipboard and no share sheet.
 *
 * The server listens on every address of the computer, so that a phone reaches it. Anyone in
 * the network can so send it results. A result has a size limit, the folder keeps a limited
 * number of them, and an address that does not decode is answered with 400.
 *
 * usage: node scripts/lab-serve.mjs [--port=5180]   (from apps/site, after `pnpm build`)
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = fileURLToPath(new URL('..', import.meta.url));
const dist = join(site, 'dist');
const results = join(site, 'lab-results');
const port = Number(/^--port=(\d+)$/.exec(process.argv[2] ?? '')?.[1] ?? 5180);
/** The largest result a page may send, in bytes. */
const LIMIT = 256 * 1024;
/** The most results the folder keeps. Delete some to make room for more. */
const MOST_RESULTS = 500;
/** A test name as the lab pages have them, such as how-many. */
const TEST_NAME = /^[a-z]+(-[a-z]+)*$/;
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.avif': 'image/avif',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.atlas': 'text/plain; charset=utf-8',
    '.skel': 'application/octet-stream',
    '.woff2': 'font/woff2',
};

if (!existsSync(join(dist, 'lab', 'index.html'))) {
    console.error('lab-serve: apps/site/dist has no lab. Run `pnpm build` in apps/site first.');
    process.exit(1);
}

/** Answers with a status and a short text. */
function answer(response, status, text = '') {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(text);
}

/** Writes one result and says where. Throws for a body that is no result. */
function keep(body) {
    const result = JSON.parse(body);

    if (typeof result?.test !== 'string' || result.test.length > 30 || !TEST_NAME.test(result.test)) {
        throw new Error('no test name');
    }
    const stamp = new Date().toISOString().replace(/\..*/, '').replaceAll(':', '-');
    const file = `${stamp}-${result.test}-${Math.random().toString(36).slice(2, 6)}.json`;

    mkdirSync(results, { recursive: true });
    writeFileSync(join(results, file), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`lab-serve: kept ${file}, ${String(result.device?.name ?? 'unknown device')}`);
}

/** How many results the folder holds. */
function resultCount() {
    return existsSync(results) ? readdirSync(results).filter((name) => name.endsWith('.json')).length : 0;
}

/** Takes a result that a lab page sends. A body over the limit ends the request at once. */
function receive(request, response) {
    const chunks = [];
    let size = 0;
    let refused = false;
    const refuse = (status, text) => {
        refused = true;
        // the connection closes after the answer, so the rest of the body is not read
        response.setHeader('connection', 'close');
        answer(response, status, text);
        request.resume();
    };

    if (resultCount() >= MOST_RESULTS) return refuse(507, `the folder holds ${MOST_RESULTS} results already`);
    if (Number(request.headers['content-length'] ?? 0) > LIMIT) return refuse(413, 'too large');
    request.on('data', (chunk) => {
        if (refused) return;
        size += chunk.length;
        if (size > LIMIT) refuse(413, 'too large');
        else chunks.push(chunk);
    });
    request.on('error', () => {
        refused = true;
    });
    request.on('end', () => {
        if (refused) return;
        try {
            keep(Buffer.concat(chunks).toString('utf8'));
            answer(response, 201);
        } catch {
            answer(response, 400, 'no result');
        }
    });
}

/** The file of a decoded path in dist: a folder serves its index.html. Null outside dist or for no file. */
function fileOf(pathname) {
    const path = normalize(join(dist, pathname));

    if (path !== dist && !path.startsWith(dist + sep)) return null;
    if (existsSync(path) && statSync(path).isDirectory()) return fileOf(`${pathname.replace(/\/?$/, '/')}index.html`);

    return existsSync(path) ? path : null;
}

/** A path of an address with its escapes decoded, or null where one does not decode, as in %E0%A4%A. */
function decoded(pathname) {
    try {
        const path = decodeURIComponent(pathname);

        return path.includes('\0') ? null : path;
    } catch {
        return null;
    }
}

const server = createServer((request, response) => {
    const { pathname: raw } = new URL(request.url ?? '/', 'http://lab');
    const pathname = decoded(raw);

    if (pathname === null) return answer(response, 400, 'bad address');
    if (request.method === 'POST' && pathname === '/lab-results') return receive(request, response);
    if (request.method !== 'GET' && request.method !== 'HEAD') return answer(response, 405);
    // the site has trailing slashes on every page
    if (!pathname.endsWith('/') && extname(pathname) === '' && fileOf(`${pathname}/`) !== null) {
        response.writeHead(301, { location: `${raw}/` });

        return response.end();
    }
    const file = fileOf(pathname);

    if (file === null) return answer(response, 404, 'not found');
    response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
    });
    if (request.method === 'HEAD') return response.end();
    // a file that cannot be read ends the answer, and not the server
    createReadStream(file)
        .on('error', () => response.destroy())
        .pipe(response);
});

server.listen(port, '0.0.0.0', () => {
    const addresses = Object.values(networkInterfaces())
        .flat()
        .filter((net) => net?.family === 'IPv4' && !net.internal)
        .map((net) => net.address);

    console.log(`lab-serve: open one of these on a phone in the same network:`);
    for (const address of addresses) console.log(`  http://${address}:${port}/lab/`);
    console.log(`  http://localhost:${port}/lab/ on this computer`);
    console.log('lab-serve: results land in apps/site/lab-results');
});
