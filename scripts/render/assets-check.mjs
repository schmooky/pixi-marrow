#!/usr/bin/env node
/**
 * The part of the render check about Spine files that AssetPack built and Pixi `Assets` loads
 * through a manifest. AssetPack writes every atlas at several resolutions and image formats, with a
 * hash in every file name, and a manifest of bundles. `Assets` picks one variant of an atlas by a
 * texture preference, and the atlas loader finds the pages by the names inside it.
 *
 * The rigs of scripts/render/assets.js go into an input folder, one bundle each. AssetPack builds
 * them at the resolutions 1 and 0.5, in png and webp, with cache busting and a Pixi manifest. A
 * case loads a bundle at resolution 1 in png or at 0.5 in webp, on two pages. pixi-marrow draws on
 * one with `MarrowSpine.from`, the official runtime on the other with `Spine.from`. Both register
 * parsers for the same file extensions, so they cannot share a page.
 *
 * A case fails when a frame of ours is outside the tolerance of ours against official of
 * scripts/check-render.mjs, or is empty. It fails when the runtimes loaded other files, or a file
 * that is not the variant asked for, or a page texture with another resolution or size than its
 * atlas says. It fails on an error or a warning of a page. The bundle is unloaded after the display
 * object is destroyed: that must not throw, keep an alias in the cache, or leave the asset of ours.
 * The proof of the tooling compares ours at 0.5 in webp with the official runtime at 1 in png.
 * Every frame of it must be rejected.
 *
 * What the check found when it was written. AssetPack 1.7.0 cannot build an atlas page in AVIF. Its
 * compress pipe takes png and jpg only, the atlas variants name png and webp pages, and the cache
 * buster throws on the missing pages. So the page of the bee is converted to PNG. The preset
 * `pixiPipes` imports the font and audio pipes too, whose dependencies fail to load in a pnpm
 * install that skipped `tslib` before. So the check composes the pipes it needs.
 *
 * Usage: node scripts/render/assets-check.mjs [--pixi=<version>] [--dist=<folder>]
 *        [--only=assets/bee] [--out=<folder>] [--keep]
 *
 * The arguments mean what they mean for scripts/check-render.mjs. An id is as `assets/dragon/0.5x-webp`.
 * Pictures of a failed case go below `--out`, default `.shots/assets`, and `--keep` writes them for
 * every case. It runs on WebGL.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AssetPack, BuildReporter } from '@assetpack/core';
import { cacheBuster } from '@assetpack/core/cache-buster';
import { compress, mipmap } from '@assetpack/core/image';
import { json } from '@assetpack/core/json';
import { pixiManifest } from '@assetpack/core/manifest';
import * as spinePipes from '@assetpack/core/spine';
import { ASSETS_CAPTURES, ASSETS_CASES, ASSETS_RIGS, ASSETS_SIZE } from './assets.js';
import { BACKGROUNDS, compare, coverage } from './pixels.js';
import { bundlePage, serve } from './serve.mjs';
import { builtPackage, inTime, launchChrome, parseArgs, pixiPackage } from './setup.mjs';

/** The share of the picture the setup pose bounds fill, and one step as a share of the loop, as in scripts/render/plan.mjs. */
const FILL = 0.6;
const LOOP_SHARE = 0.0421;
/** `TOLERANCE.match` of scripts/check-render.mjs, which hands its own in when it runs this check. */
const MATCH = { max: 4, over1: 0.0005, over8: 0 };
/** The least share of the picture a frame must cover for it to count as one. */
const LEAST_COVER = 0.02;
/** How long one page may take, in milliseconds. */
const RUN_TIMEOUT = 60_000;
/** Where the build is served: below the folder `made` of `bundlePage`, see `serve` of scripts/render/serve.mjs. */
const BASE_PATH = '/fixtures/assets/assetpack/output/';
/**
 * What Pixi warns in `Assets.unloadBundle` for a file with two aliases. It removes the file from
 * its cache once per alias, and the second time it is gone. AssetPack gives every file two
 * aliases: its path and its name. Checked against pixi.js 8.16.0 and 8.23.0.
 */
