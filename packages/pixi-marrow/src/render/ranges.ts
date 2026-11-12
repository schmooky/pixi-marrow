import {
    type BLEND_MODES,
    type Bounds,
    Buffer,
    Container,
    type Mesh,
    type Shader,
    type TextureSource,
    VERSION,
} from 'pixi.js';
import { i16, i32 } from '../geometry/read';
import { uploadsStretch } from './batch-upload';
import { ClipMask } from './clip-mask';
import type { ClipShape } from './clip-shape';
import type { MeasuredGeometry } from './measured-geometry';
import { createRangeMesh, type VertexBuffers } from './range-mesh';
import { u8, u16 } from './read';
import { createMaskShader, createViewShader, releaseShader } from './shader';
import { MAX_PAGES, type Template } from './template';
import { NO_CLIP, type VisibleList } from './visible';

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
 *
 * The index buffer of a range is zero past the indices the range draws, on the GPU too: a Pixi
 * without `Geometry.indexCount` draws the whole buffer, and zeros are triangles without area. A
 * range therefore knows how far the GPU can hold other indices, see `DrawRange.held`, and every
 * upload reaches that far.
 */

/** Whether a buffer of this Pixi uploads at once when it is told that it changed, see `uploadsStretch`. */
const AT_ONCE = uploadsStretch(Buffer.prototype.update, VERSION);

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
    /** Indices the range draws. The rest of the index array is zero: triangles without area. */
    count: number;
    /**
     * How many indices from the start of the buffer can be other than zero on the GPU. An upload
     * reaches this far, so that what the array has zeroed since is zero there too. It is the
     * count of the last upload where Pixi uploads at once. Where an upload waits for the next
     * draw and a later, shorter one would replace it, it is the most the buffer ever held.
     */
    held: number;
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
    /**
     * Per attached container, in draw order: the position its ranges behind it start at. The
     * container belongs in front of the child {@link anchor} names for that position.
     */
    readonly cutPositions: number[] = [];
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

            // the GPU keeps the indices of the layout before, until the next upload of the range zeroes them
            if (fits) range.indices.fill(0, 0, range.count);
            else {
                range.indices = this.createIndices();
                range.buffer.data = range.indices;
                // Pixi uploads the new array whole. Where that waits for a draw, the next upload must not be shorter
                range.held = AT_ONCE ? 0 : range.indices.length;
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
     * A range ends before an entry that follows an attached container, and so does a clip group.
     * So the container is drawn between two ranges and no clip cuts it. The list `seen` says
     * where attached containers are drawn. The field {@link cutPositions} then says where each
     * container belongs among the children.
     *
     * @param clips Per visible entry: the slot whose clipping attachment cuts it, or {@link NO_CLIP}.
     * @param skipped Per visible entry, 1 when a later slot covers it.
     */
    build(
        template: Template,
        visible: Int32Array,
        clips: Int16Array,
        skipped: Uint8Array,
        count: number,
        seen?: VisibleList,
    ): void {
        const { blendModes } = this.options;
        const starts = seen?.starts;
        let range: DrawRange | undefined;
        let clip = NO_CLIP;
        let written = 0;
        let total = 0;
        let cut = 0;

        this.serial++;
        this.position = 0;
        this.open = undefined;
        this.active = 0;
        this.masks = 0;
        for (let i = 0; i < count; i++) {
            const entry = i32(visible, i);
            const blend = blendKey(u8(blendModes, i32(template.slots, entry)));
            const group = Math.floor(i32(template.pages, entry) / MAX_PAGES);
            const by = i16(clips, i);
            const parted = starts?.[i] === 1;

            if (range === undefined || parted || by !== clip || range.blend !== blend || range.group !== group) {
                if (range !== undefined) total += this.close(range, written);
                written = 0;
                // a container is drawn here: the clip group before it ends, and the entry starts another one
                if (parted && seen !== undefined) cut = this.part(seen, cut, i);
                if (by !== clip || parted) this.enter(by);
                clip = by;
                range = this.next(blend, group);
            }
            if (u8(skipped, i) === 0) written = append(range.indices, written, template, entry);
        }
        if (range !== undefined) total += this.close(range, written);
        // the containers behind the last visible entry
        if (seen !== undefined && cut < seen.cutCount) this.part(seen, cut, count);
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

    /** Frees the meshes, the geometries, the index buffers and the masks, and gives the shaders back. The vertex buffers stay. */
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
        // the shaders are shared with other instances: the last one to give one back destroys it
        for (const shader of this.shaders) if (shader !== undefined) releaseShader(shader);
        if (this.maskShader !== undefined) releaseShader(this.maskShader);
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

    /**
     * Notes where the containers that are drawn before a visible entry belong: behind every range
     * and clip group the build has used so far. Returns the first cut behind that entry.
     */
    private part(seen: VisibleList, from: number, entry: number): number {
        let cut = from;

        this.open = undefined;
        // a group that is taken sits before the next position
        if (this.groups[this.position]?.build === this.serial) this.position++;
        while (cut < seen.cutCount && i32(seen.cuts, cut) <= entry) this.cutPositions[cut++] = this.position;

        return cut;
    }

    /**
     * The first child of the ranges that draws at a position or behind it, or undefined. A
     * container before that position stays in front of it. `plain` leaves the clip group of the position out.
     */
    anchor(position: number, plain: boolean): Container | undefined {
        const last = Math.max(this.groups.length, this.plain.length);

        for (let at = position; at < last; at++) {
            const group = at > position || !plain ? this.groups[at]?.container : undefined;
            const found = group ?? this.plain[at]?.mesh;

            if (found !== undefined) return found;
        }

        return undefined;
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
        // what the GPU must get: the new indices, and zeros over every index it can hold past them
        const changed = Math.max(written, range.held, EMPTY_RANGE);
        // a count of 0 would make Pixi draw the whole buffer
        const drawn = Math.max(written, EMPTY_RANGE);

        if (written < range.count) range.indices.fill(0, written, range.count);
        range.count = written;
        // Pixi draws this many indices. A Pixi without `indexCount` draws all, and the rest is zero.
        range.mesh.geometry.indexCount = drawn;
        range.buffer.update(changed * range.indices.BYTES_PER_ELEMENT);
        // an upload that waits for a draw can be replaced by the next one, which must then reach as far
        range.held = AT_ONCE ? written : Math.max(written, range.held);
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
     * position the clip group, then the plain range. It goes in front of the next child of the
     * ranges that exists, and to the end when there is none. Children that are no ranges, like a
     * container that is attached between two slots, stay where they are.
     */
    private childIndex(position: number, plain: boolean): number {
        const { container } = this.options;
        // the range of a position is behind the clip group of that position
        const behind = plain
            ? this.anchor(position + 1, false)
            : (this.plain[position]?.mesh ?? this.anchor(position + 1, false));

        return behind === undefined ? container.children.length : container.getChildIndex(behind);
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
        const { mesh, buffer } = createRangeMesh(buffers, dark, measure, this.shader(group), indices, 'marrow-range');
        const range: DrawRange = { mesh, buffer, indices, count: 0, held: 0, blend: 0, group, build: 0 };

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
