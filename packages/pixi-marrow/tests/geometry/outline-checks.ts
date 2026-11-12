import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importAtlas } from '../../src/formats/atlas';
import type { AtlasModel } from '../../src/model/atlas';
import type { PageRect } from '../../src/model/outlines';
import { decodePng, type PngImage } from '../../src/optimize/png';

/*
 * What the outline tests share. The checks here are written on their own, without the code
 * under test: they walk every pixel, where the library walks row ends and histograms.
 */

const root = fileURLToPath(new URL('../../../../', import.meta.url));

/** An atlas of the official examples whose page images are downloaded. */
export interface AtlasFixture {
    /** For example `4.2/spineboy.atlas`. */
    id: string;
    rig: string;
    path: string;
}

interface ManifestAtlas {
    atlas: { path: string };
    images?: { path: string }[];
}

interface ManifestEntry extends ManifestAtlas {
    version: string;
    rig: string;
    pma?: ManifestAtlas;
}

/** Every fixture atlas with images: the plain ones and the premultiplied ones. */
export function listAtlasFixtures(): AtlasFixture[] {
    const manifest: { files: ManifestEntry[] } = JSON.parse(readFileSync(join(root, 'fixtures/manifest.json'), 'utf8'));

    return manifest.files.flatMap((entry) =>
        [entry, entry.pma].flatMap((files) => {
            if (files?.images === undefined) return [];
            const path = join(root, 'fixtures/.cache', entry.version, basename(files.atlas.path));

            if (!existsSync(path)) throw new Error(`${files.atlas.path} is not downloaded. Run: pnpm fixtures`);

            return [{ id: `${entry.version}/${basename(path)}`, rig: entry.rig, path }];
        }),
    );
}

const loaded = new Map<string, Promise<{ atlas: AtlasModel; pages: PngImage[] }>>();

/** The atlas of a fixture and its decoded pages. Decoded once per test file. */
export function loadAtlasFixture(fixture: AtlasFixture): Promise<{ atlas: AtlasModel; pages: PngImage[] }> {
    const cached = loaded.get(fixture.path);

    if (cached !== undefined) return cached;
    const load = async (): Promise<{ atlas: AtlasModel; pages: PngImage[] }> => {
        const atlas = importAtlas(readFileSync(fixture.path, 'utf8'));
        const pages: PngImage[] = [];

        for (const page of atlas.pages) {
            pages.push(
                await decodePng(new Uint8Array(readFileSync(join(dirname(fixture.path), page.name))), page.name),
            );
        }

        return { atlas, pages };
    };
    const promise = load();

    loaded.set(fixture.path, promise);

    return promise;
}

/** A page of alpha values, painted by a function of the pixel position. */
export function paintAlpha(width: number, height: number, alphaAt: (x: number, y: number) => number): Uint8Array {
    const alpha = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) alpha[y * width + x] = alphaAt(x, y);

    return alpha;
}

/** A random number generator with a seed, so that a failing case can be run again. */
export function seeded(seed: number): () => number {
    let state = seed >>> 0;

    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;

        return state / 0x100000000;
    };
}

const at = (values: ArrayLike<number>, index: number): number => {
    const value = values[index];

    if (value === undefined) throw new Error(`no number at ${index}`);

    return value;
};

/** How far the box x0..x1, y0..y1 sticks out of a convex polygon with a positive shoelace sum. 0 when inside. */
export function boxOutside(polygon: ArrayLike<number>, x0: number, y0: number, x1: number, y1: number): number {
    const count = polygon.length / 2;
    let worst = 0;

    for (let i = 0; i < count; i++) {
        const next = (i + 1) % count;
        const ax = at(polygon, i * 2);
        const ay = at(polygon, i * 2 + 1);
        const dx = at(polygon, next * 2) - ax;
        const dy = at(polygon, next * 2 + 1) - ay;
        // the corner of the box that lies farthest out across this edge
        const x = dy > 0 ? x1 : x0;
        const y = dx > 0 ? y0 : y1;
        const inside = (dx * (y - ay) - dy * (x - ax)) / Math.hypot(dx, dy);

        worst = Math.max(worst, -inside);
    }

    return count < 3 ? Number.POSITIVE_INFINITY : worst;
}

/** The first visible pixel whose square, grown by the margin and cut to the rectangle, leaves the polygon. */
export function findCutPixel(
    alpha: Uint8Array,
    pageWidth: number,
    pageHeight: number,
    rect: PageRect,
    margin: number,
    polygon: ArrayLike<number>,
    tolerance = 1e-9,
): string | null {
    const ring = margin > 0 ? 1 : 0;
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;

    for (let y = Math.max(0, rect.y - ring); y < Math.min(pageHeight, bottom + ring); y++) {
        for (let x = Math.max(0, rect.x - ring); x < Math.min(pageWidth, right + ring); x++) {
            if (alpha[y * pageWidth + x] === 0) continue;
            const x0 = Math.max(rect.x, x - margin);
            const x1 = Math.min(right, x + 1 + margin);
            const y0 = Math.max(rect.y, y - margin);
            const y1 = Math.min(bottom, y + 1 + margin);
            const outside = boxOutside(polygon, x0, y0, x1, y1);

            if (outside > tolerance) return `pixel ${x}, ${y} is cut by ${outside} pixels`;
        }
    }

    return null;
}