const KNOWN_UNLOAD = /^PixiJS Warning:\s+\[Assets\] Asset id (\S+) was not found in the Cache$/;

/** The page images an atlas names, as AssetPack finds them, with the size after each name. */
function atlasPages(text) {
    return [...text.matchAll(/^.+?\.(?:png|jpe?g|webp|avif)$/gm)].map((match) => {
        const size = /^\s*size:\s*(\d+)\s*,\s*(\d+)/m.exec(text.slice(match.index));

        return { name: match[0].trim(), width: Number(size?.[1]), height: Number(size?.[2]) };
    });
}

/** Whether a file name of AssetPack, as `dragon-Hash@0.5x.webp.atlas`, is the variant a case asks for. */
function isVariant(path, kase) {
    const name = basename(path).replace(/\.atlas$/, '');

    return Number(/@([\d.]+)x/.exec(name)?.[1] ?? 1) === kase.resolution && name.endsWith(`.${kase.format}`);
}

/** Writes one folder per rig into `input`. The tag `{m}` makes it a bundle. sharp comes with AssetPack. */
async function writeInput(root, input) {
    const sharp = createRequire(realpathSync(join(root, 'node_modules/@assetpack/core/package.json')))('sharp');

    for (const rig of ASSETS_RIGS) {
        const from = join(root, rig.dir);
        const to = join(input, `${rig.id}{m}`);
        let atlas = readFileSync(join(from, rig.atlas), 'utf8');

        if (!existsSync(join(from, rig.skeleton))) throw new Error(`${rig.skeleton} is missing. Run: pnpm fixtures`);
        mkdirSync(to, { recursive: true });
        cpSync(join(from, rig.skeleton), join(to, rig.skeleton));
        for (const { name } of atlasPages(atlas)) {
            const png = name.replace(/\.avif$/, '.png');

            // AssetPack cannot build an AVIF page, see the head of this file
            if (png === name) cpSync(join(from, name), join(to, name));
            else await sharp(join(from, name)).png().toFile(join(to, png));
            atlas = atlas.replace(name, png);
        }
        writeFileSync(join(to, rig.atlas), atlas);
    }
}

/**
 * Runs AssetPack with the pipes of `pixiPipes` that act on these files, in its order and with its
 * options. AssetPack logs what goes wrong and resolves anyway, so its errors and warnings are
 * collected here. Returns them with the manifest, which is null where none was written.
 */
async function build(work) {
    const output = join(work, 'output');
    const logged = { errors: [], warnings: [] };
    const reporter = { error: BuildReporter.error, warn: BuildReporter.warn };
    const resolutions = { default: 1, low: 0.5 };
    const formats = { png: true, jpg: true, webp: true };
    const manifest = { createShortcuts: true };
    const pack = new AssetPack({
        entry: join(work, 'input'),
        output,
        cache: false,
        cacheLocation: join(work, 'cache'),
        logLevel: 'none',
        pipes: [
            mipmap({ resolutions }),
            spinePipes.spineAtlasMipmap({ resolutions }),
            compress(formats),
            spinePipes.spineAtlasCompress(formats),
            json(),
            cacheBuster(),
            spinePipes.spineAtlasCacheBuster(),
            pixiManifest(manifest),
            spinePipes.spineAtlasManifestMod(manifest),
        ],
    });

    BuildReporter.error = (text) => logged.errors.push(text);
    BuildReporter.warn = (text) => logged.warnings.push(text);
    try {
        await pack.run();
    } finally {
        Object.assign(BuildReporter, reporter);
    }
    const file = join(output, 'manifest.json');

    return { output, ...logged, manifest: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null };
}

