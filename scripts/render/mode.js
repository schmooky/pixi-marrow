/*
 * Browser part of the render check and of the bench: the render mode of a display object of
 * pixi-marrow, as the option that asks for it and as the runtime reports it.
 *
 * The option is `renderMode: 'auto' | 'mesh' | 'batched'`. A tool must not take the mode it asked
 * for as the mode that drew: a runtime without the batched mode ignores the option and draws
 * meshes. So the mode is read back from the runtime, and a runtime that reports none has one
 * render path.
 */

/** The render modes a display object can draw in. `auto` picks one of them per skeleton. */
export const RENDER_MODES = ['mesh', 'batched'];

/**
 * The options of a display object for a render mode. `auto` is the default of the runtime, so it
 * passes no option at all: the object is created the way an application creates it.
 */
export const modeOptions = (mode) => (RENDER_MODES.includes(mode) ? { renderMode: mode } : {});

/** The mode a value names, or null. The value is a mode, or a text that starts with one. */
function modeIn(value) {
    return RENDER_MODES.find((mode) => typeof value === 'string' && value.startsWith(mode)) ?? null;
}

/**
 * The mode `stats.renderMode` of a display object names, or null. This is one read of a field,
 * for a loop over many instances.
 */
export const statMode = (spine) => modeIn(spine.stats?.renderMode);

/**
 * The render mode a display object draws in, as the runtime reports it: `stats.renderMode`, else
 * the value of the row `renderMode` of `perf.report()`. `mode` is null when the runtime reports
 * none. `reason` is what the report row says, or an empty string.
 *
 * Read it after the object was drawn once. `auto` may decide when it knows its render group.
 */
export async function readMode(spine) {
    const stat = statMode(spine);
    let row = null;

    try {
        row = (await spine.perf.report()).find((entry) => entry.feature === 'renderMode') ?? null;
    } catch {
        // a runtime without the report has no row
    }

    return { mode: stat ?? modeIn(row?.value), reason: row?.reason ?? '' };
}

/** How many of some display objects draw in each mode, and how many report none. */
export function countModes(spines) {
    const counts = { mesh: 0, batched: 0, unknown: 0 };

    for (const spine of spines) counts[statMode(spine) ?? 'unknown']++;

    return counts;
}

/**
 * The render mode some display objects of ours drew in, as the runtime reports it: `mesh` or
 * `batched` when all agree, `mixed` when they do not, null when the runtime reports no mode.
 * `counts` says how many objects reported which mode, where the runtime has `stats.renderMode`.
 */
export async function describeModes(objects) {
    const counts = countModes(objects);

    if (counts.unknown < objects.length) {
        const named = ['mesh', 'batched'].filter((mode) => counts[mode] > 0);

        return { renderMode: named.length === 1 && counts.unknown === 0 ? named[0] : 'mixed', counts };
    }
    // without the field the row of the report of the first object stands for all of them
    const [first] = objects;

    return { renderMode: first ? (await readMode(first)).mode : null, counts: null };
}
