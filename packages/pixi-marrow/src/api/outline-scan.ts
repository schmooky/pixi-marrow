import type { Texture, TextureSource } from 'pixi.js';
import { readRegion } from '../geometry/atlas-regions';
import { computeOpaqueRect } from '../geometry/opaque-rect';
import { buildAtlasOutlines } from '../geometry/outlines';
import { alphaFromRgba, computeTightOutline, regionPageRect } from '../geometry/tight';
import { ATLAS_REGION_STRIDE, type AtlasModel, type AtlasPage } from '../model/atlas';
import type { AtlasOutlines, RegionOutline } from '../model/outlines';
import { createPageReader, type PageReader } from '../render/page-alpha';
import { pageAllowsCuts } from '../render/page-block';
import { isStillImage } from './textures';

/*
 * The scan that finds the outlines of an atlas at load time, when no file gives them.
 *
 * Many assets can draw from one atlas page: the symbols of a slot game share one atlas. So the
 * work is kept per page image, not per asset. The first scan that needs a page reads it, and
 * every other scan of the same image waits for that result. Pages are read one after the other
 * through one reader, so there is one WebGL context at most, and it is freed when no page waits.
 *
 * A page is read in one idle slice. Its regions are then outlined in slices of a few
 * milliseconds, so a frame is never held up by a whole page.
 */

/** The longest a slice waits for idle time before it runs anyway, in milliseconds. */
const IDLE_TIMEOUT = 1000;
/** The milliseconds of work a slice does before it gives the frame back. */
const SLICE_BUDGET = 4;
/** The margins of {@link buildAtlasOutlines}, which a scan uses as they are. */
const MARGIN = 1;

/** A scan that is running or has ended. */
export interface OutlineScan {
    /**
     * The outlines, once every page was looked at. Undefined when the scan was stopped, and when
     * no page could be read. Never rejects.
     */
    readonly done: Promise<AtlasOutlines | undefined>;
    /** Ends the scan. `done` then resolves with undefined. A page that no other scan waits for is not read. */
    stop(): void;
}

/** What a scan works with. The defaults are those of a browser. */
export interface OutlineScanOptions {
    /**
     * Reads the pixels of a page, and is released when the scan has ended. Default: one reader
     * for all scans, which is released when no page waits.
     */
    reader?: PageReader;
    /** Runs a function when there is idle time. Default: `requestIdleCallback` where it exists, else a timer. */
    idle?: (run: () => void) => void;
    /** The milliseconds of work in one slice. Default 4. With 0 every region gets a slice of its own. */
    budget?: number;
    /** The clock, in milliseconds. Default `performance.now`. */
    now?: () => number;
}

/** The outline of each region of one page, in the order of the atlas. Null for a page that was not read. */
type PageResult = RegionOutline[] | null;

/** The work on one page image, which every scan of that image shares. */
interface PageJob {
    /** The scans that wait for the result. With none left, the work ends early. */
    waiters: number;
    /** Never rejects. */
    done: Promise<PageResult>;
}

/** The jobs of each page image, by what the atlas says of the page: two atlases with the same page share one. */
const pageJobs = new WeakMap<TextureSource, Map<string, PageJob>>();
/** What an atlas says of each of its pages, as text. */
const signatures = new WeakMap<AtlasModel, string[]>();
/** The reader all scans share. It makes its WebGL context on first use. */
let sharedReader: PageReader | undefined;
/** The jobs that wait or run with the shared reader. */
let sharedJobs = 0;
/** The end of the last job: the next one starts after it. */
let queue: Promise<unknown> = Promise.resolve();
let warned = false;

function whenIdle(run: () => void): void {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => run(), { timeout: IDLE_TIMEOUT });
    else setTimeout(run, 0);
}

/** Warns once that a page could not be scanned, with the cause. Its regions keep their quads. */
function warnPage(page: AtlasPage, error: unknown): void {
    if (warned) return;
    warned = true;
    console.warn(
        `pixi-marrow: outlines: 'auto' could not scan the page "${page.name}", so its regions keep their quads: ${error instanceof Error ? error.message : String(error)}`,
    );
}

