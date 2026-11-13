/**
 * The memory of the instances of one side, measured on a page that has drawn nothing else, and
 * split by the code that allocated it.
 *
 * Why a page of its own. Pixi keeps what it drew last: the instructions of a render group hold
 * the objects of the frame before, also after those were destroyed, until a later frame writes
 * over them. A block that follows another one on the same stage therefore starts with the
 * instances of the block before still in memory, and they are freed while it runs. Measured in
 * Chrome 157 with 200 instances of the raptor: the heap grew by 72 KB per instance on a fresh
 * page, by 12 KB when the same side had run before, and it fell by 35 KB when the official
 * runtime had run before. So every reading here is the first thing its page does after the load.
 *
 * The split. Chrome samples the allocations of the page while the instances are created and
 * played: `HeapProfiler.startSampling`. After a garbage collection the samples that are still
 * alive say which function allocated how many bytes. The bundle of the page names the module of
 * every function, so the bytes add up per package: pixi-marrow, pixi.js, spine-core and so on.
 * That is what the code of a package allocated, which is close to what it holds, and not the
 * same: an object that one package creates through the constructor of another counts for the
 * package whose code ran.
 *
 * The samples cover the objects of the JavaScript heap. The stores of typed arrays live outside
 * of it and are not sampled. `usedJSHeapSize` counts them, so they are what is left of the
 * growth of the heap after the sampled objects. For pixi-marrow `perf.memory()` says how many
 * bytes of typed arrays an instance holds itself. The rest of the stores belongs to someone else,
 * which is Pixi: the buffers of its batcher are of that kind.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inTime } from '../render/setup.mjs';
import { quantile } from './table.mjs';

/** Bytes between two samples of the heap profiler on average. Smaller is more exact and slower. */
const SAMPLING_INTERVAL = 256;
/** Frames the instances play before the memory is read. */
const WARMUP = 40;
const PAGE_TIMEOUT = 120_000;
/**
 * The fewest instances whose memory is read. A garbage collection also frees code that did not
 * run for a while, some hundred KB between two readings. Divided by a few instances that is
 * more than an instance holds.
 */
const MEMORY_INSTANCES = 20;
/** How often the memory of a side is read, each time on a fresh page. */
const MEMORY_RUNS = 2;

/** The package a module of the bundle belongs to, from its path. */
function packageOf(path) {
    if (path.includes('/pixi.js/')) return 'pixi.js';
    if (path.includes('spine-pixi-v8')) return 'spine-pixi-v8';
    if (path.includes('spine-core')) return 'spine-core';
    // the package of the repo, or the copy of a build that was kept
    if (path.includes('pixi-marrow/dist/')) return 'pixi-marrow';
    if (path.startsWith('scripts/')) return 'the bench page';

    return 'other';
}

/**
 * Where the modules start in every chunk of a bundle. Rolldown writes a comment with the path of
 * a module before its code.
 *
 * @returns Per file name of a chunk: the line and the package of every module in it, in order.
 */
export function readModules(bundleDir) {
    const chunks = new Map();

    for (const name of readdirSync(bundleDir)) {
        const starts = [];

        for (const [index, line] of readFileSync(join(bundleDir, name), 'utf8').split('\n').entries()) {
            const path = /^\/\/ ((?:node_modules|packages|scripts)\/\S+)$/.exec(line)?.[1];

            if (path) starts.push({ line: index, owner: packageOf(path) });
        }
        chunks.set(name, starts);
    }

    return chunks;
}

/** The package whose code a call frame of the profile is in, or null for a frame outside the bundle. */
function ownerOf(chunks, frame) {
    const starts = chunks.get(frame.url.split('/').pop());
    let owner = null;

    for (const start of starts ?? []) {
        if (start.line > frame.lineNumber) break;
        owner = start.owner;
    }

    return owner;
}

/**
 * The live bytes of a sampling profile per package. A sample counts for the package of the
 * function that allocated it. A function outside the bundle, like a builtin, counts for the
 * nearest caller that is in it.
 */
function bytesByOwner(chunks, profile) {
    const owners = {};
    const walk = (node, inherited) => {
        const owner = ownerOf(chunks, node.callFrame) ?? inherited;

        if (node.selfSize > 0) owners[owner] = (owners[owner] ?? 0) + node.selfSize;
        for (const child of node.children) walk(child, owner);
    };

    walk(profile.head, 'the browser');

    return owners;
}

/**
 * Measures the memory of some instances of one side on a fresh page.
 *
 * @param job.runtime `ours` or `official`, `job.options` the options of a display object of
 * ours, `job.instances` how many there are. `job.split` asks for the bytes per package, which
 * makes Chrome sample the allocations of the page.
 * @param context `browser`, the `origin` of the page server, the `renderer` name, the canvas
 * `width` and `height`, and `chunks` from `readModules`.
 * @returns The growth of the heap and of the page in bytes, the bytes of typed arrays an
 * instance of ours counts as its own, and the sampled bytes per package. Or `error`.
 */
