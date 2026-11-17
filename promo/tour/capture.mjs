// Renders the tour frame by frame in headless Chrome and encodes it with ffmpeg.
//
//   node promo/tour/capture.mjs                  everything: the video, the small video, the
//                                                contact sheets and the cover, in promo/tour/out
//   node promo/tour/capture.mjs --stills=3,12    JPEG stills at those seconds, in out/stills
//   node promo/tour/capture.mjs --sheet=0,20,0.5 a contact sheet of live frames: from, to, step
//   node promo/tour/capture.mjs --cover=10.4     out/cover.png, the frame at that second
//   node promo/tour/capture.mjs --from=20 --to=30 --name=part.mp4
//
// Needs `pnpm build` first: the page imports packages/pixi-marrow/dist.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

/** The second of the tour that the cover shows. */
const COVER_AT = 15.6;
const BREW = '/opt/homebrew/bin/ffmpeg';
const FFMPEG = process.env.FFMPEG ?? (existsSync(BREW) ? BREW : 'ffmpeg');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (name) => process.argv.find((it) => it.startsWith(`--${name}=`))?.split('=')[1];
const out = fileURLToPath(new URL('./out/', import.meta.url));

mkdirSync(join(out, 'stills'), { recursive: true });

const server = await serve(0);
const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

page.on('console', (message) => {
    if ((message.type() === 'error' || message.type() === 'warning') && !message.text().includes('404')) {
        console.log(`console ${message.type()}: ${message.text().slice(0, 400)}`);
    }
});
page.on(
    'response',
    (response) =>
        response.status() >= 400 &&
        !response.url().endsWith('favicon.ico') &&
        console.log(`${response.status()}: ${response.url()}`),
);
page.on('pageerror', (error) => console.log(`pageerror: ${error.message}`));
// the fonts come from Google Fonts, and a request of a headless Chrome fails now and then: load again
for (let attempt = 1; ; attempt++) {
    await page.goto(`http://127.0.0.1:${server.address().port}/promo/tour/?t=0`);
    await page.waitForFunction(() => window.tourReady || window.tourError, null, { timeout: 60000 });
    const failure = await page.evaluate(() => window.tourError);

    if (!failure) break;
    if (attempt === 5 || !failure.includes('fonts')) throw new Error(failure);
    console.log(`attempt ${attempt}: the fonts did not load, loading the page again`);
}
const { TOTAL, FPS } = await page.evaluate(() => window.tour);
const grab = (t, quality = 0.95) =>
    page.evaluate(
        ([at, q]) => {
            window.tour.renderAt(at);

            return document.querySelector('canvas').toDataURL('image/jpeg', q);
        },
        [t, quality],
    );