/** The regions of one page, as indices into the atlas, in atlas order. */
function regionsOf(atlas: AtlasModel, page: number): number[] {
    const indices: number[] = [];

    for (let region = 0; region < atlas.regionNames.length; region++) {
        if (atlas.regions[region * ATLAS_REGION_STRIDE] === page) indices.push(region);
    }

    return indices;
}

/** What an atlas says of one page: its size, its flags and its regions. Equal text means equal outlines. */
function signatureOf(atlas: AtlasModel, index: number): string {
    let pages = signatures.get(atlas);

    if (pages === undefined) {
        pages = [];
        signatures.set(atlas, pages);
    }
    let text = pages[index];

    if (text === undefined) {
        const page = atlas.pages[index];
        const parts: unknown[] = [page?.width, page?.height, page?.pma, page?.repeatX, page?.repeatY];

        for (const region of regionsOf(atlas, index)) {
            const at = region * ATLAS_REGION_STRIDE;

            parts.push(atlas.regionNames[region], ...atlas.regions.slice(at + 1, at + ATLAS_REGION_STRIDE));
        }
        text = JSON.stringify(parts);
        pages[index] = text;
    }

    return text;
}

/** The outline of one region, as {@link buildAtlasOutlines} makes it with its default margins. */
function regionOutline(atlas: AtlasModel, index: number, alpha: Uint8Array, page: AtlasPage): RegionOutline {
    const name = atlas.regionNames[index] ?? '';
    const rect = regionPageRect(readRegion(atlas, index));
    const { width, height } = page;

    // a region that leaves its page keeps the quad
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > width || rect.y + rect.height > height) {
        return { name, rect, polygon: null, triangles: [], coverage: 1, opaque: null };
    }
    const outline = computeTightOutline(alpha, width, height, rect, {
        margin: MARGIN,
        repeatX: page.repeatX,
        repeatY: page.repeatY,
    });

    return {
        name,
        rect,
        polygon: outline.worthIt ? Array.from(outline.polygon) : null,
        triangles: outline.worthIt ? Array.from(outline.triangles) : [],
        coverage: outline.coverage,
        opaque: computeOpaqueRect(alpha, width, height, rect, { margin: MARGIN }),
    };
}

/** What the slices of a scan run with. */
interface Runner {
    reader: PageReader;
    idle: (run: () => void) => void;
    budget: number;
    now: () => number;
}

const nextSlice = (run: Runner): Promise<void> => new Promise((resolve) => run.idle(resolve));

/**
 * Reads one page and outlines its regions, in idle slices. Returns null for a page that keeps
 * its quads. That is a page whose pixels cannot be read, and one whose image can change. It is
 * also one that is sampled in a way outlines do not hold for. Returns undefined when nobody
 * waits for the page any more.
 */
async function scanPage(
    job: PageJob,
    source: TextureSource,
    atlas: AtlasModel,
    index: number,
    run: Runner,
): Promise<PageResult | undefined> {
    const page = atlas.pages[index];

    await nextSlice(run);
    if (job.waiters === 0) return undefined;
    if (page === undefined || !pageAllowsCuts(source, page) || !isStillImage(source.resource)) return null;
    const pixels = run.reader.read(source, page.pma);

    if (pixels === null || pixels.width !== page.width || pixels.height !== page.height) return null;
    // one byte per pixel from here on: the four bytes per pixel of the read are let go
    const alpha = alphaFromRgba(pixels.data, page.pma);
    const outlines: RegionOutline[] = [];
    let start = run.now();
    let worked = false;

    for (const region of regionsOf(atlas, index)) {
        if (worked && run.now() - start >= run.budget) {
            await nextSlice(run);
            if (job.waiters === 0) return undefined;
            start = run.now();
        }
        outlines.push(regionOutline(atlas, region, alpha, page));
        worked = true;
    }

    return outlines;
}

