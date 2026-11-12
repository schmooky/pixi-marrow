import {
    type BLEND_MODES,
    type Bounds,
    Buffer,
    BufferUsage,
    Container,
    Mesh,
    type Shader,
    type TextureSource,
} from 'pixi.js';
import { i16, i32 } from '../geometry/read';
import { ClipMask } from './clip-mask';
import type { ClipShape } from './clip-shape';
import { MeasuredGeometry } from './measured-geometry';
import { u8, u16 } from './read';
import { createMaskShader, createViewShader, MAX_PAGES } from './shader';
import { STATIC_STRIDE, type Template } from './template';

/*
 * The draw ranges of one skeleton instance. A range is one Pixi mesh with its own index buffer.
 * All ranges read the same vertex buffers. Normal and additive slots share a range. A slot with
 * multiply or screen blend starts a new one, and so does a page outside the 8 pages of the range.
 *
 * The slots a clipping attachment cuts are a stretch of ranges of their own, inside a container
 * that has the clip polygon as its stencil mask. Pixi draws the mask before the container and
 * again after it, so a clip costs two draw calls on top of its ranges.
 *
 * Ranges and clip groups are created on first use and kept, so a rebuild allocates nothing once
 * it has run. The children of the container have a fixed order: at every position a clip group
 * comes first, then a range. A build walks that order and hides what it does not use, so no child
 * ever moves.
 *
 * A slot that is skipped as covered keeps its place in that order and adds no index. The ranges,
 * their blend modes and their clip groups are therefore the same with and without skipped slots:
 * a change of the covered slots rewrites index data and nothing else. That matters when it
 * happens while Pixi draws, where the list of meshes can no longer change.
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
    /** Where the meshes and the clip groups go, in draw order. It must hold nothing else. */
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

/** The clip of a visible entry that no clipping attachment cuts. */
export const NO_CLIP = -1;

/** The Pixi blend mode of a range for a slot blend mode. Normal and additive inherit from the container. */
const PIXI_BLEND: readonly BLEND_MODES[] = ['inherit', 'inherit', 'multiply', 'screen'];

/** The fewest indices a range has room for, so that its GPU buffer is never empty. */
const MIN_INDICES = 6;

/** The indices a range draws when all of its slots are skipped: one triangle without area. */
const EMPTY_RANGE = 3;

/** One draw call: a mesh, its index buffer and what it was set up for. */
interface DrawRange {
    readonly mesh: Mesh<MeasuredGeometry, Shader>;
    readonly buffer: Buffer;
    indices: Uint16Array | Uint32Array;
    /** Indices the range draws. The rest of the index buffer is zero: triangles without area. */
    count: number;
    /** The slot blend mode the mesh is set to. Additive counts as normal. */
    blend: number;
    /** The group of 8 pages the shader of the mesh samples. */
    group: number;
    /** The build that used the range last. */
    build: number;
}

/** The ranges one clipping attachment cuts: a container with the clip polygon as its stencil mask. */
interface ClipGroup {
    readonly container: Container;
    readonly mask: ClipMask;
    /** The ranges inside, in draw order. */
    readonly ranges: DrawRange[];
    /** How many of the ranges draw. */
    used: number;
    /** The slot whose clipping attachment cuts the group. */
    slot: number;
    /** Whether the container draws outside of its mask. */
    inverse: boolean;
    /** The build that used the group last. */
    build: number;
}

/** Normal and additive slots draw with the same blend state. */
const blendKey = (blendMode: number): number => (blendMode === 1 ? 0 : blendMode);

/**
 * The draw calls of one skeleton instance: Pixi meshes that share the vertex buffers of the view,
 * each with its own index buffer, blend mode and group of atlas pages. The meshes of clipped
 * slots sit in containers with a stencil mask.
 *
 * @example
 * const ranges = new DrawRanges({ container, buffers, pages, dark, blendModes, measure });
 * ranges.resize(template);
 * ranges.build(template, visibleEntries, clipOfEachEntry, visibleCount);
 * console.log(ranges.active + ranges.masks * 2, ranges.indices);
 */