async function measureMemory(context, rig, job) {
    const { browser, origin, renderer, width, height, chunks } = context;
    const page = await browser.newPage();
    // the runtime that is not measured stays out of the page where it can
    const official = job.runtime === 'official' ? rig.official : 'none';
    const read = async () => {
        await page.goto(`${origin}/?renderer=${renderer}&official=${official}&width=${width}&height=${height}`);
        await page.waitForFunction(() => window.bench, null, { timeout: PAGE_TIMEOUT });
        const state = await page.evaluate(() => ({
            error: window.bench.error,
            renderer: window.bench.renderer,
        }));

        if (state.error || state.renderer !== renderer)
            return { error: state.error ?? `the browser gave ${state.renderer}` };
        // the asset is loaded for the mesh mode when the instances ask for it by name
        await page.evaluate(([plan, mesh]) => window.bench.load(plan, mesh), [rig, job.options?.renderMode === 'mesh']);
        if (!job.split) return page.evaluate((it) => window.bench.hold(it), { ...job, warmup: WARMUP });
        const client = await page.context().newCDPSession(page);

        await client.send('HeapProfiler.enable');
        await client.send('HeapProfiler.startSampling', { samplingInterval: SAMPLING_INTERVAL });
        const held = await page.evaluate((it) => window.bench.hold(it), { ...job, warmup: WARMUP });

        if (held.error) return held;
        await client.send('HeapProfiler.collectGarbage');
        const { profile } = await client.send('HeapProfiler.getSamplingProfile');
        const owners = bytesByOwner(chunks, profile);

        return { ...held, owners, sampledBytes: Object.values(owners).reduce((sum, bytes) => sum + bytes, 0) };
    };

    try {
        return await inTime(read(), PAGE_TIMEOUT);
    } catch (error) {
        return { error: error.message.split('\n')[0] };
    } finally {
        await page.close().catch(() => {});
    }
}

const kb = (bytes, instances) => (bytes / instances / 1024).toFixed(1);

/**
 * One line per side: the heap of an instance as its typed array stores plus its objects, and
 * the objects per package. All numbers are KB per instance.
 *
 * @param readings What `measureMemory` returned for the sides of one rig at one instance count,
 * each with its `side` name.
 */
export function describeSplit(readings) {
    const lines = [];

    for (const reading of readings) {
        if (reading.error || typeof reading.heapBytes !== 'number' || !reading.owners) continue;
        const { instances, heapBytes, sampledBytes, arrayBytes, owners } = reading;
        const per = (bytes) => kb(bytes, instances);
        const stores = heapBytes - sampledBytes;
        // what an instance of ours counts as its own typed arrays, and what is left for others
        const own =
            typeof arrayBytes === 'number'
                ? ` (${kb(arrayBytes, 1)} are arrays the instance counts as its own, ${kb(stores - arrayBytes * instances, instances)} are held by others)`
                : '';
        const packages = Object.entries(owners)
            .filter(([, bytes]) => bytes / instances >= 51)
            .sort((a, b) => b[1] - a[1])
            .map(([owner, bytes]) => `${owner} ${per(bytes)}`);

        lines.push(
            `${reading.side.padEnd(8)} ${per(heapBytes).padStart(6)} = typed array stores ${per(stores)}${own} ` +
                `+ objects ${per(sampledBytes)}, by the code that allocated them: ${packages.join(', ')}`,
        );
    }

    return lines;
}

/**
 * The memory of every side of a rig, each reading on a fresh page.
 *
 * Every side is read `MEMORY_RUNS` times. The second time the sides come in the opposite order,
 * so a run holds its own proof that a reading does not depend on what was read before: with two
 * sides the order is ours, official, official, ours. The table prints the spread of the readings.
 * One more page reads an empty block: the same steps with no instance, which must read about
 * nothing.
 *
 * @param context What `measureMemory` needs: the browser, the page server and the modules of the bundle.
 * @param plan `sides` are the sides of the rig, each with its `side` name, its `runtime` and the
 * `options` of a display object. `counts` are the instance counts of the run. Only the largest
 * one is read unless `all` is true: a page per reading takes time.
 */
export async function measureSides(context, rig, { sides, counts, all }) {
    const readings = [];
    const largest = Math.max(...counts);
    const read = counts.filter((count) => count >= MEMORY_INSTANCES && (all || count === largest));

    for (const instances of read) {
        for (let run = 0; run < MEMORY_RUNS; run++) {
            for (const { side, runtime, options } of run % 2 === 0 ? sides : [...sides].reverse()) {
                // the split by package is taken once, where the table prints it
                const split = run === 0 && instances === largest;
                const reading = await measureMemory(context, rig, { runtime, options, instances, split });

                readings.push({ side, run, instances, ...reading });
            }
        }
    }
    if (read.length > 0) {
        const empty = await measureMemory(context, rig, { runtime: 'official', options: {}, instances: 0 });

        readings.push({ side: 'empty', run: 0, instances: 0, ...empty });
    }

    return readings;
}

/**
 * Puts the memory readings of a rig into the combined runs of its sides, in the form the table
 * reads: the median, the smallest and the largest reading per instance.
 *
 * @param groups Per instance count the combined runs of `ours`, `official`, `mesh`, `gpu` and `alone`.
 */
export function addMemory(groups, memory) {
    const over = (readings, key) => {
        const values = readings
            .filter((reading) => typeof reading[key] === 'number')
            .map((reading) => reading[key] / reading.instances);

        return values.length
            ? { median: quantile(values, 0.5), min: Math.min(...values), max: Math.max(...values) }
            : null;
    };

    for (const group of groups) {
        for (const name of ['ours', 'official', 'mesh', 'gpu', 'alone']) {
            const readings = memory.filter((it) => it.side === name && it.instances === group.instances && !it.error);

            if (!group[name] || readings.length === 0) continue;
            group[name].heapPerInstance = over(readings, 'heapBytes');
            group[name].agentPerInstance = over(readings, 'agentBytes');
        }
    }
}

/** What the empty block of a rig read, as a line, or an empty string when there was none. */
export function describeEmpty(memory) {
    const empty = memory.find((reading) => reading.side === 'empty' && !reading.error);
    const kilobytes = (bytes) => (typeof bytes === 'number' ? `${(bytes / 1024).toFixed(1)} KB` : 'an unknown amount');

    return empty
        ? `an empty block on a fresh page: the heap moved by ${kilobytes(empty.heapBytes)} in all and the page by ${kilobytes(empty.agentBytes)}`
        : '';
}
