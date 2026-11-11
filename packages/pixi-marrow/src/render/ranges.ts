import {
    type BLEND_MODES,
    type Bounds,
    Buffer,
    BufferUsage,
    type Container,
    Geometry,
    type GeometryDescriptor,
    Mesh,
    type Shader,
    type TextureSource,
} from 'pixi.js';
import { i32 } from '../geometry/read';
import { u8, u16 } from './read';
import { createViewShader, MAX_PAGES } from './shader';
import { STATIC_STRIDE, type Template } from './template';

/*
 * The draw ranges of one skeleton instance. A range is one Pixi mesh with its own index buffer.
 * All ranges read the same vertex buffers. Normal and additive slots share a range. A slot with
 * multiply or screen blend starts a new one, and so does a page outside the 8 pages of the range.
 * Ranges are created on first use and kept, so a rebuild allocates nothing once it has run.
 */

/** The vertex buffers every range reads. */
interface VertexBuffers {
    /** x, y per vertex. */
    readonly positions: Buffer;
    /** u, v and four flag bytes per vertex. */
    readonly statics: Buffer;
    /** The light color per vertex, and with dark colors the dark color after it. */
    readonly colors: Buffer;
}

/** What {@link DrawRanges} draws with. */
export interface DrawRangesOptions {
    /** Where the meshes go, in draw order. */
    readonly container: Container;
    readonly buffers: VertexBuffers;
    /** The texture source of every atlas page, in page order. */
    readonly pages: readonly TextureSource[];
    /** Whether the color buffer holds dark colors. */
    readonly dark: boolean;
    /** The blend mode of each slot: an index into `BLEND_MODES` of the model. */
    readonly blendModes: Uint8Array;
    /** The bounds of what is visible. Pixi asks for them when it culls or measures. */
    readonly measure: () => Bounds;
}

/** The Pixi blend mode of a range for a slot blend mode. Normal and additive inherit from the container. */
const PIXI_BLEND: readonly BLEND_MODES[] = ['inherit', 'inherit', 'multiply', 'screen'];

/** The fewest indices a range has room for, so that its GPU buffer is never empty. */
const MIN_INDICES = 6;

/** A geometry that takes its bounds from the view, so Pixi never scans the vertex buffer. */
class RangeGeometry extends Geometry {
    private readonly measure: () => Bounds;

    constructor(options: GeometryDescriptor, measure: () => Bounds) {
        super(options);
        this.measure = measure;
    }

    override get bounds(): Bounds {
        return this.measure();
    }
}

/** One draw call: a mesh, its index buffer and what it was set up for. */
interface DrawRange {
    readonly mesh: Mesh<RangeGeometry, Shader>;
    readonly buffer: Buffer;
    indices: Uint16Array | Uint32Array;
    /** Indices the range draws. The rest of the index buffer is zero: triangles without area. */
    count: number;
    /** The slot blend mode the mesh is set to. Additive counts as normal. */
    blend: number;
    /** The group of 8 pages the shader of the mesh samples. */
    group: number;
}

/** Normal and additive slots draw with the same blend state. */
const blendKey = (blendMode: number): number => (blendMode === 1 ? 0 : blendMode);

/**
 * The draw calls of one skeleton instance: Pixi meshes that share the vertex buffers of the view,
 * each with its own index buffer, blend mode and group of atlas pages.
 *
 * @example
 * const ranges = new DrawRanges({ container, buffers, pages, dark, blendModes, measure });
 * ranges.resize(template);
 * ranges.build(template, visibleEntries, visibleCount);
 * console.log(ranges.active, ranges.indices);
 */
export class DrawRanges {
    /** Ranges that draw at the moment: the draw calls of the skeleton. */
    active = 0;
    /** Indices all ranges draw at the moment. */
    indices = 0;
    /** The bytes of the index data of all ranges. */
    bytes = 0;
    private readonly options: DrawRangesOptions;
    private readonly ranges: DrawRange[] = [];
    private readonly shaders: (Shader | undefined)[] = [];
    private capacity = MIN_INDICES;
    private wide = false;

    constructor(options: DrawRangesOptions) {
        this.options = options;
    }

    /**
     * Makes room for the indices of a new template. Call it after the vertex buffers got their new
     * data and before {@link build}. Indices are 32-bit when there are more than 65,535 vertices.
     */
    resize(template: Template): void {
        // an even count keeps a 16-bit index buffer a multiple of 4 bytes, which WebGPU asks for
        this.capacity = Math.max(MIN_INDICES, template.indexCapacity + (template.indexCapacity & 1));
        this.wide = template.vertexCount > 65535;
        this.bytes = 0;
        for (const range of this.ranges) {
            const fits = range.indices.length >= this.capacity && range.indices instanceof Uint32Array === this.wide;

            if (fits) range.indices.fill(0, 0, range.count);
            else {
                range.indices = this.createIndices();
                range.buffer.data = range.indices;
            }
            range.count = 0;
            this.bytes += range.indices.byteLength;
        }
    }

