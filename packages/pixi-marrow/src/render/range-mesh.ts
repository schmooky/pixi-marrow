import { type Bounds, Buffer, BufferUsage, type Container, Mesh, type Shader } from 'pixi.js';
import { contextLost } from './context-watch';
import { MeasuredGeometry } from './measured-geometry';
import { STATIC_STRIDE } from './template';

/** The label of the container of a clip, which holds the draw ranges the clip cuts. */
export const CLIP_LABEL = 'marrow-clip';

/** The vertex buffers every draw range of a view reads. */
export interface VertexBuffers {
    /** x, y per vertex. */
    readonly positions: Buffer;
    /** u, v and four flag bytes per vertex. */
    readonly statics: Buffer;
    /** The light color per vertex, and with dark colors the dark color after it. None where a palette holds the colors. */
    readonly colors?: Buffer | undefined;
    /**
     * Where the vertex shader finds the influences and the slot of each vertex, see
     * `skin-layout.ts`. It is the buffer of the skin data of a layout, which the views of the
     * layout share, so a view that takes another layout takes another buffer.
     */
    skin?: Buffer | undefined;
}

/**
 * A Pixi mesh of the mesh mode: a draw range or a clip mask. Pixi asks a mesh right before it
 * draws it whether it can be drawn. This one says no while the WebGL context of the renderer is
 * lost, see `context-watch.ts`.
 *
 * @example
 * const mesh = new RangeMesh({ geometry, shader: createMaskShader() });
 * console.log(mesh.isRenderable); // true, unless the browser took the context
 */
export class RangeMesh extends Mesh<MeasuredGeometry, Shader> {
    /** Whether Pixi draws the mesh: it is visible, and the renderer has its context. */
    override get isRenderable(): boolean {
        return !contextLost() && super.isRenderable;
    }

    /**
     * Tells Pixi that the meshes of a view show other vertices: the draw ranges in a container,
     * and those inside the containers of its clips. Pixi keeps the bounds of a container until a
     * child says that it changed. An upload of the vertex buffer said so, and the uploads of the
     * mesh mode wait for a render.
     */
    static touchAll(container: Container): void {
        const { children } = container;

        for (let i = 0; i < children.length; i++) {
            const child = children[i];

            if (child instanceof RangeMesh) child.onViewUpdate();
            else if (child?.label === CLIP_LABEL) RangeMesh.touchAll(child);
        }
    }
}

/**
 * The Pixi mesh of one draw range and its index buffer: a geometry on the vertex buffers of the
 * view, with indices of its own.
 *
 * @param dark Whether the color buffer holds dark colors. Without a color buffer it says nothing.
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
): { mesh: RangeMesh; buffer: Buffer } {
    const buffer = new Buffer({
        data: indices,
        label: 'marrow-indices',
        usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
        shrinkToFit: false,
    });
    const geometry = rangeGeometry(buffers, dark, measure, buffer);

    return { mesh: new RangeMesh({ geometry, shader, label }), buffer };
}

/**
 * The geometry of a draw range: the vertex buffers of the view as they are now, and the index
 * buffer of the range.
 *
 * @example
 * range.mesh.geometry = rangeGeometry(buffers, false, measure, range.buffer);
 */
function rangeGeometry(
    buffers: VertexBuffers,
    dark: boolean,
    measure: () => Bounds,
    indexBuffer: Buffer,
): MeasuredGeometry {
    const { colors, skin } = buffers;
    const colorStride = dark ? 8 : 4;
    const staticStride = STATIC_STRIDE * 4;

    return new MeasuredGeometry(
        {
            attributes: {
                aPosition: { buffer: buffers.positions, format: 'float32x2', stride: 8, offset: 0 },
                aUV: { buffer: buffers.statics, format: 'float32x2', stride: staticStride, offset: 0 },
                aFlags: { buffer: buffers.statics, format: 'unorm8x4', stride: staticStride, offset: 8 },
                ...(skin === undefined ? {} : { aSkin: { buffer: skin, format: 'uint32x2', stride: 8, offset: 0 } }),
                ...(colors === undefined
                    ? {}
                    : { aColor: { buffer: colors, format: 'unorm8x4', stride: colorStride, offset: 0 } }),
                ...(colors !== undefined && dark
                    ? { aDark: { buffer: colors, format: 'unorm8x4', stride: colorStride, offset: 4 } }
                    : {}),
            },
            indexBuffer,
        },
        measure,
    );
}

/**
 * Gives a range a geometry on the vertex buffers as they are now when its geometry reads another
 * buffer of skin data. A view that takes the skin data of another layout takes its shared buffer
 * too. The index buffer of the range stays.
 *
 * @example
 * followSkin(range.mesh, range.buffer, { buffers, dark, measure });
 */
export function followSkin(
    mesh: RangeMesh,
    indexBuffer: Buffer,
    options: { readonly buffers: VertexBuffers; readonly dark: boolean; readonly measure: () => Bounds },
): void {
    const old = mesh.geometry;
    const { buffers } = options;

    if (old.attributes.aSkin?.buffer === buffers.skin) return;
    const geometry = rangeGeometry(buffers, options.dark, options.measure, indexBuffer);

    geometry.indexCount = old.indexCount;
    mesh.geometry = geometry;
    // the buffers stay: they belong to the view, the layout and the range
    old.destroy();
}
