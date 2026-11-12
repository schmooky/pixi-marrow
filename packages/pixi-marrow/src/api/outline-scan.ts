import type { Texture } from 'pixi.js';
import { buildAtlasOutlines } from '../geometry/outlines';
import type { AtlasModel } from '../model/atlas';
import type { AtlasOutlines } from '../model/outlines';
import { createPageReader, type PageReader } from '../render/page-alpha';
import { pageAllowsCuts } from '../render/page-block';
import { isStillImage } from './textures';

/*
 * The scan that finds the outlines of an atlas at load time, when no file gives them. It reads
 * the pixels of one page per idle slice and builds the outlines of that page in the same slice,
 * so a frame is never held up by more than one page and one page of pixels is in memory at a time.
 */

/** The longest a slice waits for idle time before it runs anyway, in milliseconds. */
const IDLE_TIMEOUT = 1000;

/** A scan that is running or has ended. */
export interface OutlineScan {
    /**
     * The outlines, once every page was looked at. Undefined when the scan was stopped, and when
     * no page could be read. Never rejects.
     */
    readonly done: Promise<AtlasOutlines | undefined>;
    /** Ends the scan before its next page. `done` then resolves with undefined. */
    stop(): void;
}

/** What a scan works with. The defaults are those of a browser. */
export interface OutlineScanOptions {
    /** Reads the pixels of a page. Default: the reader of `createPageReader`. */
    reader?: PageReader;
    /** Runs a function when there is idle time. Default: `requestIdleCallback` where it exists, else a timer. */
    idle?: (run: () => void) => void;
}

function whenIdle(run: () => void): void {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => run(), { timeout: IDLE_TIMEOUT });
    else setTimeout(run, 0);
}

/**
 * Builds the outlines of an atlas from the pixels of its page textures, in idle time. Each
 * slice reads one page and builds the outlines of its regions.
 *
 * Some pages keep their quads, and their regions get no outline. That is a page whose pixels
 * cannot be read, and a page whose image can change. It is also a page whose texture is sampled
 * in a way outlines do not hold for: with mipmaps, or at another size than the atlas states.
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
    const reader = options.reader ?? createPageReader();
    const idle = options.idle ?? whenIdle;
    // no page yet: the header and one null per region
    const outlines = buildAtlasOutlines(atlas, []);
    let stopped = false;
    let read = 0;

    const scanPage = (index: number): void => {
        const source = textures[index]?.source;
        const page = atlas.pages[index];

        if (source === undefined || page === undefined) return;
        if (!pageAllowsCuts(source, page) || !isStillImage(source.resource)) return;
        const pixels = reader.read(source, page.pma);

        if (pixels === null || pixels.width !== page.width || pixels.height !== page.height) return;
        const built = buildAtlasOutlines(
            atlas,
            atlas.pages.map((_, i) => (i === index ? pixels : null)),
        );

        built.regions.forEach((region, at) => {
            if (region !== null) outlines.regions[at] = region;
        });
        read++;
    };
    const done = new Promise<AtlasOutlines | undefined>((resolve) => {
        const finish = (result: AtlasOutlines | undefined): void => {
            reader.release();
            resolve(result);
        };
        const step = (index: number): void => {
            if (stopped || index >= atlas.pages.length) {
                finish(stopped || read === 0 ? undefined : outlines);

                return;
            }
            try {
                scanPage(index);
            } catch {
                // a page that cannot be scanned keeps its quads
            }
            idle(() => step(index + 1));
        };

        idle(() => step(0));
    });

    return {
        done,
        stop() {
            stopped = true;
        },
    };
}
