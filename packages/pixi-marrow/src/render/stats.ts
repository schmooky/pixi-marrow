/** How a view draws: with meshes of its own, or as a part of the batches of its render group. */
export type DrawMode = 'mesh' | 'batched';

/**
 * Bytes a view handed to the GPU, by what they hold.
 *
 * In the batched mode they are the bytes the view wrote into the buffers of its batch. The batch
 * can upload more: it joins stretches that lie near each other, and pixi.js before 8.23 uploads
 * one stretch per buffer on WebGL. A view that draws instanced counts nothing: its pool uploads.
 */
export interface UploadBytes {
    /** Vertex positions. */
    positions: number;
    /** What a pose does not move: texture coordinates, colors, the tint and the flags of the batched mode. */
    statics: number;
    /** Indices. */
    indices: number;
    /** The texels of bones and of the palette, with `skinning: 'gpu'`. */
    bones: number;
    /** The polygons and the triangles of clip masks, in the mesh mode. */
    masks: number;
}

/** Counters a view keeps, for the perf report and for tests. Where not said otherwise they only grow. */
export interface ViewStats {
    /**
     * The mode the view draws in at the moment. With `renderMode: 'auto'` the view picks it. The
     * code of the mesh mode loads on demand: a view that should draw with meshes is `batched`
     * until that code is there, and `perf.report()` says so.
     */
    renderMode: DrawMode;
    /**
     * Draw calls the view takes per frame at the moment. In the mesh mode they are its own: one
     * per range and two per clip mask. In the batched mode they are the batches it draws in,
     * which it shares with the skeletons next to it in the render group. That is 1 unless a
     * slot multiplies or screens. A skeleton that shows nothing is in no batch and has 0.
     * Polygons and skipped slots never change this number.
     */
    drawCalls: number;
    /** Vertices in the buffers at the moment. A region that is laid out as a polygon has the vertices of the polygon. */
    vertices: number;
    /** How often the vertex ranges were built: once, and again when the skin changes. */
    templateBuilds: number;
    /**
     * How often the indices were rewritten: on attachment, draw order and visibility changes. In
     * the batched mode they are written into the index buffer of the batch, where they are.
     */
    indexRebuilds: number;
    /**
     * How often vertex positions were handed on: uploaded in the mesh mode, written to the batch
     * in the batched mode. This and the next three count nothing while the view draws instanced:
     * the pool of its layout uploads for all its views, and `perf.report()` gives that count.
     */
    positionUploads: number;
    /** How often vertex colors were handed on. With `skinning: 'gpu'` that is the palette of the slots. */
    colorUploads: number;
    /** How often bone matrices were uploaded, for a vertex shader that places vertices: `skinning: 'gpu'`. */
    boneUploads: number;
    /** How often texture coordinates were handed on after the build: when a sequence showed another region. */
    uvUploads: number;
    /**
     * Indices the view draws at the moment. A draw range whose slots are all skipped draws one
     * triangle without area, which counts as 3. In the batched mode the triangles without area
     * that fill the room of the skeleton do not count, and a slot inside a clip counts with what
     * the clip left of it.
     */
    indices: number;
    /**
     * Bytes of vertex and index data the view holds at the moment, clip masks included. In the
     * batched mode this is the data of its vertex ranges and its share of the batch buffers.
     */
    bufferBytes: number;
    /**
     * Clipping attachments that are applied at the moment. One that is shown while another one
     * clips, or on an inactive bone, is not applied and does not count.
     */
    clips: number;
    /**
     * Draw calls of {@link drawCalls} that draw clip masks at the moment: two for every applied
     * clipping attachment that has a visible slot to cut. 0 in the batched mode, which cuts the
     * triangles and draws no mask.
     */
    maskDraws: number;
    /** How often the polygon of a clip mask was uploaded: once per mask in an update that moved the polygon or changed the list. */
    maskUploads: number;
    /** How often the triangles of a clip mask were rewritten and uploaded. */
    maskRebuilds: number;
    /**
     * Visible region attachments that are not laid out as a quad at the moment. With
     * `tightMesh: 'on'` these are the ones drawn as the polygon around their visible pixels. One
     * whose region shows no pixel counts with every setting but `off`: it draws nothing.
     */
    tightRanges: number;
    /** Slots that are left out of the index buffers at the moment because a later opaque slot covers them. */
    coveredSlots: number;
    /**
     * How often an update returned at once, because the pose was the one the view drew last and
     * nothing of the view had changed. Such an update places no vertex and uploads nothing.
     */
    skips: number;
    /**
     * Visible slots whose vertices the last update placed that did not skip: the ones whose
     * bones, attachment or deform changed. All of them after a new layout or a change of mode.
     */
    placedSlots: number;
    /** Visible slots whose colors that update wrote: the ones whose color changed. */
    coloredSlots: number;
    /**
     * Frames of the batched mode that placed every vertex again because a display object above
     * the skeleton moved. The pose can be at rest in such a frame. A parent that is a render
     * group moves on the GPU and counts nothing.
     */
    transformReplaces: number;
    /**
     * Frames of the batched mode that wrote the static data of every vertex again because the
     * tint or the alpha of a display object above the skeleton changed.
     */
    tintRewrites: number;
    /**
     * How often Pixi built the instructions of the render group with the skeleton in a batch.
     * Each build writes the whole skeleton again, and the batch uploads its buffers whole.
     */
    instructionBuilds: number;
    /** The bytes the view handed to the GPU so far. */
    uploadBytes: UploadBytes;
    /**
     * The bytes of the last frame. In the batched mode that is the last frame that drew the
     * skeleton. In the mesh mode it is the last update, and all 0 after an update that skipped.
     */
    frameBytes: UploadBytes;
}

const noBytes = (): UploadBytes => ({ positions: 0, statics: 0, indices: 0, bones: 0, masks: 0 });

/**
 * Sets the bytes of a frame to 0.
 *
 * @example
 * restBytes(view.stats.frameBytes);
 */
export function restBytes(frame: UploadBytes): void {
    frame.positions = frame.statics = frame.indices = frame.bones = frame.masks = 0;
}

/**
 * The counters of a view that has built its vertex ranges once and has drawn nothing yet.
 *
 * @example
 * const stats = createViewStats(template.vertexCount, templateBytes(template), 'mesh');
 * console.log(stats.templateBuilds, stats.drawCalls); // 1 0
 */
export function createViewStats(vertices: number, bufferBytes: number, renderMode: DrawMode = 'mesh'): ViewStats {
    return {
        renderMode,
        drawCalls: 0,
        vertices,
        templateBuilds: 1,
        indexRebuilds: 0,
        positionUploads: 0,
        colorUploads: 0,
        boneUploads: 0,
        uvUploads: 0,
        indices: 0,
        bufferBytes,
        clips: 0,
        maskDraws: 0,
        maskUploads: 0,
        maskRebuilds: 0,
        tightRanges: 0,
        coveredSlots: 0,
        skips: 0,
        placedSlots: 0,
        coloredSlots: 0,
        transformReplaces: 0,
        tintRewrites: 0,
        instructionBuilds: 0,
        uploadBytes: noBytes(),
        frameBytes: noBytes(),
    };
}
