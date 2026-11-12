import type { AtlasModel } from '../model/atlas';
import type { SkeletonModel } from '../model/model';
import { createAttachmentLookup } from '../pose/shared/lookup';
import { layoutSlots } from './batch-layout';
import { releaseTemplate } from './layouts';
import type { DrawMode } from './stats';
import { buildTemplate } from './template';

/*
 * Which of the two render modes a view draws in. The mesh mode gives a skeleton meshes of its
 * own: one draw call per instance, and the vertex shader places the vertices. The batched mode
 * writes the skeleton into the batch of its render group: instances share draw calls, and the
 * CPU places the vertices that moved and copies them.
 *
 * The code of the mesh mode loads on demand, see `mesh-code.ts`. A view that should draw with
 * meshes draws in a batch until that code is there.
 */

/** The `renderMode` option: a mode by name, or `auto`, which lets the view pick. */
export type RenderMode = 'auto' | DrawMode;

/**
 * Why a view should draw in a mode.
 *
 * - `option`: the option names the mode.
 * - `small`: `auto` batches a skeleton of up to {@link AUTO_BATCH_VERTICES} vertices.
 * - `large`: `auto` draws a larger skeleton with meshes.
 * - `limit`: a renderer drew the view whose batches sample fewer textures than a run needs.
 */
export type ModeReason = 'option' | 'small' | 'large' | 'limit';

/**
 * The most vertices a skeleton can have for `auto` to batch it. The count is that of the batch:
 * the largest attachment of every slot, with every region as its quad.
 *
 * Measured with `pnpm bench:ab --render-mode=batched --mesh=all`, 200 instances, 5 runs, on an
 * Apple M4 with pixi.js 8.23.0. On WebGPU a batched frame took 0.64 to 0.76 times the frame of
 * the mesh mode for skeletons of 44 to 819 vertices. On WebGL2 it took 0.68 to 0.97 times up to
 * 474 vertices and 1.02 to 1.03 times at 667 vertices. There the batch saves about 2.7
 * microseconds per instance and costs about 5 nanoseconds per vertex, which meet near 570
 * vertices. At this limit that model gives a frame that is 7 percent longer on WebGL2. A larger
 * skeleton is seldom drawn by the hundred, and the GPU places its vertices in the mesh mode.
 */
export const AUTO_BATCH_VERTICES = 1024;

/**
 * Why a view should draw in the mode it should, for its option. {@link modeFor} names the mode.
 *
 * `vertices` are the vertices the skeleton has in a batch. `refused` says that a renderer could
 * not batch the skeleton, see `DrawGate.refuseBatch`.
 *
 * @example
 * const reason = modeReason('auto', layout.plain, false);
 * console.log(modeFor('auto', reason), reason); // 'batched' 'small'
 */
export function modeReason(choice: RenderMode, vertices: number, refused: boolean): ModeReason {
    if (choice === 'mesh') return 'option';
    if (refused) return 'limit';
    if (choice === 'auto') return vertices > AUTO_BATCH_VERTICES ? 'large' : 'small';

    return 'option';
}

/**
 * The mode a view should draw in for its option and the reason {@link modeReason} gave.
 *
 * @example
 * modeFor('auto', 'large'); // 'mesh'
 */
export function modeFor(choice: RenderMode, reason: ModeReason): DrawMode {
    return reason === 'small' || (reason === 'option' && choice === 'batched') ? 'batched' : 'mesh';
}

/** Per model: whether a skin of it has a clipping attachment. A model never changes after its import. */
const clipping = new WeakMap<SkeletonModel, boolean>();

/**
 * Whether a skeleton has a clipping attachment in any of its skins. The answer is kept per model.
 *
 * @example
 * if (hasClip(model)) await loadClipCode();
 */
export function hasClip(model: SkeletonModel): boolean {
    let found = clipping.get(model);

    if (found === undefined) {
        found = model.skins.some((skin) => skin.attachments.some((entry) => entry.attachment.type === 'clipping'));
        clipping.set(model, found);
    }

    return found;
}

/**
 * Whether the instances of a skeleton start in the mesh mode with a `renderMode` option. They
 * do when it names that mode, and when it is `auto` and the skeleton has more vertices in a
 * batch than `auto` batches. An asset loads the code of the mesh mode then, so that its
 * instances find it.
 *
 * The count is that of the default skin, which a new instance shows. A skeleton whose atlas
 * misses a region has no count: its view says what is wrong when it is created.
 *
 * @example
 * if (startsWithMeshes(model, atlas, 'auto')) await loadMeshCode();
 */
export function startsWithMeshes(model: SkeletonModel, atlas: AtlasModel, choice: RenderMode): boolean {
    if (choice !== 'auto') return choice === 'mesh';
    try {
        const dark = model.slots.hasDark.includes(1);
        const template = buildTemplate(model, atlas, createAttachmentLookup(model), -1, null, dark, undefined, false);
        const { plain } = layoutSlots(template, model.slots.count);

        releaseTemplate(template);

        return plain > AUTO_BATCH_VERTICES;
    } catch {
        return false;
    }
}
