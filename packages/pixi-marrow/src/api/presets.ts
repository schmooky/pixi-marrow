import { MarrowError } from '../base/errors';
import { closestName } from '../base/names';

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
     * only the matrices go to the GPU while a skeleton moves. Attachments that deform or hang on
     * several bones stay on the CPU. `cpu` places every vertex on the CPU. `auto` is `cpu` until
     * devices have been measured. The batched mode always places on the CPU.
     */
    skinning: SkinningMode;
    /**
     * `auto` plays an animation from frames baked at load time, where it can be: one track, no
     * mix, no physics, no handle that writes a bone. The pose equals the played one at the
     * baked frames. A list bakes the named animations only. `off` (the `exact` default) bakes nothing.
     */
    bake: BakeMode;
    /**
     * `auto` draws a skeleton that rests as one image, taken once it has rested a moment, until
     * it changes. It costs texture memory. `off` (the `exact` default) always draws the skeleton.
     */
    idleCache: 'off' | 'auto';
    /**
     * `update` (the `exact` default) updates a skeleton off the screen as one on it. `throttle`
     * updates it 4 times a second, with the time that passed, so events fire late. `pause` does
     * not update it, so its time stands still until it is on the screen again.
     */
    offscreen: OffscreenMode;
    /**
     * `display` (the `exact` default) updates the pose every frame. A number updates it at most
     * that many times a second, with the time that passed: motion steps at low rates.
     */
    updateRate: UpdateRate;
    /**
     * `auto` leaves physics and deform out while the skeleton is drawn smaller than 96 pixels
     * across. The bones keep the pose of the animations, and every mesh shows its setup vertices.
     * Both come back at 120 pixels, physics with a reset. `off` (the `exact` default) always runs them.
     */
    lod: 'off' | 'auto';
}

/** The names of the presets. */
export type PerfPreset = 'exact' | 'balanced' | 'fast';

/** A preset to start from, with settings that change it. */
export interface PerfOptions extends Partial<PerfSettings> {
    preset?: PerfPreset;
}

/** What each preset sets. `fast` sets an update rate of 30 for skeletons that the batched mode draws. */
export const PERF_PRESETS: Readonly<Record<PerfPreset, Readonly<PerfSettings>>> = Object.freeze({
    exact: Object.freeze({
        tightMesh: 'auto',
        skinning: 'auto',
        bake: 'off',
        idleCache: 'off',
        offscreen: 'update',
        updateRate: 'display',
        lod: 'off',
    }),
    balanced: Object.freeze({
        tightMesh: 'on',
        skinning: 'auto',
        bake: 'auto',
        idleCache: 'auto',
        offscreen: 'throttle',
        updateRate: 'display',
        lod: 'off',
    }),
    fast: Object.freeze({
        tightMesh: 'on',
        skinning: 'auto',
        bake: 'auto',
        idleCache: 'auto',
        offscreen: 'pause',
        updateRate: 30,
        lod: 'auto',
    }),
});

const PRESETS = Object.keys(PERF_PRESETS) as PerfPreset[];

/** The values each setting takes, for the error of a wrong one. A number is checked apart. */
const CHOICES: Record<keyof PerfSettings, readonly string[]> = {
    tightMesh: ['auto', 'on', 'off'],
    skinning: ['auto', 'cpu', 'gpu'],
    bake: ['off', 'auto'],
    idleCache: ['off', 'auto'],
    offscreen: ['update', 'throttle', 'pause'],
    updateRate: ['display'],
    lod: ['off', 'auto'],
};

function wrong(setting: string, value: unknown, valid: readonly string[]): MarrowError {
    return new MarrowError('invalid-data', `"${String(value)}" is not a value of ${setting}.`, {
        fix: `Set one of: ${valid.join(', ')}.`,
        validNames: valid,
        closest: closestName(String(value), valid) ?? valid[0] ?? '',
    });
}

/** Checks one setting. Throws a `MarrowError` for a value it does not take. */
function check<K extends keyof PerfSettings>(setting: K, value: PerfSettings[K]): PerfSettings[K] {
    if (setting === 'updateRate' && typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) {
            throw new MarrowError('invalid-data', `updateRate ${value} is not a rate.`, {
                fix: "Pass a number of updates a second above 0, or 'display'.",
            });
        }

        return value;
    }
    if (setting === 'bake' && Array.isArray(value)) {
        if (!value.every((name) => typeof name === 'string')) {
            throw new MarrowError('invalid-data', 'bake takes a list of animation names.', {
                fix: "Pass names of animations, 'auto' or 'off'.",
            });
        }

        return value;
    }
    if (!CHOICES[setting].includes(value as string)) throw wrong(setting, value, CHOICES[setting]);

    return value;
}

/** The settings in effect, the preset they start from, and which of them were given rather than taken from it. */
export interface ResolvedPerf extends PerfSettings {
    readonly preset: PerfPreset;
    readonly given: ReadonlySet<keyof PerfSettings>;
}

/**
 * The settings in effect: an option given by name wins, then a setting of a `perf` object, then
 * its preset, then `exact`. Throws a `MarrowError` for a preset or a value that does not exist.
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
    const preset = typeof perf === 'string' ? perf : (object.preset ?? 'exact');

    if (!PRESETS.includes(preset)) throw wrong('perf', preset, PRESETS);
    const settings: PerfSettings = { ...PERF_PRESETS[preset] };
    const given = new Set<keyof PerfSettings>();

    for (const key of Object.keys(CHOICES) as (keyof PerfSettings)[]) {
        const value = named[key] ?? object[key];

        if (value === undefined) continue;
        Object.assign(settings, { [key]: check(key, value) });
        given.add(key);
    }

    return { ...settings, preset, given };
}