/** What is wrong with the bundle of a rig. Fills `rig.variants`: the pages each atlas variant names. */
function judgeBundle(rig, built) {
    const bundle = built.manifest?.bundles.find((entry) => entry.name === rig.id);

    if (!bundle) return [`the manifest has no bundle ${rig.id}`];
    const entry = (name) => bundle.assets.find((asset) => asset.alias.includes(`${rig.id}/${name}`));
    const reasons = bundle.assets.length === 2 ? [] : [`the bundle has ${bundle.assets.length} entries, not 2`];
    const atlas = entry(rig.atlas)?.src ?? [];

    if (entry(rig.skeleton)?.src.length !== 1) reasons.push('the skeleton is not one file');
    rig.variants = new Map(atlas.map((src) => [src, atlasPages(readFileSync(join(built.output, src), 'utf8'))]));
    for (const kase of ASSETS_CASES) {
        const found = atlas.filter((src) => isVariant(src, kase)).length;

        if (found !== 1) reasons.push(`the atlas has ${found} variants for ${kase.id}`);
    }

    return reasons;
}

/** Fills `rig.placement`, where the setup pose goes in the picture, and `rig.dt`, the step of its animation. */
async function planRig(pkg, root, rig) {
    const core = await import(pathToFileURL(join(pkg, 'dist/core.js')).href);
    const raw = readFileSync(join(root, rig.dir, rig.skeleton));
    const model = await core.importSkeleton(rig.skeleton.endsWith('.json') ? JSON.parse(raw) : new Uint8Array(raw));
    const animation = core.describeSkeleton(model).animations.find((info) => info.name === rig.animation);
    const fit = ASSETS_SIZE * FILL;
    const scale = Math.round(Math.min(fit / model.width, fit / model.height) * 1e4) / 1e4;
    const center = ASSETS_SIZE / 2;

    if (!animation) throw new Error(`${rig.skeleton} has no animation ${rig.animation}`);
    rig.dt = animation.duration * LOOP_SHARE;
    // skeletons are drawn with y down, so the top of the bounds is at -(y + height)
    rig.placement = {
        scale,
        x: Math.round((center - (model.x + model.width / 2) * scale) * 100) / 100,
        y: Math.round((center + (model.y + model.height / 2) * scale) * 100) / 100,
    };
}

