import { type Bounds, Buffer, BufferUsage, Mesh, type Shader } from 'pixi.js';
import { MeasuredGeometry } from './measured-geometry';
import { STATIC_STRIDE } from './template';

/** The vertex buffers every draw range of a view reads. */
export interface VertexBuffers {
    /** x, y per vertex. */
    readonly positions: Buffer;
    /** u, v and four flag bytes per vertex. */
    readonly statics: Buffer;
    /** The light color per vertex, and with dark colors the dark color after it. */
    readonly colors: Buffer;
}

/**
 * The Pixi mesh of one draw range and its index buffer: a geometry on the vertex buffers of the
 * view, with indices of its own.
 *
 * @param dark Whether the color buffer holds dark colors.
 * @param measure The bounds Pixi gets for the mesh when it culls or measures.
 * @param label The label of the mesh.
 *
 * @example
 * const { mesh, buffer } = createRangeMesh(buffers, false, measure, shader, new Uint16Array(6), 'a-range');
 */
export function createRangeMesh(
    buffers: VertexBuffers,
    dark: boolean,
    measure: () => Bounds,
    shader: Shader,
    indices: Uint16Array | Uint32Array,
    label: string,
): { mesh: Mesh<MeasuredGeometry, Shader>; buffer: Buffer } {
    const buffer = new Buffer({
        data: indices,
        label: 'marrow-indices',
        usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
        shrinkToFit: false,
    });
    const colorStride = dark ? 8 : 4;
    const staticStride = STATIC_STRIDE * 4;
    const geometry = new MeasuredGeometry(
        {
            attributes: {
                aPosition: { buffer: buffers.positions, format: 'float32x2', stride: 8, offset: 0 },
                aUV: { buffer: buffers.statics, format: 'float32x2', stride: staticStride, offset: 0 },
                aFlags: { buffer: buffers.statics, format: 'unorm8x4', stride: staticStride, offset: 8 },
                aColor: { buffer: buffers.colors, format: 'unorm8x4', stride: colorStride, offset: 0 },
                ...(dark
                    ? { aDark: { buffer: buffers.colors, format: 'unorm8x4', stride: colorStride, offset: 4 } }
                    : {}),
            },
            indexBuffer: buffer,
        },
        measure,
    );

    return { mesh: new Mesh({ geometry, shader, label }), buffer };
}
