/*
 * Browser part of scripts/check-render.mjs: cases about the cuts of overdraw that need no rig
 * of the fixtures, or that need another render target than the comparisons use.
 *
 * - The outlines of a premultiplied page must come from the bytes the GPU holds. A color under
 *   alpha 0 adds light there, and a 2D canvas returns such a pixel as black.
 * - A multisampled target moves edges inside a pixel, so both cuts must switch themselves off
 *   in the frame that is drawn to it, and the picture must be the one without cuts.
 */
import { BACKGROUNDS, compare, coverage, createStudio } from './pixels.js';

const message = (error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

/** The CRC of PNG chunks. */
function crc32(bytes) {
    let crc = 0xffffffff;

    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }

    return (crc ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data, CRC. */
function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);

    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));

    return out;
}

/**
 * Encodes RGBA bytes as a PNG without touching them. A canvas cannot do this: it keeps colors
 * multiplied by alpha, so a color under alpha 0 would be gone before the file is written.
 */
async function encodePng(rgba, width, height) {
    const rows = new Uint8Array(height * (width * 4 + 1));
    const header = new Uint8Array(13);

    for (let y = 0; y < height; y++) {
        rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
    }
    new DataView(header.buffer).setUint32(0, width);
    new DataView(header.buffer).setUint32(4, height);
    header.set([8, 6, 0, 0, 0], 8);
    const packed = new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate')));
    const parts = [
        Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
        chunk('IHDR', header),
        chunk('IDAT', new Uint8Array(await packed.arrayBuffer())),
        chunk('IEND', new Uint8Array(0)),
    ];

    return new Blob(parts, { type: 'image/png' });
}

/** A skeleton of one slot that shows one region, and the atlas of a premultiplied page of 2 by 2 pixels. */
const SPOT_SKELETON = JSON.stringify({
    skeleton: { spine: '4.2.0' },
    bones: [{ name: 'root' }],
    slots: [{ name: 'spot', bone: 'root', attachment: 'spot' }],
    skins: [{ name: 'default', attachments: { spot: { spot: { width: 2, height: 2 } } } }],
    animations: {},
});
const SPOT_ATLAS = [
    'page.png',
    'size: 2, 2',
    'filter: Nearest, Nearest',
    'pma: true',
    'spot',
    'bounds: 0, 0, 2, 2',
    '',
];

/**
 * The reading of a premultiplied page. The page has one pixel with alpha 0 and a red of 200,
 * and three clear pixels. Drawn with premultiplied blending the red pixel adds light.
 *
 * The 2D canvas must lose the red, which is why it cannot be the source of outlines for such a
 * page. The outlines the library reads must call the region visible. And the picture with the
 * default cuts must show the light and equal the picture without cuts: had the scan read the
 * page through a canvas, the region would count as empty and would not be drawn.
 */