/** Runs one job in a page of its own. Returns the report, the errors and warnings, and the files the page asked for. */
async function runPage(browser, origin, job) {
    const page = await browser.newPage();
    const errors = [];
    const requested = new Set();

    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
        const { pathname } = new URL(request.url());

        if (pathname.startsWith(BASE_PATH)) requested.add(pathname.slice(BASE_PATH.length));
    });
    page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} for ${response.url()}`);
    });
    page.on('console', (entry) => {
        if (/Failed to load resource/.test(entry.text())) return;
        if (entry.type() === 'error' || entry.type() === 'warning') errors.push(`${entry.type()}: ${entry.text()}`);
    });
    try {
        await page.goto(`${origin}/`);
        await page.waitForFunction(() => window.assetsCheck, null, { timeout: 30_000 });
        const running = page.evaluate((it) => window.assetsCheck.run(it), job);
        const report = await inTime(running, RUN_TIMEOUT);

        return { report, errors, requested: [...requested].sort() };
    } catch (error) {
        return { report: { error: error.message.split('\n')[0], frames: [], pages: [] }, errors, requested: [] };
    } finally {
        await page.close().catch(() => {});
    }
}

const relativeUrl = (url) => new URL(url).pathname.slice(BASE_PATH.length);
const percent = (share) => `${(share * 100).toFixed(3)}%`;
const bytesOf = (base64) => new Uint8Array(Buffer.from(base64, 'base64'));
/** The atlas and the page files a run loaded, as paths in the build. */
const loadedFiles = (side) => [side.report.resolved.atlas, ...side.report.pages.map((it) => it.label)].map(relativeUrl);

/**
 * Every step of two runs, measured and judged. `why` says why a step is outside the tolerance,
 * or is empty. Shares are of the covered pixels. A step that one run lacks is outside.
 */
function compareRuns(ours, official, tolerance) {
    return ASSETS_CAPTURES.map((step) => {
        const [a, b] = [ours, official].map((side) => side.report.frames.find((frame) => frame.step === step));

        if (!a || !b) return { step, why: 'a run has no picture' };
        const [first, second] = [bytesOf(a.pixels), bytesOf(b.pixels)];
        const m = compare(first, second, ASSETS_SIZE, BACKGROUNDS.solid);
        const drawn = Math.min(coverage(first, BACKGROUNDS.solid), coverage(second, BACKGROUNDS.solid));
        const cover = drawn / ASSETS_SIZE ** 2;

        m.share1 = m.over1 / Math.max(m.covered, 1);
        m.share8 = m.over8 / Math.max(m.covered, 1);
        let why = '';

        if (cover < LEAST_COVER) why = `the picture is empty, ${percent(cover)} of it is drawn`;
        else if (m.max > tolerance.max) why = `max ${m.max} is over ${tolerance.max}`;
        else if (m.over8 > tolerance.over8 * m.covered) why = `${percent(m.share8)} differ by more than 8`;
        else if (m.over1 > tolerance.over1 * m.covered) why = `${percent(m.share1)} differ by more than 1`;

        return { step, m, why };
    });
}

/** What is wrong with what one run loaded and unloaded, as a list of sentences. Sets `side.known`. */
function judgeLoad(rig, kase, name, side) {
    const { report } = side;
    const reasons = side.errors.map((error) => `${name} logged ${error}`);

    if (report.error) return [...reasons, `${name} failed: ${report.error}`];
    const [atlas, ...files] = loadedFiles(side);
    const pages = rig.variants.get(atlas) ?? [];

    if (!isVariant(atlas, kase)) reasons.push(`${name} resolved the atlas ${atlas}`);
    if (files.length !== pages.length) reasons.push(`${name} has ${files.length} pages, the atlas ${pages.length}`);
    report.pages.forEach((page, index) => {
        const { name: named, width, height } = pages[index] ?? {};
        const [file, size] = [files[index], `${page.width}x${page.height}`];

        if (!isVariant(file, kase) || page.resolution !== kase.resolution) {
            reasons.push(`${name} loaded the page ${file} at resolution ${page.resolution}`);
        }
        if (basename(file) !== named) reasons.push(`${name} loaded ${file}, the atlas names ${named}`);
        if (size !== `${width}x${height}`) reasons.push(`${name} has ${file} at ${size}, not ${width}x${height}`);
    });
    const { unload } = report;
    const sources = [report.resolved.skeleton, report.resolved.atlas];

    for (const warning of unload.warnings) {
        const id = KNOWN_UNLOAD.exec(warning)?.[1];

        // once per file: the second of its two aliases
        if (sources.includes(id)) sources.splice(sources.indexOf(id), 1);
        else reasons.push(`${name} warned in Assets.unloadBundle: ${warning}`);
    }
    side.known = 2 - sources.length;
    if (unload.error) reasons.push(`${name} threw in Assets.unloadBundle: ${unload.error}`);
    if (unload.cached.length) reasons.push(`${name} keeps ${unload.cached.join(', ')} in the cache after the unload`);
    if (unload.assetDestroyed === false) reasons.push(`${name} has an asset that the unload did not destroy`);

    return reasons;
}

/** Why a case fails, as a list of sentences, and the steps compared. An empty list is a pass. */
function judgeCase(rig, kase, ours, official, tolerance) {
    const sides = { ours, official };
    const reasons = Object.entries(sides).flatMap(([name, side]) => judgeLoad(rig, kase, name, side));

    if (ours.report.error || official.report.error) return { reasons, steps: [] };
    if (loadedFiles(ours).join() !== loadedFiles(official).join()) reasons.push('the runtimes loaded other files');
    for (const [name, side] of Object.entries(sides)) {
        // the skeleton, one variant of the atlas and its pages, and no other file
        const wanted = [relativeUrl(side.report.resolved.skeleton), ...loadedFiles(side)].sort();

        if (side.requested.join() !== wanted.join()) reasons.push(`${name} asked for ${side.requested.join(', ')}`);
    }
    const kept = ours.report.pages.length - ours.report.unload.pagesDestroyed;

    if (kept) reasons.push(`the unload left ${kept} page textures of ours alive`);
    const steps = compareRuns(ours, official, tolerance);

    for (const { step, why } of steps) if (why) reasons.push(`step ${step}: ${why}`);

    return { reasons, steps };
}

/** Writes the pictures of the worst step of a case and returns where. */
function keepPictures(outDir, id, steps, sides) {
    const step = [...steps].sort((a, b) => (b.m?.max ?? 256) - (a.m?.max ?? 256))[0]?.step ?? ASSETS_CAPTURES[0];
    const written = [];

    mkdirSync(outDir, { recursive: true });
    for (const [name, side] of Object.entries(sides)) {
        const png = side.report.frames.find((frame) => frame.step === step)?.png;
        const file = join(outDir, `${id.replaceAll('/', '-')}__step${step}__${name}.png`);

        if (png) writeFileSync(file, Buffer.from(png, 'base64'));
        if (png) written.push(file);
    }

    return written.join(', ');
}

/**
 * The tooling proof: ours at resolution 0.5 in webp against the official runtime at resolution 1
 * in png, for every rig that ran both cases. Every step must be rejected. Returns the failures.
 */
function proveRejection(runs, tolerance) {
    const [full, low] = ASSETS_CASES.map((kase) => kase.id);
    const steps = ASSETS_RIGS.flatMap((rig) => {
        const [a, b] = [low, full].map((kase) => runs.get(`assets/${rig.id}/${kase}`));

        return a?.ours.report.frames.length && b?.official.report.frames.length
            ? compareRuns(a.ours, b.official, tolerance)
            : [];
    });
    const rejected = steps.filter((step) => step.why).length;
    const ok = steps.length > 0 && rejected === steps.length;

    if (steps.length === 0) console.log('  skip proof, no rig ran both cases');
    else {
        const least = Math.min(...steps.map((step) => step.m?.max ?? 255));

        console.log(
            `  ${ok ? 'ok  ' : 'FAIL'} proof, ours at ${low} against official at ${full} is rejected in ` +
                `${rejected} of ${steps.length} frames, with max ${least} at the least`,
        );
    }

    return ok || steps.length === 0 ? 0 : 1;
}

/**
 * Runs the check and returns the number of failures.
 *
 * @param options.pkg The folder of the built pixi-marrow, see `builtPackage` of scripts/render/setup.mjs.
 * @param options.pixi The pixi.js of the pages, as `pixiPackage` returns it.
 * @param options.outDir Where the pictures of a failed case go.
 * @param options.only The text of `--only`, or null. With a text that no case id holds, nothing runs and nothing fails.
 * @param options.keep True to write the pictures of the cases that pass too.
 * @param options.tolerance The limits of ours against official, `TOLERANCE.match` of scripts/check-render.mjs.
 * @example
 * failed += await checkAssets({ root, pkg, pixi, outDir: join(outDir, 'assets'), tolerance: TOLERANCE.match });
 */
export async function checkAssets({ root, pkg, pixi, outDir, only = null, keep = false, tolerance = MATCH }) {
    // a run fills in what it learns about a rig, on a copy of its own
    const rigs = ASSETS_RIGS.map((rig) => ({ ...rig }));
    const jobs = rigs
        .flatMap((rig) => ASSETS_CASES.map((kase) => ({ rig, kase, id: `assets/${rig.id}/${kase.id}` })))
        .filter((job) => !only || job.id.includes(only));

    // the text of --only names rigs or scenes of the render check, and none of these cases
    if (jobs.length === 0) return 0;
    const bundle = await bundlePage(root, 'scripts/render/assets.js', { pkg, pixi: pixi.dir });
    const work = join(bundle.made, 'assetpack');
    const version = JSON.parse(readFileSync(join(root, 'node_modules/@assetpack/core/package.json'), 'utf8')).version;
    const runs = new Map();
    let server;
    let browser;
    let failed = 0;
    let known = 0;

    try {
        await writeInput(root, join(work, 'input'));
        const built = await build(work);

        console.log(
            `assets-check: AssetPack ${version} built ${rigs.length} rigs at the resolutions 1 and 0.5 in png and webp, ` +
                'with cache busting and a Pixi manifest. Ours draws with MarrowSpine.from, the official runtime with Spine.from',
        );
        for (const warning of built.warnings) console.log(`  AssetPack warned: ${warning}`);
        for (const error of built.errors) console.log(`  FAIL AssetPack logged: ${error}`);
        failed += built.errors.length;
        for (const rig of rigs) {
            const reasons = judgeBundle(rig, built);

            for (const reason of reasons) console.log(`  FAIL ${rig.title}: ${reason}`);
            failed += reasons.length;
            await planRig(pkg, root, rig);
        }
        if (failed) return failed;
        server = await serve(root, bundle.dir, { made: bundle.made });
        browser = await launchChrome();
        for (const job of jobs) {
            const { rig, kase } = job;
            const sides = {};

            for (const runtime of ['ours', 'official']) {
                sides[runtime] = await runPage(browser, server.origin, {
                    runtime,
                    version: rig.version,
                    manifest: built.manifest,
                    basePath: BASE_PATH,
                    preference: { resolution: kase.resolution, format: kase.format },
                    bundle: rig.id,
                    skeleton: `${rig.id}/${rig.skeleton}`,
                    atlas: `${rig.id}/${rig.atlas}`,
                    animation: rig.animation,
                    dt: rig.dt,
                    placement: rig.placement,
                });
            }
            const { ours, official } = sides;
            const { reasons, steps } = judgeCase(rig, kase, ours, official, tolerance);
            const measured = steps.filter((step) => step.m).map((step) => step.m);
            const worst = (key) => Math.max(0, ...measured.map((m) => m[key]));

            if (runs.size === 0) console.log(`  webgl, pixi.js ${ours.report.pixi}, ${ours.report.renderer}`);
            if (runs.size === 0 && ours.report.pixi && ours.report.pixi !== pixi.version) {
                console.log(`  FAIL the page runs on pixi.js ${ours.report.pixi}, not on ${pixi.version}`);
                failed++;
            }
            known += (ours.known ?? 0) + (official.known ?? 0);
            runs.set(job.id, sides);
            console.log(
                `  ${reasons.length ? 'FAIL' : 'ok  '} ${rig.title}, ${kase.id}: ${measured.length} frames, ` +
                    `max ${worst('max')}, over 1 ${percent(worst('share1'))}, over 8 ${percent(worst('share8'))}`,
            );
            // a case that passes asserts that both loaded the same files
            if (!ours.report.error)
                console.log(`       ${reasons.length ? 'ours' : 'both'} loaded ${loadedFiles(ours).join(', ')}`);
            for (const reason of reasons) console.log(`       ${reason}`);
            if (reasons.length) failed++;
            if (reasons.length || keep) console.log(`       pictures: ${keepPictures(outDir, job.id, steps, sides)}`);
        }
        if (known) {
            console.log(
                `  FOUND pixi.js warned ${known} times in Assets.unloadBundle, on both runtimes alike: it removes a ` +
                    'file from its cache once per alias, see KNOWN_UNLOAD. This fails nothing',
            );
        }
        failed += proveRejection(runs, tolerance);
    } finally {
        await browser?.close();
        server?.close();
        bundle.remove();
    }

    return failed;
}

/** The check as a command of its own. Returns the exit code. */
async function main() {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const args = parseArgs();
    const failed = await checkAssets({
        root,
        pkg: builtPackage(root, args.dist, 'assets-check'),
        pixi: pixiPackage(root, args.pixi, 'assets-check'),
        outDir: resolve(root, args.out ?? '.shots/assets'),
        only: args.only ?? null,
        keep: args.keep === 'true',
    });

    console.log(failed ? `assets-check: ${failed} failures` : 'assets-check: ok');

    return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = await main();
    } catch (error) {
        console.error(`assets-check: ${error.message}`);
        process.exitCode = 1;
    }
}
