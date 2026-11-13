import { fillColors } from './colors';
import { u8 } from './read';
import type { Template } from './template';

/*
 * The colors per vertex of a template that a batch drew. Only the mesh mode without a palette
 * needs them, so this is a part of the code of the mesh mode that loads on demand.
 */

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

        fillColors(template, entry, 0, u8(light, t), u8(light, t + 1), u8(light, t + 2), u8(light, t + 3));
        if (hasDark) fillColors(template, entry, 4, u8(dark, t), u8(dark, t + 1), u8(dark, t + 2), u8(dark, t + 3));
    }
}
