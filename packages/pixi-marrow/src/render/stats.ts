/** Counters a view keeps, for the perf report and for tests. Where not said otherwise they only grow. */
export interface ViewStats {
    /**
     * Draw calls the view issues per frame at the moment: one per range and two per clip mask.
     * Polygons and skipped slots never change this number.
     */
    drawCalls: number;
    /** Vertices in the buffers at the moment. A region that is laid out as a polygon has the vertices of the polygon. */
    vertices: number;
    /** How often the vertex ranges were built: once, and again when the skin changes. */
    templateBuilds: number;
    /** How often the index buffer was rewritten: on attachment, draw order and visibility changes. */
    indexRebuilds: number;
    /** How often vertex positions were uploaded. */
    positionUploads: number;
    /** How often vertex colors were uploaded. */
    colorUploads: number;
    /** How often texture coordinates were uploaded after the build: when a sequence showed another region. */
    uvUploads: number;
    /**
     * Indices the view draws at the moment. A draw range whose slots are all skipped draws one
     * triangle without area, which counts as 3.
     */
    indices: number;
    /** Bytes of vertex and index data the view holds at the moment, clip masks included. */
    bufferBytes: number;
    /**
     * Clipping attachments that are applied at the moment. One that is shown while another one
     * clips, or on an inactive bone, is not applied and does not count.
     */
    clips: number;
    /**
     * Draw calls of {@link drawCalls} that draw clip masks at the moment: two for every applied
     * clipping attachment that has a visible slot to cut.
     */
    maskDraws: number;
    /** How often the polygon of a clip mask was uploaded: once per mask in every update. */
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
}

/**
 * The counters of a view that has built its vertex ranges once and has drawn nothing yet.
 *
 * @example
 * const stats = createViewStats(template.vertexCount, templateBytes(template));
 * console.log(stats.templateBuilds, stats.drawCalls); // 1 0
 */
export function createViewStats(vertices: number, bufferBytes: number): ViewStats {
    return {
        drawCalls: 0,
        vertices,
        templateBuilds: 1,
        indexRebuilds: 0,
        positionUploads: 0,
        colorUploads: 0,
        uvUploads: 0,
        indices: 0,
        bufferBytes,
        clips: 0,
        maskDraws: 0,
        maskUploads: 0,
        maskRebuilds: 0,
        tightRanges: 0,
        coveredSlots: 0,
    };
}