/** Runs the work of a page after the pages before it. The result of a page that failed is null. */
function startJob(job: PageJob, source: TextureSource, atlas: AtlasModel, index: number, run: Runner): void {
    const jobs = pageJobs.get(source);
    const key = signatureOf(atlas, index);
    const shared = run.reader === sharedReader;
    const forget = (): void => {
        if (jobs?.get(key) === job) jobs.delete(key);
    };

    if (shared) sharedJobs++;
    job.done = queue
        .then(() => scanPage(job, source, atlas, index, run))
        .catch((error: unknown) => {
            const page = atlas.pages[index];

            if (page !== undefined) warnPage(page, error);

            return null;
        })
        .then((result) => {
            // a page that nobody waited for was not read: the next scan of it starts over
            if (result === undefined) forget();
            // the context of the shared reader is freed when no page waits for it
            if (shared && --sharedJobs === 0) sharedReader?.release();

            return result ?? null;
        });
    queue = job.done;
}

/** The job of one page image for a scan: the one that is there, or a new one at the end of the queue. */
function joinPage(source: TextureSource, atlas: AtlasModel, index: number, run: Runner): PageJob {
    let jobs = pageJobs.get(source);

    if (jobs === undefined) {
        const made = new Map<string, PageJob>();
        // other pixels or no pixels: what was read does not hold any more
        const drop = (): void => {
            if (pageJobs.get(source) === made) pageJobs.delete(source);
            source.off('update', drop);
            source.off('destroy', drop);
        };

        jobs = made;
        pageJobs.set(source, made);
        source.on('update', drop);
        source.on('destroy', drop);
    }
    const key = signatureOf(atlas, index);
    let job = jobs.get(key);

    if (job === undefined) {
        job = { waiters: 0, done: Promise.resolve(null) };
        jobs.set(key, job);
        startJob(job, source, atlas, index, run);
    }
    job.waiters++;

    return job;
}

/**
 * Builds the outlines of an atlas from the pixels of its page textures, in idle time. A page is
 * read in one slice, and its regions are outlined in slices of a few milliseconds.
 *
 * Scans share their work: a page image that another scan reads or has read is not read again.
 * Pages are read one after the other through one reader, with one WebGL context at most.
 *
 * Some pages keep their quads, and their regions get no outline. That is a page whose pixels
 * cannot be read, and a page whose image can change. It is also a page whose texture is sampled
 * in a way outlines do not hold for: with mipmaps, or at another size than the atlas states.
 * A page that fails with an error warns once, with the cause.
 *
 * @example
 * const scan = scanOutlines(atlas, textures);
 * const outlines = await scan.done;
 * if (outlines !== undefined) view.setOutlines(outlines);
 */
export function scanOutlines(
    atlas: AtlasModel,
    textures: readonly Texture[],
    options: OutlineScanOptions = {},
): OutlineScan {
    sharedReader ??= createPageReader();
    const run: Runner = {
        reader: options.reader ?? sharedReader,
        idle: options.idle ?? whenIdle,
        budget: options.budget ?? SLICE_BUDGET,
        now: options.now ?? (() => performance.now()),
    };
    // no page yet: the header and one null per region
    const outlines = buildAtlasOutlines(atlas, []);
    const jobs: PageJob[] = [];
    let stopped = false;
    let read = 0;
    let end: (result: AtlasOutlines | undefined) => void = () => undefined;
    const done = new Promise<AtlasOutlines | undefined>((resolve) => {
        end = resolve;
    });
    const pages = atlas.pages.map(async (_, index) => {
        const source = textures[index]?.source;

        if (source === undefined) return;
        const job = joinPage(source, atlas, index, run);

        jobs.push(job);
        const result = await job.done;

        if (result === null || stopped) return;
        regionsOf(atlas, index).forEach((region, at) => {
            outlines.regions[region] = result[at] ?? null;
        });
        read++;
    });

    void Promise.all(pages).then(() => {
        // a reader of the caller is the caller's to keep or to free: it is told that the scan is over
        if (options.reader !== undefined) options.reader.release();
        end(stopped || read === 0 ? undefined : outlines);
    });

    return {
        done,
        stop() {
            if (stopped) return;
            stopped = true;
            for (const job of jobs) job.waiters--;
            end(undefined);
        },
    };
}