export class DrawRanges {
    /** Ranges that draw at the moment: the draw calls of the skeleton without those of its masks. */
    active = 0;
    /** Clip masks that draw at the moment. Each one is two more draw calls. */
    masks = 0;
    /**
     * Indices all ranges draw at the moment. A range whose slots are all skipped draws one
     * triangle without area, which counts as 3.
     */
    indices = 0;
    /** How many children the container holds before the ranges and clip groups. They stay first. */
    lead = 0;
    /** The bytes of the index data of all ranges and of the data of all masks. */
    bytes = 0;
    private readonly options: DrawRangesOptions;
    /** Per position: the range outside of any clip. A position that was never used has none. */
    private readonly plain: (DrawRange | undefined)[] = [];
    /** Per position: the clip group. It is drawn before the plain range of the position. */
    private readonly groups: (ClipGroup | undefined)[] = [];
    /** Every range, in clip groups or not. */
    private readonly all: DrawRange[] = [];
    /** Every clip group. */
    private readonly clipped: ClipGroup[] = [];
    /** The clip groups in use, in draw order. Valid up to {@link masks}. */
    private readonly masked: ClipGroup[] = [];
    private readonly shaders: (Shader | undefined)[] = [];
    private maskShader: Shader | undefined;
    private capacity = MIN_INDICES;
    private wide = false;
    /** Counts the builds. A range or group that carries the number is in use. */
    private serial = 0;
    /** The position the next plain range or clip group goes to. */
    private position = 0;
    /** The clip group that is being filled, if any. */
    private open: ClipGroup | undefined;

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
        for (const range of this.all) {
            const fits = range.indices.length >= this.capacity && range.indices instanceof Uint32Array === this.wide;

            if (fits) range.indices.fill(0, 0, range.count);
            else {
                range.indices = this.createIndices();
                range.buffer.data = range.indices;
            }
            range.count = 0;
            this.bytes += range.indices.byteLength;
        }
        for (const group of this.clipped) this.bytes += group.mask.bytes;
    }

    /**
     * Rewrites the index buffers for the visible entries of a template, given in draw order, and
     * splits them into ranges. Vertex data does not move.
     *
     * @param clips Per visible entry: the slot whose clipping attachment cuts it, or {@link NO_CLIP}.
     * @param skipped Per visible entry, 1 when a later slot covers it.
     */
    build(template: Template, visible: Int32Array, clips: Int16Array, skipped: Uint8Array, count: number): void {
        const { blendModes } = this.options;
        let range: DrawRange | undefined;
        let clip = NO_CLIP;
        let written = 0;
        let total = 0;

        this.serial++;
        this.position = 0;
        this.open = undefined;
        this.active = 0;
        this.masks = 0;
        for (let i = 0; i < count; i++) {
            const entry = i32(visible, i);
            const blend = blendKey(u8(blendModes, i32(template.slots, entry)));
            const group = Math.floor(i32(template.pages, entry) / MAX_PAGES);
            const cut = i16(clips, i);

            if (range === undefined || cut !== clip || range.blend !== blend || range.group !== group) {
                if (range !== undefined) total += this.close(range, written);
                written = 0;
                if (cut !== clip) this.enter(cut);
                clip = cut;
                range = this.next(blend, group);
            }
            if (u8(skipped, i) === 0) written = append(range.indices, written, template, entry);
        }
        if (range !== undefined) total += this.close(range, written);
        this.hideUnused();
        this.indices = total;
    }

    /** The slot whose clipping attachment cuts the mask at a position of the masks in use. */
    maskSlot(index: number): number {
        return this.masked[index]?.slot ?? NO_CLIP;
    }

    /**
     * Shows a shape in the mask at a position of the masks in use. Returns whether the triangles
     * of the mask were rewritten.
     */
    placeMask(index: number, shape: ClipShape): boolean {
        const group = this.masked[index];

        if (group === undefined) return false;
        const before = group.mask.bytes;
        const rewritten = group.mask.place(shape);

        this.bytes += group.mask.bytes - before;
        if (group.inverse !== shape.inverse) {
            group.inverse = shape.inverse;
            group.container.setMask({ mask: group.mask.mesh, inverse: shape.inverse });
        }

        return rewritten;
    }

    /** Frees the meshes, the geometries, the index buffers, the masks and the shaders. The vertex buffers stay. */
    destroy(): void {
        for (const range of this.all) {
            const { geometry } = range.mesh;

            range.mesh.destroy();
            geometry.destroy();
            range.buffer.destroy();
        }
        for (const group of this.clipped) {
            group.container.mask = null;
            group.mask.destroy();
            group.container.destroy();
        }
        for (const shader of this.shaders) shader?.destroy();
        this.maskShader?.destroy();
        this.maskShader = undefined;
        this.all.length = 0;
        this.clipped.length = 0;
        this.masked.length = 0;
        this.plain.length = 0;
        this.groups.length = 0;
        this.shaders.length = 0;
        this.active = 0;
        this.masks = 0;
        this.indices = 0;
        this.bytes = 0;
    }

    /** Leaves the clip group that is being filled and enters the one of another clip, or none. */
    private enter(clip: number): void {
        this.open = undefined;
        if (clip === NO_CLIP) return;
        // a group that is taken sits before the next position, and so does the range after it
        if (this.groups[this.position]?.build === this.serial) this.position++;
        const group = this.groups[this.position] ?? this.createGroup(this.position);

        group.build = this.serial;
        group.used = 0;
        group.slot = clip;
        group.container.visible = true;
        this.open = group;
        this.masked[this.masks++] = group;
    }

    /** The next range in draw order, set to a blend mode and a group of pages. Created on first use. */
    private next(blend: number, group: number): DrawRange {
        const { open } = this;
        const range =
            open === undefined
                ? (this.plain[this.position] ?? this.create(group, undefined))
                : (open.ranges[open.used] ?? this.create(group, open));

        if (open === undefined) this.position++;
        else open.used++;
        range.build = this.serial;
        this.active++;
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

    /**
     * Ends a range: the indices past the last one become triangles without area, then the buffer
     * uploads. Returns how many indices the range draws.
     */
    private close(range: DrawRange, written: number): number {
        // what changed: the new indices, and the old ones past them that are zero now
        const changed = Math.max(written, range.count);
        // a count of 0 would make Pixi draw the whole buffer
        const drawn = Math.max(written, EMPTY_RANGE);

        if (written < range.count) range.indices.fill(0, written, range.count);
        range.count = written;
        // Pixi draws this many indices. A Pixi without `indexCount` draws all, and the rest is zero.
        range.mesh.geometry.indexCount = drawn;
        range.buffer.update(Math.max(changed, EMPTY_RANGE) * range.indices.BYTES_PER_ELEMENT);
        range.mesh.visible = true;

        return drawn;
    }

    /** Hides every range and every clip group the last build did not use. */
    private hideUnused(): void {
        const { all, clipped, serial } = this;

        for (let i = 0; i < all.length; i++) {
            const range = all[i];

            if (range !== undefined && range.build !== serial) range.mesh.visible = false;
        }
        for (let i = 0; i < clipped.length; i++) {
            const group = clipped[i];

            if (group !== undefined && group.build !== serial) group.container.visible = false;
        }
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

    /**
     * Where a new child of the container goes, so that the children keep their order: per
     * position the clip group, then the plain range.
     */
    private childIndex(position: number, plain: boolean): number {
        let index = this.lead + (plain && this.groups[position] !== undefined ? 1 : 0);

        for (let before = 0; before < position; before++) {
            if (this.groups[before] !== undefined) index++;
            if (this.plain[before] !== undefined) index++;
        }

        return index;
    }

    /** A clip group for a position, with its mask. The mask is a child, so both share a transform. */
    private createGroup(position: number): ClipGroup {
        const { container: parent, measure } = this.options;
        const container = new Container({ label: 'marrow-clip' });

        this.maskShader ??= createMaskShader();
        const mask = new ClipMask(this.maskShader, measure);
        const group: ClipGroup = { container, mask, ranges: [], used: 0, slot: NO_CLIP, inverse: false, build: 0 };

        container.addChild(mask.mesh);
        container.mask = mask.mesh;
        parent.addChildAt(container, this.childIndex(position, false));
        this.groups[position] = group;
        this.clipped.push(group);
        this.bytes += mask.bytes;

        return group;
    }

    /** A range for the next place in a clip group, or outside of any clip for the current position. */
    private create(group: number, parent: ClipGroup | undefined): DrawRange {
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
        const mesh = new Mesh({ geometry, shader: this.shader(group), label: 'marrow-range' });
        const range: DrawRange = { mesh, buffer, indices, count: 0, blend: 0, group, build: 0 };

        if (parent === undefined) {
            container.addChildAt(mesh, this.childIndex(this.position, true));
            this.plain[this.position] = range;
        } else {
            parent.container.addChild(mesh);
            parent.ranges.push(range);
        }
        this.all.push(range);
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
