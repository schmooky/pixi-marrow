import { Color } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { colorByte, darkByte } from '../../src/render/colors';
import { type Drawn, loadRig, meshes, play, type Rig, readDrawn, slotIndex, step, vertexData } from './rig';

/*
 * The reference below is the code of the official Pixi runtime, copied: `Spine.transformAttachments`
 * multiplies the colors, `BatchableSpineSlot` packs them, and `DarkTintBatcher.packAttributes`
 * premultiplies the dark color with Pixi's `Color`. The parent is white and opaque.
 */

type Rgba = readonly [number, number, number, number];
type Rgb = readonly [number, number, number];

const clamp = (value: number): number => Math.min(Math.max(value, 0), 1);

/** Four numbers of an array as a color. */
const rgba = (values: ArrayLike<number>, at = 0): Rgba => [
    values[at] ?? 0,
    values[at + 1] ?? 0,
    values[at + 2] ?? 0,
    values[at + 3] ?? 0,
];

/** `cacheData.color.set(...)`, then `BatchableSpineSlot.color`. */
function officialLight(slot: Rgba, attachment: Rgba): number {
    const r = clamp(1 * slot[0] * attachment[0]);
    const g = clamp(1 * slot[1] * attachment[1]);
    const b = clamp(1 * slot[2] * attachment[2]);
    const a = clamp(1 * slot[3] * attachment[3]);
    const mixedA = a * 1 * 255;

    return ((mixedA << 24) | ((b * 255) << 16) | ((g * 255) << 8) | (r * 255)) >>> 0;
}

/** `BatchableSpineSlot.darkColor`, then the dark color of `DarkTintBatcher.packAttributes`. */
function officialDark(dark: Rgb, argb: number): number {
    const darkColor = ((dark[2] * 255) << 16) | ((dark[1] * 255) << 8) | (dark[0] * 255);
    const worldAlpha = ((argb >> 24) & 0xff) / 255;

    return Color.shared.setValue(darkColor).premultiply(worldAlpha, true).toPremultiplied(1, false) >>> 0;
}

/** The dark color of a slot without one: black, with the alpha of 1 the official runtime uploads. */
const NO_DARK = 0xff000000;

/** Four bytes as one number, red lowest: what a `Uint32Array` over the color buffer reads. */
const pack = (r: number, g: number, b: number, a: number): number => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** The light color bytes of the view for a slot color and an attachment color. */
const light = (slot: Rgba, attachment: Rgba): number =>
    pack(
        colorByte(slot[0] * attachment[0]),
        colorByte(slot[1] * attachment[1]),
        colorByte(slot[2] * attachment[2]),
        colorByte(slot[3] * attachment[3]),
    );

/** The dark color bytes of the view for a dark color and the alpha byte of the light color. */
const dark = (color: Rgb, alpha: number): number =>
    pack(darkByte(color[0], alpha), darkByte(color[1], alpha), darkByte(color[2], alpha), 255);

/** A repeatable stream of numbers from 0 to 1, with both ends in it. */
function* samples(count: number): Generator<number> {
    let seed = 12345;

    yield 0;
    yield 1;
    for (let i = 0; i < count; i++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        yield seed / 2147483647;
    }
}

/** The colors of the vertices of a drawn slot: every vertex must hold the same. */
function colorsOf(rig: Rig, drawn: Drawn, stride: number): { light: number; dark: number } {
    const { colors } = vertexData(rig.view);
    const all = Array.from(colors.subarray(drawn.first * stride, (drawn.first + drawn.count) * stride));
    const lights = new Set(all.filter((_, i) => i % stride === 0));
    const darks = new Set(all.filter((_, i) => i % stride === 1));

    expect(lights.size).toBe(1);
    expect(darks.size).toBeLessThanOrEqual(1);

    return { light: all[0] ?? -1, dark: all[1] ?? -1 };
}

describe('packed colors', () => {
    it('packs the light color as the official runtime does', () => {
        const values = [...samples(40)];

        expect(light([1, 1, 1, 1], [1, 1, 1, 1])).toBe(0xffffffff);
        expect(light([1, 0.5, 0.25, 0.75], [1, 1, 1, 1])).toBe(0xbf3f7fff);
        for (let i = 0; i + 7 < values.length; i++) {
            const slot = rgba(values, i);
            const attachment = rgba(values, i + 4);

            expect(light(slot, attachment)).toBe(officialLight(slot, attachment));
        }
    });

    it('clamps a channel outside 0 to 1', () => {
        expect(light([2, -1, Number.NaN, 1.5], [1, 1, 1, 1])).toBe(0xff0000ff);
    });

    it('packs the dark color as the official runtime does, for every dark byte and every alpha', () => {
        const problems: string[] = [];

        expect(dark([1, 1, 1], 255)).toBe(0xffffffff);
        expect(dark([1, 0.5, 0], 0)).toBe(NO_DARK);
        for (let byte = 0; byte < 256; byte++) {
            // three channels that are cut to byte, to 255 - byte and to half of byte
            const color: Rgb = [(byte + 0.5) / 255, (255.5 - byte) / 255, (byte / 2 + 0.25) / 255];

            for (let alpha = 0; alpha < 256; alpha++) {
                const argb = ((alpha << 24) | 0x808080) >>> 0;

                if (dark(color, alpha) !== officialDark(color, argb)) problems.push(`dark ${byte}, alpha ${alpha}`);
            }
        }
        expect(problems).toEqual([]);
    });
});

