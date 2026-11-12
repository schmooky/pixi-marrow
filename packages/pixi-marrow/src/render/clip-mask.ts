import { type Bounds, Buffer, BufferUsage, Mesh, type Shader } from 'pixi.js';
import { f64, i32 } from '../geometry/read';
import type { ClipShape } from './clip-shape';
import { MeasuredGeometry } from './measured-geometry';

/** Room for one triangle, so that the GPU buffers are never empty. */
const MIN_VERTICES = 3;
/** An even count keeps the 16-bit index buffer a multiple of 4 bytes, which WebGPU asks for. */
const MIN_INDICES = 4;

/**
 * The stencil mask of one clip: a Pixi mesh that holds the polygon of a clipping attachment as
 * triangles. Set {@link mesh} as the `mask` of the container that holds the clipped meshes, and
 * add it to that container, so that both have the same transform. Pixi draws the mask twice per
 * frame, into the stencil buffer only: before the container to mark the area, after it to clear.
 *
 * The buffers hold the polygon the mask shows at the moment. They grow for a polygon with more
 * vertices and never shrink, so {@link place} allocates nothing for a polygon that fits.
 *
 * @example
 * const mask = new ClipMask(createMaskShader(), () => bounds);
 * clipped.addChild(mask.mesh);
 * clipped.mask = mask.mesh;
 * shape.compute(model.version, attachment, state.world, bone, deform, deformLength);
 * mask.place(shape);
 */
export class ClipMask {
    /** The mesh Pixi draws into the stencil buffer. */
    readonly mesh: Mesh<MeasuredGeometry, Shader>;
    /** The bytes of the vertex and index data of the mask. */
    bytes: number;
    private positions: Float32Array = new Float32Array(MIN_VERTICES * 2);
    private indices: Uint16Array = new Uint16Array(MIN_INDICES);
    private readonly positionBuffer: Buffer;
    private readonly indexBuffer: Buffer;
    /** Indices the mask draws. The rest of the index array is zero: triangles without area. */
    private count = 0;

    /**
     * @param shader The shader of `createMaskShader`. Masks can share one.
     * @param measure The bounds Pixi gets for the mask. Pixi cuts the bounds of the masked
     * container to them, so the box of the whole skeleton leaves those as they are.
     */
    constructor(shader: Shader, measure: () => Bounds) {
        this.positionBuffer = new Buffer({
            data: this.positions,
            label: 'marrow-clip-positions',
            usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
            shrinkToFit: false,
        });
        this.indexBuffer = new Buffer({
            data: this.indices,
            label: 'marrow-clip-indices',
            usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
            shrinkToFit: false,
        });
        this.mesh = new Mesh({
            geometry: new MeasuredGeometry(
                {
                    attributes: {
                        aPosition: { buffer: this.positionBuffer, format: 'float32x2', stride: 8, offset: 0 },
                    },
                    indexBuffer: this.indexBuffer,
                },
                measure,
            ),
            shader,
            label: 'marrow-clip-mask',
        });
        this.bytes = this.positions.byteLength + this.indices.byteLength;
    }

    /**
     * Shows a shape: copies its polygon and its triangles into the buffers and uploads what
     * changed. The polygon uploads on every call. Returns whether the triangles were rewritten.
     */
    place(shape: ClipShape): boolean {
        const floats = shape.vertexCount * 2;

        this.reserve(floats, shape.indexCount);
        for (let i = 0; i < floats; i++) this.positions[i] = f64(shape.polygon, i);
        this.positionBuffer.update();

        return this.triangulate(shape);
    }

    /** Frees the mesh, its geometry and both buffers. The shader belongs to the caller. */
    destroy(): void {
        const { geometry } = this.mesh;

        this.mesh.destroy();
        geometry.destroy();
        this.positionBuffer.destroy();
        this.indexBuffer.destroy();
        this.bytes = 0;
    }

    /** Makes room for a polygon. New arrays are zero, which draws nothing until they are written. */
    private reserve(floats: number, indices: number): void {
        if (floats > this.positions.length) {
            this.positions = new Float32Array(floats);
            this.positionBuffer.data = this.positions;
        }
        if (indices > this.indices.length) {
            this.indices = new Uint16Array(indices + (indices & 1));
            this.indexBuffer.data = this.indices;
            this.count = 0;
        }
        this.bytes = this.positions.byteLength + this.indices.byteLength;
    }

    /** Brings the index array in line with the triangles of a shape. Uploads it when it changed. */
    private triangulate(shape: ClipShape): boolean {
        const { indices } = this;
        const count = shape.indexCount;
        let changed = count !== this.count;

        for (let i = 0; i < count; i++) {
            const index = i32(shape.triangles, i);

            if (indices[i] !== index) {
                indices[i] = index;
                changed = true;
            }
        }
        if (!changed) return false;
        if (count < this.count) indices.fill(0, count, this.count);
        this.count = count;
        // Pixi draws this many indices. With 0 it draws the whole array, which is zero then
        this.mesh.geometry.indexCount = count;
        // the whole array: a part would leave old triangles on the GPU when two calls share a frame
        this.indexBuffer.update();

        return true;
    }
}
