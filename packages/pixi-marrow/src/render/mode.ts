import type { SkeletonModel } from '../model/model';
import type { DrawMode } from './stats';

/*
 * Which of the two render modes a view draws in. The mesh mode gives a skeleton meshes of its
 * own: one draw call per instance, and the vertex shader places the vertices. The batched mode
 * writes the skeleton into the batch of its render group: instances share draw calls, and the
 * CPU places the vertices and copies them in every frame.
 */

/** The `renderMode` option: a mode by name, or `auto`, which lets the view pick. */
export type RenderMode = 'auto' | DrawMode;

/**
 * Why a view draws in its mode.
 *
 * - `option`: the option names the mode.
 * - `small`: `auto` batches a skeleton of up to {@link AUTO_BATCH_VERTICES} vertices.
 * - `large`: `auto` draws a larger skeleton with meshes.
 * - `clip`: a clipping attachment cuts a visible slot, and the code that clips in a batch is not
 *   loaded. An asset loads it with a skeleton that has a clipping attachment, see `clip-code.ts`.
 *   A view that was made without an asset draws the clip with meshes and a stencil mask.
 * - `limit`: a renderer drew the view whose batches sample fewer textures than a run needs.
 */
export type ModeReason = 'option' | 'small' | 'large' | 'clip' | 'limit';

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
 * Why a view draws in the mode it does, for its option and what it shows. {@link modeFor} names
 * the mode.
 *
 * `vertices` are the vertices the skeleton has in a batch. `clipped` says how many visible slots
 * a clipping attachment cuts that a batch cannot draw. These are all of them while the code that
 * clips in a batch is not loaded, and none once it is. `refused` says that a renderer could not
 * batch the skeleton, see `DrawGate.refuseBatch`.
 *
 * @example
 * const reason = modeReason('auto', layout.vertices, batchClipper() === undefined ? seen.clipped : 0, false);
 * console.log(modeFor('auto', reason), reason); // 'batched' 'small'
 */
export function modeReason(choice: RenderMode, vertices: number, clipped: number, refused: boolean): ModeReason {
    if (choice === 'mesh') return 'option';
    if (refused) return 'limit';
    if (choice === 'auto' && vertices > AUTO_BATCH_VERTICES) return 'large';
    if (clipped > 0) return 'clip';

    return choice === 'auto' ? 'small' : 'option';
}

/**
 * The mode a view draws in for its option and the reason {@link modeReason} gave.
 *
 * @example
 * modeFor('batched', 'clip'); // 'mesh'
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
 * if (hasClip(model)) await loadBatchClipper();
 */
export function hasClip(model: SkeletonModel): boolean {
    let found = clipping.get(model);

    if (found === undefined) {
        found = model.skins.some((skin) => skin.attachments.some((entry) => entry.attachment.type === 'clipping'));
        clipping.set(model, found);
    }

    return found;
}