const bytes = (url) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
const ffmpeg = (args) => {
    const done = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });

    if (done.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed`);
};

/** Writes contact sheets: 4 columns, 16 stills on a sheet, each with its time. `shots` is a list of [seconds, data URL]. */
async function sheets(shots, name) {
    const sheet = await browser.newPage({ viewport: { width: 1920, height: 1160 } });
    const files = [];

    for (let i = 0; i * 16 < shots.length; i++) {
        const cells = shots
            .slice(i * 16, i * 16 + 16)
            .map(([t, url]) => `<figure><img src="${url}"><figcaption>${t.toFixed(1)} s</figcaption></figure>`);

        await sheet.setContent(`<style>
            body { margin: 0; background: #000; display: grid; grid-template-columns: repeat(4, 480px); }
            figure { margin: 0; position: relative; height: 290px; }
            img { display: block; width: 480px; height: 270px; }
            figcaption { font: 600 15px Menlo, monospace; color: #fff; height: 20px; line-height: 20px; padding-left: 6px; }
        </style>${cells.join('')}`);
        const file = join(out, 'stills', `${name}${i + 1}.jpg`);

        await sheet.screenshot({
            path: file,
            type: 'jpeg',
            quality: 88,
            clip: { x: 0, y: 0, width: 1920, height: Math.ceil(cells.length / 4) * 290 },
        });
        files.push(file);
    }
    await sheet.close();

    return files;
}

/** The frame of the video at a second, as a data URL. */
function frameOf(video, t) {
    const file = join(out, 'stills', 'frame.jpg');

    ffmpeg(['-ss', t.toFixed(3), '-i', video, '-frames:v', '1', '-q:v', '3', file]);
    const url = `data:image/jpeg;base64,${readFileSync(file).toString('base64')}`;

    rmSync(file);

    return url;
}

async function cover(t) {
    await page.evaluate((at) => window.tour.renderAt(at), t);
    await page.locator('canvas').screenshot({ path: join(out, 'cover.png') });
    console.log(`wrote ${join(out, 'cover.png')} (the frame at ${t} s)`);
}

async function video(from, to, file) {
    const encoder = spawn(
        FFMPEG,
        [
            '-y',
            '-loglevel',
            'error',
            '-f',
            'image2pipe',
            '-framerate',
            String(FPS),
            '-c:v',
            'mjpeg',
            '-i',
            '-',
            // the JPEG frames are full range, and players expect limited range of yuv420p
            '-vf',
            'scale=in_range=pc:out_range=tv',
            '-color_range',
            'tv',
            '-c:v',
            'libx264',
            '-preset',
            'slow',
            '-crf',
            '15',
            '-pix_fmt',
            'yuv420p',
            '-tune',
            'animation',
            '-movflags',
            '+faststart',
            file,
        ],
        { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    const frames = Math.round((to - from) * FPS);
    const start = Date.now();

    for (let i = 0; i < frames; i++) {
        const buffer = bytes(await grab(from + i / FPS));

        if (!encoder.stdin.write(buffer)) await new Promise((resolve) => encoder.stdin.once('drain', resolve));
        if (i % 300 === 0) console.log(`frame ${i}/${frames}  ${((Date.now() - start) / 1000).toFixed(0)} s`);
    }
    encoder.stdin.end();
    await new Promise((resolve) => encoder.on('close', resolve));
    console.log(`wrote ${file} (${frames} frames, ${((Date.now() - start) / 1000).toFixed(0)} s)`);
}

if (arg('stills')) {
    for (const s of arg('stills').split(',')) {
        writeFileSync(join(out, 'stills', `t${s}.jpg`), bytes(await grab(Number(s))));
        console.log(`still ${s}`, JSON.stringify(await page.evaluate(() => window.tour.live() ?? null)).slice(0, 300));
    }
} else if (arg('sheet')) {
    const [from, to, by] = arg('sheet').split(',').map(Number);
    const shots = [];

    for (let t = from; t <= Math.min(to, TOTAL) + 1e-6; t += by) shots.push([t, await grab(t, 0.8)]);
    console.log((await sheets(shots, arg('name') ?? 'live')).join('\n'));
} else if (arg('cover')) {
    await cover(Number(arg('cover')));
} else if (arg('from') || arg('to')) {
    await video(
        Number(arg('from') ?? 0),
        Math.min(TOTAL, Number(arg('to') ?? TOTAL)),
        join(out, arg('name') ?? 'part.mp4'),
    );
} else {
    const full = join(out, 'pixi-marrow-tour.mp4');
    const small = join(out, 'pixi-marrow-tour-small.mp4');

    await video(0, TOTAL, full);
    ffmpeg([
        '-i',
        full,
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-tune',
        'animation',
        '-movflags',
        '+faststart',
        small,
    ]);
    console.log(`wrote ${small}`);
    const shots = [];

    for (let t = 0; t < TOTAL; t += 2) shots.push([t, frameOf(full, t)]);
    console.log((await sheets(shots, 'sheet')).join('\n'));
    await cover(COVER_AT);
}
await browser.close();
server.close();
