import { f64, i32 } from '../geometry/read';
import { u8 } from './read';
import type { Template } from './template';

/*
 * Vertex colors, as the official Pixi runtime packs them. `BatchableSpineSlot` cuts every channel
 * to a byte. `DarkTintBatcher` then multiplies the dark color by the alpha of the light color with
 * Pixi's `Color`, which keeps 32-bit floats and cuts off again. A skeleton in an untinted
 * container gets the bytes the official runtime uploads. A test compares every byte.
 *
 * Colors are handled as single bytes on purpose. A color packed into one 32-bit number is too
 * large for a small integer of the JavaScript engine, so passing it around can allocate.
 */

/**
 * One color channel as the byte the official runtime uploads: clamped to 0 and 1, then cut off,
 * not rounded.
 *
 * @example
 * const red = colorByte(state.colors[slot * 4] * attachment.color[0]);
 */
export function colorByte(value: number): number {
    if (value >= 1) return 255;

    return value > 0 ? (value * 255) | 0 : 0;
}

/**
 * A dark color channel as the byte the official runtime uploads: cut to a byte, multiplied by the
 * alpha byte of the light color, cut off again. Pixi's `Color` gets there in 32-bit float steps,
 * which for every pair of bytes end at this whole number.
 *
 * @example
 * const alpha = colorByte(state.colors[slot * 4 + 3]);
 * const darkRed = darkByte(state.darkColors[slot * 3], alpha);
 */
export function darkByte(value: number, alpha: number): number {
    return ((colorByte(value) * alpha) / 255) | 0;
}

/**
 * Writes four bytes to every vertex of an entry, `offset` bytes into the colors of the vertex.
 * A template without vertex colors keeps the color of the entry alone.
 */
function fill(template: Template, entry: number, offset: number, r: number, g: number, b: number, a: number): void {
    const { colors } = template;
    const stride = template.hasDark ? 8 : 4;

    if (colors.length === 0) return;
    const first = i32(template.first, entry) * stride;
    const end = first + i32(template.counts, entry) * stride;

    for (let at = first + offset; at < end; at += stride) {
        colors[at] = r;
        colors[at + 1] = g;
        colors[at + 2] = b;
        colors[at + 3] = a;
    }
}

/** Whether four bytes of an array are r, g, b, a. */
function holds(bytes: Uint8Array, at: number, r: number, g: number, b: number, a: number): boolean {
    return u8(bytes, at) === r && u8(bytes, at + 1) === g && u8(bytes, at + 2) === b && u8(bytes, at + 3) === a;
}

/**
 * Brings the light color of the vertices of an entry in line with a slot: the slot color times
 * the attachment color, straight alpha, as bytes r, g, b, a. Writes only when the bytes differ
 * from what the vertices hold. Returns whether it wrote.
 *
 * `slotColors` is `PoseState.colors`.
 *
 * @example
 * if (writeLight(template, entry, state.colors, slot)) colorBuffer.update();
 */
export function writeLight(template: Template, entry: number, slotColors: Float64Array, slot: number): boolean {
    const { tints, light } = template;
    const c = slot * 4;
    const t = entry * 4;
    const r = colorByte(f64(slotColors, c) * f64(tints, t));
    const g = colorByte(f64(slotColors, c + 1) * f64(tints, t + 1));
    const b = colorByte(f64(slotColors, c + 2) * f64(tints, t + 2));
    const a = colorByte(f64(slotColors, c + 3) * f64(tints, t + 3));

    if (holds(light, t, r, g, b, a)) return false;
    light[t] = r;
    light[t + 1] = g;
    light[t + 2] = b;
    light[t + 3] = a;
    fill(template, entry, 0, r, g, b, a);

    return true;
}

/**
 * Brings the dark color of the vertices of an entry in line with a slot. The bytes are the dark
 * color times the alpha byte of the light color that {@link writeLight} wrote, then an alpha of
 * 255. A slot without a dark color gets black. Writes only when the bytes differ from what the
 * vertices hold. Returns whether it wrote. The template must have room for dark colors.
 *
 * `darkColors` is `PoseState.darkColors`. `hasDark` says whether the slot has a dark color.
 *
 * @example
 * const wrote = writeLight(template, entry, state.colors, slot);
 * if (writeDark(template, entry, state.darkColors, slot, model.slots.hasDark[slot] === 1) || wrote) {
 *     colorBuffer.update();
 * }
 */
export function writeDark(
    template: Template,
    entry: number,
    darkColors: Float64Array,
    slot: number,
    hasDark: boolean,
): boolean {
    const { dark } = template;
    const t = entry * 4;
    const d = slot * 3;
    const alpha = u8(template.light, t + 3);
    const r = hasDark ? darkByte(f64(darkColors, d), alpha) : 0;
    const g = hasDark ? darkByte(f64(darkColors, d + 1), alpha) : 0;
    const b = hasDark ? darkByte(f64(darkColors, d + 2), alpha) : 0;

    if (holds(dark, t, r, g, b, 255)) return false;
    dark[t] = r;
    dark[t + 1] = g;
    dark[t + 2] = b;
    dark[t + 3] = 255;
    fill(template, entry, 4, r, g, b, 255);

    return true;
}

/**
 * Gives a template that was built without vertex colors its color per vertex, from the colors
 * its entries hold. Does nothing for a template that has them. The mesh mode calls it before
 * it draws a layout that a batch drew before.
 *
 * @example
 * restoreColors(template);
 * colorBuffer.data = template.colors;
 */
export function restoreColors(template: Template): void {
    const { light, dark, hasDark } = template;

    if (template.colors.length > 0) return;
    // a GPU buffer cannot be empty, so there is room for one vertex at least
    template.colors = new Uint8Array(Math.max(template.vertexCount, 1) * (hasDark ? 8 : 4));
    for (let entry = 0; entry < template.slots.length; entry++) {
        const t = entry * 4;

        fill(template, entry, 0, u8(light, t), u8(light, t + 1), u8(light, t + 2), u8(light, t + 3));
        if (hasDark) fill(template, entry, 4, u8(dark, t), u8(dark, t + 1), u8(dark, t + 2), u8(dark, t + 3));
    }
}
