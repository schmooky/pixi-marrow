import { DOCS_SITE, ruleDocs } from '../base/errors';
import type { AtlasModel } from '../model/atlas';
import type { SkeletonModel } from '../model/model';
import { type RenderMode, startsWithMeshes } from '../render/mode';
import type { ResolvedPerf } from './presets';

/*
 * The warnings for options that have no effect. Most games never meet one, so the words load on
 * demand, see `warnNoEffect` in checks.ts and `follow` in spine-links.ts.
 */

/** The docs page of the settings, for a warning about a setting without a rule of its own. */
const SETTINGS_DOCS = `${DOCS_SITE}performance/#the-settings`;

/** The causes that warned, per asset or container. Each one warns once. */
const warned = new WeakMap<object, Set<string>>();

/**
 * Warns once per object and cause. The warning ends with `docs`, the address of the docs page
 * about the cause.
 *
 * @param about The asset or the container the warning is about.
 * @param cause What tells one warning about the object from another.
 *
 * @example
 * warnOnce(asset, 'no-outlines', 'tightMesh has no effect, because the asset has no outlines.', ruleDocs('MARROW020'));
 */
export function warnOnce(about: object, cause: string, text: string, docs: string): void {
    let causes = warned.get(about);

    if (causes === undefined) {
        causes = new Set();
        warned.set(about, causes);
    }
    if (causes.has(cause)) return;
    causes.add(cause);
    console.warn(`pixi-marrow: ${text} ${docs}`);
}

/**
 * Warns that options have no effect, once per asset and cause.
 *
 * @param options The options as the game wrote them.
 */
function noEffect(
    asset: object,
    cause: string,
    options: readonly string[],
    because: string,
    fix: string,
    docs: string = SETTINGS_DOCS,
): void {
    if (options.length === 0) return;
    warnOnce(
        asset,
        cause,
        `${options.join(' and ')} ${options.length > 1 ? 'have' : 'has'} no effect, because ${because}. ${fix}`,
        docs,
    );
}

/** What the warnings read of an asset. */
interface WarnedAsset {
    readonly model?: SkeletonModel;
    readonly atlas?: AtlasModel;
    readonly outlinesState?: string;
}

/**
 * Warns of the options of a display object that were set by name and have no effect on it:
 *
 * - `tightMesh` other than `off`, and `occlusion: 'auto'`, on an asset without outlines.
 * - `instancing` other than `off` without `skinning: 'gpu'`, or on a batched skeleton.
 * - `skinning: 'gpu'` on a batched skeleton.
 *
 * @param occlusion True when `occlusion: 'auto'` was set by name.
 * @param choice The `renderMode` option of the display object.
 *
 * @example
 * warnOptions(asset, resolvePerf(undefined, { skinning: 'gpu' }), false, 'batched');
 */
export function warnOptions(asset: WarnedAsset, settings: ResolvedPerf, occlusion: boolean, choice: RenderMode): void {
    const { given, tightMesh, instancing, skinning } = settings;
    const { model, atlas } = asset;
    const instances = given.has('instancing') && instancing !== 'off' ? [`instancing: '${instancing}'`] : [];
    const gpu = given.has('skinning') && skinning === 'gpu' ? ["skinning: 'gpu'"] : [];

    if (asset.outlinesState === 'off') {
        noEffect(
            asset,
            'outlines',
            [
                ...(given.has('tightMesh') && tightMesh !== 'off' ? [`tightMesh: '${tightMesh}'`] : []),
                ...(occlusion ? ["occlusion: 'auto'"] : []),
            ],
            'the asset has no outlines of the atlas regions',
            "Load the asset with outlines: 'auto', or with the file of pixi-marrow outlines.",
            ruleDocs('MARROW020'),
        );
    }
    if (skinning !== 'gpu') {
        noEffect(
            asset,
            'instancing',
            instances,
            "it acts on the mesh mode with skinning: 'gpu'",
            "Set skinning: 'gpu' with it.",
        );

        return;
    }
    if (model === undefined || atlas === undefined || startsWithMeshes(model, atlas, choice)) return;
    noEffect(
        asset,
        'batched',
        [...gpu, ...instances],
        choice === 'batched'
            ? 'renderMode is batched, and the batched mode places every vertex on the CPU'
            : 'renderMode auto batches a skeleton of this size, and the batched mode places every vertex on the CPU',
        "Set renderMode: 'mesh' with it.",
    );
}

/**
 * Warns once per container that it follows a bone and is no child of the display object. The
 * transform of the bone is in the space of the display object, so the container stands elsewhere.
 * A container that became a child since `follow` was called warns of nothing.
 *
 * @example
 * warnStray(hero, sparkle, 'hand');
 */
export function warnStray(owner: object, container: { readonly parent: unknown }, bone: string): void {
    if (container.parent === owner) return;
    warnOnce(
        container,
        'stray',
        `follow('${bone}', container) got a container that is not a child of the display object. ` +
            'The transform of the bone is in the space of that object. Add the container with hero.addChild(container).',
        `${DOCS_SITE}bones-and-placeholders/#follow-a-bone`,
    );
}
