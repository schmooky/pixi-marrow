import { MarrowError } from '../base/errors';
import type { SkeletonModel } from '../model/model';
import type { PoseState } from '../pose/state';
import type { BatchElement, BatchHome } from './batch-element';
import type { ClipShape } from './clip-shape';

/*
 * The code that clips, and when it is there. Only a skeleton with a clipping attachment needs
 * it, so it is a chunk of its own that loads on demand: the clip kernel, the code that writes
 * cut triangles into a batch, and the code that shapes a clip polygon, which the stencil mask of
 * the mesh mode needs too. An asset loads the chunk with a skeleton that has a clipping
 * attachment. An application without clips never loads it.
 *
 * A view that was made without an asset must load the code itself before a clip cuts a slot.
 */

/** The room a batch keeps for the cut triangles of one skeleton, after the room of its slots. */
export interface ClipRoom {
    /** Vertices of cut triangles. */
    vertices: number;
    /** Indices of cut triangles. */
    indices: number;
}

/** What clips the slots of a skeleton. See `batch-clip.ts`. */
export interface ClipCode {
    /**
     * Shapes the polygon of a clipping attachment in a pose. One object serves every clip of
     * every skeleton, in both render modes: each use reads what it computed before the next one.
     */
    readonly shape: ClipShape;
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
    /** Gives an element the room for cut triangles that the clips of its model needed so far, before it joins a batch. */
    size(element: BatchElement): void;
    /** Takes the pose of an update for the clips of an element: its visible slots are cut now, in the space of the skeleton. */
    pose(element: BatchElement, pose: PoseState): void;
    /**
     * The part of a sync for a skeleton with slots inside a clip. It moves the cut triangles to
     * the display object, and cuts them again when the batch holds them for another place or list.
     *
     * @param all Whether every vertex of the skeleton was placed again.
     * @param statics Whether colors, texture coordinates or the list of slots changed.
     */
    write(element: BatchElement, home: BatchHome, mark: boolean, all: boolean, statics: boolean): void;
}

let loaded: ClipCode | undefined;
let loading: Promise<void> | undefined;

/**
 * The code that clips, or undefined while it is not loaded.
 *
 * @example
 * clipCode()?.shape.compute(model.version, attachment, state.world, bone, deform, deformLength);
 */
export function clipCode(): ClipCode | undefined {
    return loaded;
}

/**
 * Loads the code that clips. Resolves when it is there, and at once when it was loaded before.
 * Rejects with a `MarrowError` when the chunk does not load: a skeleton with a clip cannot be
 * drawn without it. The next call tries again.
 *
 * @example
 * if (hasClip(model)) await loadClipCode();
 */
export function loadClipCode(): Promise<void> {
    loading ??= import('./batch-clip').then(
        ({ batchClip }) => {
            loaded = batchClip;
        },
        (error: unknown) => {
            loading = undefined;
            throw new MarrowError(
                'invalid-data',
                `The chunk of pixi-marrow with the code that clips did not load: ${error instanceof Error ? error.message : String(error)}`,
                {
                    fix: 'Check the network, and that the bundler wrote the chunks of pixi-marrow next to its entry and the server sends them.',
                },
            );
        },
    );

    return loading;
}

/**
 * The `MarrowError` of a view that has to clip while the code that clips is not loaded.
 *
 * @example
 * if (seen.clipped > 0 && clipCode() === undefined) throw clipCodeMissing();
 */
export function clipCodeMissing(): MarrowError {
    return new MarrowError(
        'invalid-data',
        'A clipping attachment cuts a slot, and the code that clips is not loaded.',
        {
            fix: 'Create display objects from a MarrowAsset, which loads it, or await loadClipCode() first.',
        },
    );
}
