/**
 * The most bytes, gzipped, that the root import may have for a game that imports `MarrowSpine`.
 * `pnpm size:check` fails above it, whatever ci/size-baseline.json says, and the verdict of M6 in
 * scripts/bench/verdict-m6.mjs judges by it.
 *
 * Raising the limit takes a commit of its own that says why the root import must grow. It is not
 * part of the change that needs the room, and `pnpm size:update` does not move it.
 *
 * The list of M6 said 27 kB. Bone handles and `follow` came after it and must work at once, so
 * they are in the root: 29 kB. The support for Pixi `Assets` added 0.2 kB to a game that does not
 * register it: 30 kB. The slot handle and several skins: 31 kB. The perf presets and the pacing,
 * which must work at once, and the hooks of the idle cache and of baked playback: 32 kB.
 * The fixes of the audit of 2026-11-15 added 0.25 kB that must run at once: the check for
 * WebGL1, pacing that sees a hidden parent, a skin that is set again as a no-op, the reuse of
 * freed skin indices and the hook of the outline warning: 32.5 kB.
 */
export const ROOT_IMPORT_LIMIT = 32.5 * 1024;

/** The import of scripts/size-check.mjs, and the entry of ci/size-baseline.json, that the limit is for. */
export const ROOT_IMPORT_ENTRY = 'root (MarrowSpine)';

/**
 * The most bytes, gzipped, of code that loads on demand: what a game downloads the first time a
 * skeleton needs a reader, a pose engine, the mesh mode or the code for clips. The keys are those
 * of `ON_DEMAND` in scripts/size-check.mjs. Each limit is the size of 2026-11-15 plus 3 percent,
 * rounded up to half a kilobyte.
 *
 * The root import stays small because code moves into these chunks. Without a limit they can
 * grow without a word. Raise one as the root limit is raised: in a commit of its own that says why.
 */
export const ON_DEMAND_LIMITS = {
    'on demand (reader of 4.1 and 4.2 JSON)': 9.5 * 1024,
    'on demand (reader of 4.1 and 4.2 binary)': 9.5 * 1024,
    'on demand (reader of 4.3 JSON)': 9 * 1024,
    'on demand (reader of 4.3 binary)': 9 * 1024,
    'on demand (pose engine of 4.1 and 4.2)': 32.5 * 1024,
    'on demand (pose engine of 4.3)': 34 * 1024,
    'on demand (mesh mode)': 18 * 1024,
    'on demand (clipping)': 8 * 1024,
};

/**
 * The most bytes, gzipped, of an entry point that a development build imports whole. The keys
 * are those of `IMPORTS` in scripts/size-check.mjs.
 *
 * `pixi-marrow/diagnose` is for development builds, for PixiJS DevTools and for coding agents,
 * so its size is no cost of a released game. The limit keeps it from growing without a word:
 * the size of 2026-11-15 plus 3 percent, rounded up to half a kilobyte.
 */
export const ENTRY_LIMITS = {
    'diagnose (everything)': 14.5 * 1024,
};
