import type { SkeletonModel } from '../model/model';
import type { BatchElement, BatchHome } from './batch-element';

/*
 * The code that clips in a batch, and when it is there. Only a skeleton with a clipping
 * attachment needs it, so it is a module of its own that loads on demand: an asset asks for it
 * when its skeleton has such an attachment. An application without clips never loads it.
 *
 * A view that meets a clip before the code is there draws that clip with meshes and a stencil
 * mask, as the mesh mode does.
 */

/** The room a batch keeps for the cut triangles of one skeleton, after the room of its slots. */
export interface ClipRoom {
    /** Vertices of cut triangles. */
    vertices: number;
    /** Indices of cut triangles. */
    indices: number;
}

/** What clips the slots of a skeleton for a batch. See `batch-clip.ts`. */
export interface BatchClipper {
    /**
     * The room the clips of a model have needed so far, with a margin. All instances of a model
     * share the number, so a later instance starts with the room an earlier one grew into.
     */
    room(model: SkeletonModel): ClipRoom;
    /** Clips the visible slots of an element for their count alone, and raises the room of its model to it. */
    measure(element: BatchElement): void;
    /**
     * Clips the visible slots of an element and writes the result into its place in a batch.
     * These are the cut triangles, with positions in the space of the skeleton, and the indices
     * of all slots. A cut slot that has no room is left out. Returns whether everything had room.
     *
     * @param mark Whether to tell the batcher which stretches to upload.
     */
    fill(element: BatchElement, home: BatchHome, mark: boolean): boolean;
}

let loaded: BatchClipper | undefined;
let loading: Promise<void> | undefined;

/**
 * The code that clips in a batch, or undefined while it is not loaded.
 *
 * @example
 * const clipped = batchClipper() === undefined ? seen.clipped : 0;
 */
export function batchClipper(): BatchClipper | undefined {
    return loaded;
}

/**
 * Loads the code that clips in a batch. Resolves when it is there, and at once when it was
 * loaded before. It never rejects: without the code a clip draws with meshes, and the next call
 * tries again.
 *
 * @example
 * if (hasClip(model)) await loadBatchClipper();
 */
export function loadBatchClipper(): Promise<void> {
    loading ??= import('./batch-clip').then(
        ({ batchClip }) => {
            loaded = batchClip;
        },
        () => {
            loading = undefined;
        },
    );

    return loading;
}
