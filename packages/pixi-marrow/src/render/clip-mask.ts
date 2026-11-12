import { type Bounds, Buffer, BufferUsage, Mesh, type Shader } from 'pixi.js';
import { f64, i32 } from '../geometry/read';
import type { ClipShape } from './clip-shape';
import { MeasuredGeometry } from './measured-geometry';

/** Room for one triangle, so that the GPU buffers are never empty. */
const MIN_VERTICES = 3;
/** An even count keeps the 16-bit index buffer a multiple of 4 bytes, which WebGPU asks for. */
const MIN_INDICES = 4;

/** What every mask holds before its first shape: one triangle without area. Never written. */
const NO_POSITIONS = new Float32Array(MIN_VERTICES * 2);
/** The indices of that triangle. Never written. */
const NO_INDICES = new Uint16Array(MIN_INDICES);

/**
 * The stencil mask of one clip: a Pixi mesh that holds the polygon of a clipping attachment as
 * triangles. Set {@link mesh} as the `mask` of the container that holds the clipped meshes, and
 * add it to that container, so that both have the same transform. Pixi draws the mask twice per
 * frame, into the stencil buffer only: before the container to mark the area, after it to clear.
 *
 * A mask is a mesh, a geometry and two buffers, and it owns one array: the polygon it shows at
 * the moment. That array grows for a polygon with more vertices and never shrinks, so
 * {@link place} allocates nothing for a polygon that fits. The triangles come from the shape.
 * Where the shape has them in an array that never changes, the mask draws from that array, which
 * all masks of all instances share. Only for a shape whose triangles change with the pose does
 * the mask get an index array of its own.
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
    /**
     * The bytes of the vertex and index data the mask holds on the GPU: its polygon, and the
     * longest list of triangles it has shown.
     */
    bytes: number;
    private positions: Float32Array = NO_POSITIONS;
    /** The index array of the mask's own, for triangles that change with the pose. Created on first use. */
    private indices: Uint16Array | undefined;
    private readonly positionBuffer: Buffer;
    private readonly indexBuffer: Buffer;
    /** Indices of {@link indices} that hold triangles. The rest of that array is zero: triangles without area. */
    private count = 0;
    /** The bytes of the longest index array the index buffer was given. The GPU buffer never shrinks. */
    private indexBytes: number = NO_INDICES.byteLength;

    /**
     * @param shader The shader of `createMaskShader`. Masks can share one.
     * @param measure The bounds Pixi gets for the mask. Pixi cuts the bounds of the masked
     * container to them, so the box of the whole skeleton leaves those as they are.
     */
    constructor(shader: Shader, measure: () => Bounds) {
        this.positionBuffer = new Buffer({
            data: NO_POSITIONS,
            label: 'marrow-clip-positions',
            usage: BufferUsage.VERTEX | BufferUsage.COPY_DST,
            shrinkToFit: false,
        });
        this.indexBuffer = new Buffer({
            data: NO_INDICES,
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
        this.bytes = NO_POSITIONS.byteLength + this.indexBytes;
    }

    /**
     * Shows a shape: copies its polygon into the position buffer and uploads it, on every call.
     * The triangles upload when they are not the ones the mask shows. Returns whether they were.
     */
    place(shape: ClipShape): boolean {
        const floats = shape.vertexCount * 2;
        const positions = this.reserve(floats);

        for (let i = 0; i < floats; i++) positions[i] = f64(shape.polygon, i);
        this.positionBuffer.update();
        const { fixedIndices } = shape;
        const rewritten =
            fixedIndices === null ? this.triangulate(shape) : this.show(fixedIndices, shape.indexCount, false);

        this.bytes = positions.byteLength + this.indexBytes;

        return rewritten;
    }

    /** Frees the mesh, its geometry and both buffers. The shader belongs to the caller. */
    destroy(): void {
        const { geometry } = this.mesh;

        this.mesh.destroy();
        geometry.destroy();
        this.positionBuffer.destroy();
        this.indexBuffer.destroy();
        this.positions = NO_POSITIONS;
        this.indices = undefined;
        this.count = 0;
        this.bytes = 0;
    }

    /** The array for a polygon of so many numbers: the one in use when it has room, else a new one. */
    private reserve(floats: number): Float32Array {
        // the array all masks start with is not for writing
        if (this.positions === NO_POSITIONS || floats > this.positions.length) {
            // new arrays are zero, which draws nothing until they are written
            this.positions = new Float32Array(Math.max(floats, MIN_VERTICES * 2));
            this.positionBuffer.data = this.positions;
        }

        return this.positions;
    }

    /**
     * Brings the index array of the mask's own in line with the triangles of a shape that has no
     * array to share. Uploads it when it changed, or when the mask showed another array before.
     */
    private triangulate(shape: ClipShape): boolean {
        const count = shape.indexCount;
        let indices = this.indices;

        if (indices === undefined || count > indices.length) {
            indices = new Uint16Array(Math.max(count + (count & 1), MIN_INDICES));
            this.indices = indices;
            this.count = 0;
        }
        let changed = count !== this.count;

        for (let i = 0; i < count; i++) {
            const index = i32(shape.triangles, i);

            if (indices[i] !== index) {
                indices[i] = index;
                changed = true;
            }
        }
        if (changed && count < this.count) indices.fill(0, count, this.count);
        this.count = count;

        return this.show(indices, count, changed);
    }

    /**
     * Makes the index buffer draw `count` indices of an array. An array the buffer does not hold
     * yet uploads, and so does one whose content `changed`. Returns whether anything was uploaded.
     */
    private show(indices: Uint16Array, count: number, changed: boolean): boolean {
        const buffer = this.indexBuffer;

        if (buffer.data !== indices) {
            // Pixi uploads the new array. A shorter one goes into the GPU buffer that is there
            buffer.data = indices;
            this.indexBytes = Math.max(this.indexBytes, indices.byteLength);
        } else if (changed) {
            // the whole array: a part would leave old triangles on the GPU when two calls share a frame
            buffer.update();
        } else return false;
        // Pixi draws this many indices. With 0 it draws the whole array, which is zero then
        this.mesh.geometry.indexCount = count;

        return true;
    }
}