export async function premultipliedReadingCase(env, core) {
    const { PIXI, lib } = env;
    const reasons = [];
    const info = {};

    try {
        const rgba = Uint8Array.of(200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        const bitmap = await createImageBitmap(await encodePng(rgba, 2, 2), {
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none',
        });
        const canvas = document.createElement('canvas');

        canvas.width = 2;
        canvas.height = 2;
        const context = canvas.getContext('2d');

        context.drawImage(bitmap, 0, 0);
        info.canvas = Array.from(context.getImageData(0, 0, 2, 2).data.subarray(0, 4));
        if (info.canvas.some((byte) => byte !== 0)) {
            reasons.push(
                `the 2D canvas returned ${info.canvas.join(',')} for a red under alpha 0, so the case proves nothing`,
            );
        }
        const texture = new PIXI.Texture({ source: new PIXI.ImageSource({ resource: bitmap }) });
        const asset = await lib.MarrowAsset.from({
            model: await core.importSkeleton(SPOT_SKELETON),
            atlas: core.importAtlas(SPOT_ATLAS.join('\n')),
            textures: [texture],
        });

        await asset.optimized;
        const region = asset.outlines?.regions[0];

        info.outline = region ? (region.polygon === null ? 'quad' : `${region.polygon.length / 2} vertices`) : 'none';
        if (!region) reasons.push('the scan read no outline for the page');
        else if (region.polygon?.length === 0)
            reasons.push('the scan calls the region empty: it did not see the red under alpha 0');
        const studio = createStudio(PIXI, env.renderer, 64, env.draws);
        const shots = [];

        for (const options of [{}, { tightMesh: 'off', occlusion: 'off' }]) {
            const spine = new lib.MarrowSpine(asset, { autoUpdate: false, ...options });
            const root = new PIXI.Container();

            root.addChild(spine);
            spine.position.set(32, 32);
            spine.scale.set(16);
            spine.update(0);
            shots.push((await studio.shoot(root, BACKGROUNDS.clear)).pixels);
            root.removeChild(spine);
            spine.destroy();
        }
        info.lit = coverage(shots[0], BACKGROUNDS.clear);
        info.max = compare(shots[0], shots[1], 64, BACKGROUNDS.clear).max;
        if (info.lit === 0)
            reasons.push('the picture with the default cuts is empty: the light of the red pixel is gone');
        if (info.max > 0) reasons.push(`the pictures with and without cuts differ by ${info.max}`);
        asset.destroy();
    } catch (error) {
        reasons.push(message(error));
    }

    return { label: 'premultiplied page reading', kind: 'reading', reasons, info };
}

/**
 * A multisampled target. Ours with the default cuts and ours with polygons are drawn to it right
 * after an update. Both must notice the target while Pixi draws and lay themselves out as quads
 * for that frame. Each picture must then equal the one of an instance without cuts, to the bit.
 * A rig that shows meshes only has no polygon to take back. The report says how many there were.
 */
export async function multisampledCase(env, plan) {
    const { PIXI, lib } = env;
    const reasons = [];
    const info = {};
    const url = (file) => `/fixtures/ours/${plan.version}/${file}`;
    const [sequence] = plan.sequences;
    const made = [];

    try {
        const asset = await lib.MarrowAsset.load({ skeleton: url(plan.files.skel), atlas: url(plan.files.atlas) });

        await asset.optimized;
        const studio = createStudio(PIXI, env.renderer, plan.size, env.draws, true);
        const shots = {};

        for (const [key, options] of [
            ['off', { tightMesh: 'off', occlusion: 'off' }],
            ['default', {}],
            ['polygons', { tightMesh: 'on' }],
        ]) {
            const spine = new lib.MarrowSpine(asset, { autoUpdate: false, ...options });
            const root = new PIXI.Container();

            made.push(spine);
            root.addChild(spine);
            if (sequence.skin) spine.skin = sequence.skin;
            spine.position.set(plan.placement.x, plan.placement.y);
            spine.scale.set(plan.placement.scale);
            spine.play(sequence.animation, { loop: true });
            spine.update(0);
            spine.update(sequence.dt * 7);
            const before = { ...spine.stats };

            shots[key] = (await studio.shoot(root, BACKGROUNDS.solid)).pixels;
            info[key] = {
                tightBefore: before.tightRanges,
                tightAfter: spine.stats.tightRanges,
                builds: spine.stats.templateBuilds - before.templateBuilds,
            };
        }
        for (const key of ['default', 'polygons']) {
            const { max } = compare(shots[key], shots.off, plan.size, BACKGROUNDS.solid);

            info[key].max = max;
            if (max > 0) reasons.push(`${key}: differs from the picture without cuts by ${max}`);
            if (info[key].tightAfter > 0) reasons.push(`${key}: ${info[key].tightAfter} polygons are still laid out`);
        }
    } catch (error) {
        reasons.push(message(error));
    } finally {
        for (const spine of made) spine.destroy();
    }

    return { label: 'multisampled target', kind: 'multisampled', reasons, info };
}
