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
