/*
 * The warning for options that need outlines, on an asset that has none. Most games never set
 * such an option, so the words load on demand, see `warnWithoutOutlines` in checks.ts.
 */

/** The assets that warned. Each one warns once. */
const warned = new WeakSet<object>();

/**
 * Warns once per asset that options set by name do nothing, because the asset has no outlines
 * of the atlas regions.
 *
 * @param tight The `tightMesh` value that was set by name, or undefined.
 * @param occlusion True when `occlusion: 'auto'` was set by name.
 *
 * @example
 * warnOnce(asset, 'on', false);
 */
export function warnOnce(asset: object, tight: string | undefined, occlusion: boolean): void {
    if (warned.has(asset)) return;
    warned.add(asset);
    const named = [tight === undefined ? '' : `tightMesh: '${tight}'`, occlusion ? "occlusion: 'auto'" : ''];

    console.warn(
        `pixi-marrow: the asset has no outlines of the atlas regions, so these options do nothing: ${named.filter(Boolean).join(', ')}. ` +
            "Load the asset with outlines: 'auto', or with the file of pixi-marrow outlines.",
    );
}