    /**
     * Rewrites the index buffers for the visible entries of a template, given in draw order, and
     * splits them into ranges. Vertex data does not move.
     */
    build(template: Template, visible: Int32Array, count: number): void {
        const { blendModes } = this.options;
        let range: DrawRange | undefined;
        let at = 0;
        let written = 0;
        let total = 0;

        for (let i = 0; i < count; i++) {
            const entry = i32(visible, i);
            const blend = blendKey(u8(blendModes, i32(template.slots, entry)));
            const group = Math.floor(i32(template.pages, entry) / MAX_PAGES);

            if (range === undefined || range.blend !== blend || range.group !== group) {
                if (range !== undefined) this.close(range, written);
                total += written;
                written = 0;
                range = this.open(at++, blend, group);
            }
            written = append(range.indices, written, template, entry);
        }
        if (range !== undefined) this.close(range, written);
        for (let unused = at; unused < this.active; unused++) this.hide(unused);
        this.active = at;
        this.indices = total + written;
    }

    /** Frees the meshes, the geometries, the index buffers and the shaders. The vertex buffers stay. */
    destroy(): void {
        for (const range of this.ranges) {
            const { geometry } = range.mesh;

            range.mesh.destroy();
            geometry.destroy();
            range.buffer.destroy();
        }
        for (const shader of this.shaders) shader?.destroy();
        this.ranges.length = 0;
        this.shaders.length = 0;
        this.active = 0;
        this.indices = 0;
        this.bytes = 0;
    }

    /** The range at a position, set to a blend mode and a group of pages. Created on first use. */
    private open(at: number, blend: number, group: number): DrawRange {
        const range = this.ranges[at] ?? this.create(group);

        if (range.blend !== blend) {
            range.blend = blend;
            range.mesh.blendMode = PIXI_BLEND[blend] ?? 'inherit';
        }
        if (range.group !== group) {
            range.group = group;
            range.mesh.shader = this.shader(group);
        }

        return range;
    }

    /** Ends a range: the indices past the last one become triangles without area, then the buffer uploads. */
    private close(range: DrawRange, written: number): void {
        // what changed: the new indices, and the old ones past them that are zero now
        const changed = Math.max(written, range.count);

        if (written < range.count) range.indices.fill(0, written, range.count);
        range.count = written;
        // Pixi draws this many indices. A Pixi without `indexCount` draws all, and the rest is zero.
        range.mesh.geometry.indexCount = written;
        range.buffer.update(changed * range.indices.BYTES_PER_ELEMENT);
        range.mesh.visible = true;
    }

    private hide(at: number): void {
        const range = this.ranges[at];

        if (range !== undefined) range.mesh.visible = false;
    }

    private createIndices(): Uint16Array | Uint32Array {
        return this.wide ? new Uint32Array(this.capacity) : new Uint16Array(this.capacity);
    }

    private shader(group: number): Shader {
        const { pages, dark } = this.options;
        const shader =
            this.shaders[group] ?? createViewShader(pages.slice(group * MAX_PAGES, (group + 1) * MAX_PAGES), dark);

        this.shaders[group] = shader;

        return shader;
    }

    private create(group: number): DrawRange {
        const { container, buffers, dark, measure } = this.options;
        const indices = this.createIndices();
        const buffer = new Buffer({
            data: indices,
            label: 'marrow-indices',
            usage: BufferUsage.INDEX | BufferUsage.COPY_DST,
            shrinkToFit: false,
        });
        const colorStride = dark ? 8 : 4;
        const staticStride = STATIC_STRIDE * 4;
        const geometry = new RangeGeometry(
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
        const mesh = new Mesh({ geometry, shader: this.shader(group), label: 'marrow-range' });
        const range: DrawRange = { mesh, buffer, indices, count: 0, blend: 0, group };

        container.addChild(mesh);
        this.ranges.push(range);
        this.bytes += indices.byteLength;

        return range;
    }
}

/** Appends the triangles of one entry to an index array. Returns the position after them. */
function append(indices: Uint16Array | Uint32Array, at: number, template: Template, entry: number): number {
    const triangles = template.triangles[entry];
    const first = i32(template.first, entry);

    if (triangles === undefined) return at;
    for (let t = 0; t < triangles.length; t++) indices[at + t] = first + u16(triangles, t);

    return at + triangles.length;
}