/** Whether the rectangle, grown by `ring` pixels and cut to the page, has a pixel with alpha above 0. */
export function anyVisible(
    alpha: Uint8Array,
    pageWidth: number,
    pageHeight: number,
    rect: PageRect,
    ring: number,
): boolean {
    for (let y = Math.max(0, rect.y - ring); y < Math.min(pageHeight, rect.y + rect.height + ring); y++) {
        for (let x = Math.max(0, rect.x - ring); x < Math.min(pageWidth, rect.x + rect.width + ring); x++) {
            if (alpha[y * pageWidth + x] !== 0) return true;
        }
    }

    return false;
}

/** Whether a polygon turns the same way at every vertex, with a positive shoelace sum, and has no flat corner. */
export function isConvex(polygon: ArrayLike<number>): boolean {
    const count = polygon.length / 2;

    for (let i = 0; i < count; i++) {
        const b = ((i + 1) % count) * 2;
        const c = ((i + 2) % count) * 2;
        const ax = at(polygon, i * 2);
        const ay = at(polygon, i * 2 + 1);

        if (
            (at(polygon, b) - ax) * (at(polygon, c + 1) - ay) - (at(polygon, b + 1) - ay) * (at(polygon, c) - ax) <=
            0
        ) {
            return false;
        }
    }

    return count >= 3;
}

/** The area of the triangles, each counted with the sign of its winding. */
export function triangleArea(polygon: ArrayLike<number>, triangles: ArrayLike<number>): number {
    let sum = 0;

    for (let i = 0; i < triangles.length; i += 3) {
        const a = at(triangles, i) * 2;
        const b = at(triangles, i + 1) * 2;
        const c = at(triangles, i + 2) * 2;
        const ax = at(polygon, a);
        const ay = at(polygon, a + 1);

        sum +=
            ((at(polygon, b) - ax) * (at(polygon, c + 1) - ay) - (at(polygon, b + 1) - ay) * (at(polygon, c) - ax)) / 2;
    }

    return sum;
}

/** Per corner x, y of the region: how many pixels above and left of it are not opaque. One row and column more than pixels. */
function holeSums(alpha: Uint8Array, pageWidth: number, rect: PageRect): Int32Array {
    const stride = rect.width + 1;
    const sums = new Int32Array(stride * (rect.height + 1));

    for (let y = 0; y < rect.height; y++) {
        for (let x = 0; x < rect.width; x++) {
            const hole = alpha[(rect.y + y) * pageWidth + rect.x + x] === 255 ? 0 : 1;

            sums[(y + 1) * stride + x + 1] =
                hole + at(sums, y * stride + x + 1) + at(sums, (y + 1) * stride + x) - at(sums, y * stride + x);
        }
    }

    return sums;
}

/**
 * The largest area a rectangle of opaque pixels has after `margin` is taken off on every side,
 * by trying every rectangle of the region. 0 when none is left. For small regions only.
 */
export function bruteOpaqueArea(alpha: Uint8Array, pageWidth: number, rect: PageRect, margin: number): number {
    const { width, height } = rect;
    const stride = width + 1;
    const sums = holeSums(alpha, pageWidth, rect);
    const holes = (x0: number, y0: number, x1: number, y1: number): number =>
        at(sums, y1 * stride + x1) -
        at(sums, y0 * stride + x1) -
        at(sums, y1 * stride + x0) +
        at(sums, y0 * stride + x0);
    const left = (size: number): number => Math.max(0, size - margin * 2);
    let best = 0;

    for (let y0 = 0; y0 < height; y0++) {
        for (let y1 = y0 + 1; y1 <= height; y1++) {
            for (let x0 = 0; x0 < width; x0++) {
                let x1 = x0;

                // every width from this corner, until a hole comes in: the widest one is the largest
                while (x1 < width && holes(x0, y0, x1 + 1, y1) === 0) x1++;
                best = Math.max(best, left(x1 - x0) * left(y1 - y0));
            }
        }
    }

    return best;
}

/** Whether every pixel that the rectangle touches, grown by `margin`, has alpha 255. */
export function isOpaque(alpha: Uint8Array, pageWidth: number, rect: PageRect, margin: number): boolean {
    for (let y = Math.floor(rect.y - margin); y < Math.ceil(rect.y + rect.height + margin); y++) {
        for (let x = Math.floor(rect.x - margin); x < Math.ceil(rect.x + rect.width + margin); x++) {
            if (alpha[y * pageWidth + x] !== 255) return false;
        }
    }

    return true;
}
