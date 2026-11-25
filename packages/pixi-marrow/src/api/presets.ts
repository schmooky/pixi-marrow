import { MarrowError } from '../base/errors';
import { checkKeys, oneOf } from './values';

/** How the vertices of the mesh mode are placed: on the CPU, or in the vertex shader from the bone matrices. */
export type SkinningMode = 'auto' | 'cpu' | 'gpu';
/** Which animations play from baked frames: none, the ones that can, or the named ones. */
export type BakeMode = 'off' | 'auto' | readonly string[];
/** What a skeleton does while it is off the screen. */
export type OffscreenMode = 'update' | 'throttle' | 'pause';
/** How often the pose is updated: every frame of the display, or at most this many times a second. */
export type UpdateRate = 'display' | number;

/** The settings that `perf` presets, each one an option of its own too. */
export interface PerfSettings {
    /** See `MarrowSpineOptions.tightMesh`. */
    tightMesh: 'auto' | 'on' | 'off';
    /**
     * `gpu` places the vertices of the mesh mode in the vertex shader from the bone matrices, so
     * only the matrices go to the GPU while a skeleton moves. That holds for meshes with weights
     * too. The CPU still places a mesh while a deform is on it, and a region with a sequence.
     * `cpu` places every vertex on the CPU. `auto` is `cpu` until devices have been measured. The
     * batched mode always places on the CPU, so the setting has no effect there.
     */
    skinning: SkinningMode;
    /**
     * `auto` draws the instances that follow each other in Pixi's render order and share a layout
     * as one instanced draw, where the vertex shader places their vertices: the mesh mode with
     * `skinning: 'gpu'`. The pixel check found the picture the same to the bit, on an Apple M4 in
     * Chrome. Another GPU may round it apart. It pays for many copies of one rig
     * next to each other, and not for a grid of different skeletons. An instanced draw runs every
     * attachment of every slot, so `auto` leaves a layout alone whose attachments have more than
     * twice the vertices a pose shows. That counts the setup attachments, and the largest
     * attachment of a slot that is empty in the setup pose. `on` draws that one instanced too. No
     * preset sets either. `off` (the default) draws each instance alone.
     */
    instancing: 'auto' | 'on' | 'off';
    /**
     * `auto` plays an animation from baked frames where it can be: one track, no mix, no entry
     * queued after it, no physics, no handle that writes a bone. The first time an animation can
     * play baked, its clip is baked in idle time, and the skeleton plays live until the clip is
     * there. The pose equals the played one at the baked frames. A list bakes the named
     * animations only. A clip keeps 23 KB to 0.9 MB per animation and skin, more for a longer
     * animation, for the life of the asset. So it is set by name. `off` (the default) bakes nothing.
     */
    bake: BakeMode;
    /**
     * `auto` draws a skeleton that rests as one image, taken once it has rested a moment, until
     * it changes. No preset sets it. Each image is a texture of its own, of 4 bytes per pixel of
     * its box, so many images take memory and split a batch into more draw calls. A small
     * skeleton at rest costs little to draw live, so the cache can make a frame slower. `off`
     * (the default) always draws the skeleton.
     */
    idleCache: 'off' | 'auto';
    /**
     * `update` (the `exact` default) updates a skeleton off the screen as one on it. `throttle`
     * updates it 4 times a second, with the time that passed, so events fire late. `pause`
     * leaves the vertex work out, and does not pose an animation that plays alone on track 0. A
     * mix, and animations on more tracks, still pose the bones. The tracks, the events and
     * `Track.finished` go on, and the picture stands still until it is on the screen again.
     *
     * A skeleton that shows no pixel counts as off the screen. It or a parent has `visible` or
     * `renderable` false, or an alpha of 0. A skeleton that no update drew yet counts as on the
     * screen, and `update(0)` poses and draws in every mode.
     */
    offscreen: OffscreenMode;
    /**
     * `display` (the `exact` default) updates the pose every frame. A number updates it that
     * many times a second, with the time that passed: motion steps at low rates. The updates
     * keep an even rhythm on a display of any rate, and never come more often than its frames.
     * A rate below the display leaves out the updates that are shorter than one step, and their
     * time goes to the next pose. `update(0)` is never left out: it poses and draws at once.
     */
    updateRate: UpdateRate;
    /**
     * `auto` leaves physics and deform out while the skeleton is drawn smaller than 96 pixels
     * across. The bones keep the pose of the animations, and every mesh shows its setup vertices.
     * Both come back at 120 pixels, physics with a reset. No preset sets it. `off` (the default)
     * always runs them.
     */
    lod: 'off' | 'auto';
}

