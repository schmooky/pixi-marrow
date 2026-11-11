/**
 * Writes a hex color string as r, g, b, a floats, the way the official `Color.setFromString` reads it.
 * The string holds `rrggbb` or `rrggbbaa`, with an optional `#` in front. Without alpha, a is 1.
 */
export function writeHexColor(hex: string, out: Float64Array, offset: number): void {
    const digits = hex.charAt(0) === '#' ? hex.slice(1) : hex;

    out[offset] = Number.parseInt(digits.slice(0, 2), 16) / 255;
    out[offset + 1] = Number.parseInt(digits.slice(2, 4), 16) / 255;
    out[offset + 2] = Number.parseInt(digits.slice(4, 6), 16) / 255;
    out[offset + 3] = digits.length !== 8 ? 1 : Number.parseInt(digits.slice(6, 8), 16) / 255;
}

/** Writes a 32-bit RGBA value as r, g, b, a floats. */
export function writeRgba8888(value: number, out: Float64Array, offset: number): void {
    out[offset] = ((value & 0xff000000) >>> 24) / 255;
    out[offset + 1] = ((value & 0x00ff0000) >>> 16) / 255;
    out[offset + 2] = ((value & 0x0000ff00) >>> 8) / 255;
    out[offset + 3] = (value & 0x000000ff) / 255;
}

/** Writes a 24-bit RGB value as r, g, b floats. */
export function writeRgb888(value: number, out: Float64Array, offset: number): void {
    out[offset] = ((value & 0x00ff0000) >>> 16) / 255;
    out[offset + 1] = ((value & 0x0000ff00) >>> 8) / 255;
    out[offset + 2] = (value & 0x000000ff) / 255;
}