describe('vertex colors of the view', () => {
    it('uploads colors only when a color changes by a byte', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');
        const { state } = rig.engine;
        const { stats } = rig.view;
        const head = slotIndex(rig, 'head');
        const colorOfHead = (): number => {
            const drawn = readDrawn(rig).find((item) => item.slot === head);

            if (drawn === undefined) throw new Error('the head is visible');

            return colorsOf(rig, drawn, 1).light;
        };

        play(rig, 'walk');
        for (let frame = 0; frame < 30; frame++) step(rig);
        expect(stats.colorUploads).toBe(1);
        expect(colorOfHead()).toBe(0xffffffff);
        // a skeleton without dark colors keeps one color per vertex and has no dark attribute
        expect(vertexData(rig.view).colors.length).toBe(stats.vertices);
        expect(meshes(rig.view)[0]?.geometry.getAttribute('aDark')).toBeUndefined();

        state.colors.set([0.5, 0.25, 1, 0.75], head * 4);
        rig.view.update(state);
        expect(stats.colorUploads).toBe(2);
        expect(colorOfHead()).toBe(officialLight([0.5, 0.25, 1, 0.75], [1, 1, 1, 1]));
        rig.view.update(state);
        expect(stats.colorUploads).toBe(2);
        // less than a byte: the vertices hold the same bytes
        state.colors[head * 4] = 0.501;
        rig.view.update(state);
        expect(stats.colorUploads).toBe(2);
        expect(stats.indexRebuilds).toBe(1);
    });

    it('multiplies the slot color by the attachment color', async () => {
        const tint: Rgba = [0.5, 0.75, 0.25, 0.5];
        const rig = await loadRig('4.2/spineboy-pro.skel', (model) => {
            for (const { name, attachment } of model.skins.flatMap((skin) => skin.attachments)) {
                if (name === 'head' && attachment.type !== 'clipping' && 'color' in attachment)
                    attachment.color.set(tint);
            }
        });
        const head = slotIndex(rig, 'head');

        rig.engine.state.colors.set([0.9, 0.8, 0.7, 0.6], head * 4);
        rig.view.update(rig.engine.state);
        const drawn = readDrawn(rig).find((item) => item.slot === head);

        if (drawn === undefined) throw new Error('the head is visible');
        expect(colorsOf(rig, drawn, 1).light).toBe(officialLight([0.9, 0.8, 0.7, 0.6], tint));
    });

    it('writes the colors of an attachment when a slot starts to show it', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');
        const { state } = rig.engine;
        const eye = slotIndex(rig, 'eye');
        const other = rig.lookup.find(state.skin, eye, 'eye-surprised');

        step(rig, 0);
        state.colors.set([0.2, 0.4, 0.6, 0.8], eye * 4);
        rig.view.update(state);
        expect(rig.view.stats.colorUploads).toBe(2);
        if (other === undefined) throw new Error('spineboy has a second eye');
        state.attachments[eye] = other;
        rig.view.update(state);
        expect(rig.view.stats.colorUploads).toBe(3);
        const drawn = readDrawn(rig).find((item) => item.slot === eye);

        if (drawn === undefined) throw new Error('the eye is visible');
        expect(drawn.attachment).toBe(other);
        expect(colorsOf(rig, drawn, 1).light).toBe(officialLight([0.2, 0.4, 0.6, 0.8], [1, 1, 1, 1]));
    });

    it.each(['4.1/tank-pro.skel', '4.2/coin-pro.skel', '4.3/alien-pro.skel'])(
        'keeps a dark color per vertex for %s',
        async (id) => {
            const rig = await loadRig(id);
            const { state } = rig.engine;
            const { hasDark } = rig.model.slots;
            let withDark = 0;

            expect(hasDark.includes(1)).toBe(true);
            for (const animation of rig.model.animations) {
                play(rig, animation.name);
                for (let frame = 0; frame < 6; frame++) {
                    step(rig, animation.duration / 5.5);
                    for (const drawn of readDrawn(rig)) {
                        const { slot, attachment } = drawn;
                        const expected = officialLight(rgba(state.colors, slot * 4), rgba(attachment.color));
                        const [r, g, b] = rgba(state.darkColors, slot * 3);
                        const colors = colorsOf(rig, drawn, 2);

                        expect(colors.light).toBe(expected);
                        expect(colors.dark).toBe(hasDark[slot] === 1 ? officialDark([r, g, b], expected) : NO_DARK);
                        if (hasDark[slot] === 1) withDark++;
                    }
                }
            }
            expect(withDark).toBeGreaterThan(0);
            expect(vertexData(rig.view).colors.length).toBe(rig.view.stats.vertices * 2);
            expect(meshes(rig.view)[0]?.geometry.getAttribute('aDark')).toMatchObject({
                format: 'unorm8x4',
                stride: 8,
                offset: 4,
            });
        },
    );
});