/** The names of the presets. */
export type PerfPreset = 'exact' | 'balanced' | 'fast';

/** A preset to start from, with settings that change it. */
export interface PerfOptions extends Partial<PerfSettings> {
    preset?: PerfPreset;
}

/**
 * What each preset sets: when a skeleton updates. `fast` sets an update rate of 30 for skeletons
 * that the batched mode draws. No preset sets `tightMesh: 'on'`, `bake`, `idleCache`, `lod` or
 * `instancing`. Each costs memory, vertices or draw calls in a way that depends on the device and
 * the scene, so each one is set by its own name.
 */
export const PERF_PRESETS: Readonly<Record<PerfPreset, Readonly<PerfSettings>>> = Object.freeze({
    exact: Object.freeze({
        tightMesh: 'auto',
        skinning: 'auto',
        instancing: 'off',
        bake: 'off',
        idleCache: 'off',
        offscreen: 'update',
        updateRate: 'display',
        lod: 'off',
    }),
    balanced: Object.freeze({
        tightMesh: 'auto',
        skinning: 'auto',
        instancing: 'off',
        bake: 'off',
        idleCache: 'off',
        offscreen: 'throttle',
        updateRate: 'display',
        lod: 'off',
    }),
    fast: Object.freeze({
        tightMesh: 'auto',
        skinning: 'auto',
        instancing: 'off',
        bake: 'off',
        idleCache: 'off',
        offscreen: 'pause',
        updateRate: 30,
        lod: 'off',
    }),
});

const PRESETS = Object.keys(PERF_PRESETS) as PerfPreset[];

/** The values each setting takes, for the error of a wrong one. A number is checked apart. */
const CHOICES: Record<keyof PerfSettings, readonly string[]> = {
    tightMesh: ['auto', 'on', 'off'],
    skinning: ['auto', 'cpu', 'gpu'],
    instancing: ['auto', 'off', 'on'],
    bake: ['off', 'auto'],
    idleCache: ['off', 'auto'],
    offscreen: ['update', 'throttle', 'pause'],
    updateRate: ['display'],
    lod: ['off', 'auto'],
};

/** The names of the settings. Each one is an option of a display object too. */
export const PERF_KEYS = Object.keys(CHOICES) as (keyof PerfSettings)[];
/** The keys of a `perf` object. */
const SETTINGS: readonly string[] = ['preset', ...PERF_KEYS];

/** Checks one setting. Throws a `MarrowError` for a value it does not take. */
function check<K extends keyof PerfSettings>(setting: K, value: PerfSettings[K]): PerfSettings[K] {
    if (setting === 'updateRate' && typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) {
            throw new MarrowError('invalid-option', `updateRate ${value} is not a rate.`, {
                fix: "Pass a number of updates a second above 0, or 'display'.",
            });
        }

        return value;
    }
    if (setting === 'bake' && Array.isArray(value)) {
        if (!value.every((name) => typeof name === 'string')) {
            throw new MarrowError('invalid-option', 'bake takes a list of animation names.', {
                fix: "Pass names of animations, 'auto' or 'off'.",
            });
        }

        return value;
    }
    oneOf(`a value of ${setting}`, value, CHOICES[setting]);

    return value;
}

/** The settings in effect, the preset they start from, and which of them were given rather than taken from it. */
export interface ResolvedPerf extends PerfSettings {
    readonly preset: PerfPreset;
    readonly given: ReadonlySet<keyof PerfSettings>;
}

/**
 * The settings in effect: an option given by name wins, then a setting of a `perf` object, then
 * its preset, then `exact`. Throws a `MarrowError` for a preset or a value that does not exist, and for a key of a `perf` object that is no setting.
 *
 * @example
 * const settings = resolvePerf('fast', { tightMesh: 'off' });
 * console.log(settings.updateRate, settings.given.has('tightMesh')); // 30 true
 */
export function resolvePerf(
    perf: PerfPreset | PerfOptions | undefined,
    named: { [K in keyof PerfSettings]?: PerfSettings[K] | undefined } = {},
): ResolvedPerf {
    const object = typeof perf === 'object' && perf !== null ? perf : {};
    const preset = oneOf('a value of perf', typeof perf === 'string' ? perf : (object.preset ?? 'exact'), PRESETS);

    checkKeys(object, 'perf', SETTINGS);
    const settings: PerfSettings = { ...PERF_PRESETS[preset] };
    const given = new Set<keyof PerfSettings>();

    for (const key of PERF_KEYS) {
        const value = named[key] ?? object[key];

        if (value === undefined) continue;
        Object.assign(settings, { [key]: check(key, value) });
        given.add(key);
    }

    return { ...settings, preset, given };
}
