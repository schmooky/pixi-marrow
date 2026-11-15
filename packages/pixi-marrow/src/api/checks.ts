import { MarrowError } from '../base/errors';
import { unknownName } from '../base/names';
import type { PhysicsMode } from '../pose/engine';
import type { RenderMode } from '../render/mode';
import { PERF_KEYS, type ResolvedPerf } from './presets';
import { checkKeys, oneOf, wrongValue } from './values';

/** The physics modes, as the official `Physics` names them. */
const PHYSICS_MODES: readonly PhysicsMode[] = ['none', 'reset', 'update', 'pose'];

/** The values of the `renderMode` option. */
const RENDER_MODES: readonly RenderMode[] = ['auto', 'mesh', 'batched'];

/** The values of the `occlusion` option. */
const OCCLUSIONS = ['auto', 'off'] as const;

/**
 * The options of a display object, then those of a load that `MarrowSpine.load` and
 * `MarrowSpine.from` pass on with them.
 */
const SPINE_OPTIONS: readonly string[] = [
    'autoUpdate',
    'ticker',
    'label',
    'renderMode',
    'occlusion',
    'perf',
    ...PERF_KEYS,
    'skeleton',
    'atlas',
    'textures',
    'outlines',
    'name',
];

/** Options of other Spine runtimes that are no options here, each with what to do in its place. */
const ELSEWHERE: Readonly<Record<string, string>> = {
    scale: 'Set the scale of the display object: hero.scale.set(0.5).',
    darkTint: 'Leave it out: a slot with a dark color draws with it.',
    boundsProvider: 'Leave it out: getBounds() measures what the skeleton draws.',
};

/**
 * The error for a name that finds nothing. The code is `invalid-option` for a value that is no
 * string, and `unknown-name` for a name the skeleton lacks, with the names and the closest one.
 *
 * @example
 * throw noName('bone', 'haed', model.bones.names);
 */
export function noName(kind: string, name: unknown, names: readonly string[]): MarrowError {
    if (typeof name === 'string') return unknownName(kind, name, names);

    return new MarrowError('invalid-option', `The ${kind} name is ${String(name)}.`, {
        fix: 'Pass the name as a string.',
        validNames: names,
    });
}

/**
 * The index of the item with a name. Throws the {@link MarrowError} of {@link noName} for a name
 * that finds nothing.
 *
 * @param kind What the items are, for the message: `animation` or `skin`.
 *
 * @example
 * const index = namedIndex('animation', model.animations, 'idle');
 */
export function namedIndex(kind: string, items: readonly { name: string }[], name: unknown): number {
    for (let i = 0; i < items.length; i++) {
        if (items[i]?.name === name) return i;
    }

    throw noName(
        kind,
        name,
        items.map((item) => item.name),
    );
}

/**
 * A physics mode, or the {@link MarrowError} that lists the modes for any other value.
 *
 * @example
 * engine.physics = physicsMode('pose');
 */
export function physicsMode(mode: unknown): PhysicsMode {
    return oneOf('a physics mode', mode, PHYSICS_MODES);
}

/**
 * A render mode, or the {@link MarrowError} that lists the modes for any other value.
 *
 * @example
 * view.renderMode = renderMode(options.renderMode ?? 'auto');
 */
export function renderMode(mode: unknown): RenderMode {
    return oneOf('a render mode', mode, RENDER_MODES);
}

/**
 * Checks the options of a display object before anything is made. Throws a {@link MarrowError}
 * for a key that is no option and for a value `occlusion` or `autoUpdate` do not take. The
 * `perf` settings and `renderMode` have checks of their own. A `ticker` that is none fails in
 * its first use.
 *
 * @example
 * checkSpineOptions({ autoUpdat: false }); // "autoUpdat" is not an option of MarrowSpine.
 */
export function checkSpineOptions(options: { occlusion?: unknown; autoUpdate?: unknown }): void {
    const { occlusion, autoUpdate } = options;

    checkKeys(options, 'MarrowSpine', SPINE_OPTIONS, ELSEWHERE);
    if (occlusion !== undefined) oneOf('a value of occlusion', occlusion, OCCLUSIONS);
    if (autoUpdate !== undefined && typeof autoUpdate !== 'boolean') {
        throw wrongValue('autoUpdate', autoUpdate, 'true or false');
    }
}

/**
 * Runs code with the chunk of the warnings, once it has loaded. Most games never meet one of
 * its warnings, so the words load on demand. A chunk that does not load warns of nothing.
 *
 * @example
 * warnLater(({ warnStray }) => warnStray(hero, sparkle, 'hand'));
 */
export function warnLater(warn: (code: typeof import('./no-effect')) => void): void {
    import('./no-effect').then(warn, () => undefined);
}

/**
 * Warns once per asset and cause when an option that was set by name has no effect. The causes:
 * `tightMesh` or `occlusion` on an asset without outlines, `instancing` without the mesh mode
 * and `skinning: 'gpu'`, and `skinning: 'gpu'` on a batched skeleton. The warning comes a
 * moment later, see {@link warnLater}.
 *
 * @param choice The `renderMode` option of the display object.
 *
 * @example
 * warnNoEffect(asset, settings, options.occlusion, 'auto');
 */
export function warnNoEffect(
    asset: object,
    settings: ResolvedPerf,
    occlusion: string | undefined,
    choice: RenderMode,
): void {
    // no option that can be without effect was set by name
    if (settings.given.size === 0 && occlusion !== 'auto') return;
    warnLater(({ warnOptions }) => warnOptions(asset, settings, occlusion === 'auto', choice));
}
