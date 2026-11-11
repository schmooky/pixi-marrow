import { Bounds, Buffer, BufferUsage, Container, type Texture, type TextureSource } from 'pixi.js';
import { MarrowError } from '../base/errors';
import { resolveSequenceIndex } from '../geometry/atlas-regions';
import { f32, f64, i16, i32 } from '../geometry/read';
import { computeRegionWorldVertices } from '../geometry/region';
import { computeWorldVertices } from '../geometry/vertices';
import type { AtlasModel } from '../model/atlas';
import type { AttachmentData } from '../model/attachments';
import type { SkeletonModel } from '../model/model';
import { type AttachmentLookup, createAttachmentLookup } from '../pose/shared/lookup';
import type { PoseState } from '../pose/state';
import { writeDark, writeLight } from './colors';
import { DrawRanges } from './ranges';
import { u8 } from './read';
import { MAX_PAGES } from './shader';
import { buildTemplate, findEntry, showFrame, type Template, templateBytes } from './template';

/** Counters a view keeps, for the perf report and for tests. Where not said otherwise they only grow. */
export interface ViewStats {
    /** Draw calls the view issues per frame at the moment. */
    drawCalls: number;
    /** Vertices in the buffers at the moment. */
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
    /** Indices the view draws at the moment. */
    indices: number;
    /** Bytes of vertex and index data the view holds at the moment. */
    bufferBytes: number;
    /**
     * Clipping attachments shown at the moment. Clipping is not solved yet: such an attachment
     * draws nothing and clips nothing.
     */
    clippingIgnored: number;
}

/** What a slot shows when it is no entry of the template. */
const NONE = -1;
/** A region or mesh attachment the template has no range for. */
const FOREIGN = -2;
/** A clipping attachment. */
const CLIPPING = -3;

/** The deform of a slot that has none. */
const NO_DEFORM = new Float64Array(0);

/** The sources of the page textures. Throws when a page has no texture or a texture is not premultiplied. */
function pageSources(atlas: AtlasModel, textures: readonly Texture[]): TextureSource[] {
    return atlas.pages.map((page, index) => {
        const texture = textures[index];

        if (texture === undefined) {
            throw new MarrowError(
                'invalid-data',
                `The atlas has ${atlas.pages.length} pages and the view got ${textures.length} textures.`,
                { fix: 'Pass one texture per atlas page, in page order.' },
            );
        }
        if (texture.source.alphaMode === 'no-premultiply-alpha') {
            throw new MarrowError(
                'invalid-data',
                `The texture of the atlas page "${page.name}" is not premultiplied.`,
                {
                    fix: 'Set the alphaMode of its source to "premultiply-alpha-on-upload", or to "premultiplied-alpha" for a premultiplied image.',
                },
            );
        }

        return texture.source;
    });
}

const vertexBuffer = (data: Float32Array | Uint8Array, label: string): Buffer =>
    new Buffer({ data, label, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST, shrinkToFit: false });

/**
 * Draws one skeleton instance with Pixi from its pose, in mesh mode: one Pixi mesh per draw range,
 * all ranges on the same vertex buffers. A skeleton without multiply or screen slots and with up
 * to 8 atlas pages is one draw call.
 *
 * The vertex layout is stable. Every attachment a slot can show has its own vertex range, so
 * showing, hiding and reordering slots rewrites the index buffer only. Positions upload on every
 * update, colors when they change, texture coordinates when a sequence shows another region.
 *
 * The textures must hold premultiplied colors on the GPU. The view samples the whole source of
 * each texture. Clipping attachments are not solved yet, see {@link ViewStats.clippingIgnored}.
 *
 * @example
 * const model = await importSkeleton(bytes);
 * const atlas = importAtlas(atlasText);
 * const engine = await createPoseEngine(model);
 * const view = new SkeletonView(model, atlas, pageTextures);
 *
 * stage.addChild(view.container);
 * engine.setAnimation(0, 0, true);
 * engine.update(1 / 60);
 * view.update(engine.state);
 */
export class SkeletonView {
    /** The Pixi objects to put into the display list. */
    readonly container: Container;
    /** What the view did and what it holds. */
    readonly stats: ViewStats;
    private readonly model: SkeletonModel;
    private readonly atlas: AtlasModel;
    private readonly lookup: AttachmentLookup;
    private readonly dark: boolean;
    private readonly positions: Buffer;
    private readonly statics: Buffer;
    private readonly colors: Buffer;
    private readonly ranges: DrawRanges;
    private readonly bounds: Bounds = new Bounds();
    /** Per slot: the attachment `entries` was resolved for. */
    private readonly shown: (AttachmentData | null)[];
    /** Per slot: the entry of the attachment it shows, or a negative code. */
    private readonly entries: Int32Array;
    /** The visible entries in draw order. The index buffers hold this list. */
    private readonly visible: Int32Array;
    private visibleCount = 0;
    private template: Template;
    private indexDirty = true;
    private boundsDirty = true;
    private destroyed = false;

    /**
     * Lays out the vertex ranges for the default skin. Throws a `MarrowError` when the atlas
     * misses a region of an attachment, when a page has no texture, or when a texture is not
     * premultiplied.
     *
     * @param textures One texture per atlas page, in page order, premultiplied on the GPU.
     */
    constructor(model: SkeletonModel, atlas: AtlasModel, textures: readonly Texture[]) {
        const slots = model.slots.count;
        const pages = pageSources(atlas, textures);

        this.model = model;
        this.atlas = atlas;
        this.lookup = createAttachmentLookup(model);
        this.dark = model.slots.hasDark.includes(1);
        this.template = buildTemplate(model, atlas, this.lookup, -1, null, this.dark);
        this.shown = new Array<AttachmentData | null>(slots).fill(null);
        this.entries = new Int32Array(slots).fill(NONE);
        this.visible = new Int32Array(slots);
        this.container = new Container({ label: 'marrow-skeleton' });
        this.positions = vertexBuffer(this.template.positions, 'marrow-positions');
        this.statics = vertexBuffer(this.template.statics, 'marrow-uvs');
        this.colors = vertexBuffer(this.template.colors, 'marrow-colors');
        this.ranges = new DrawRanges({
            container: this.container,
            buffers: { positions: this.positions, statics: this.statics, colors: this.colors },
            pages,
            dark: this.dark,
            blendModes: model.slots.blendModes,
            measure: () => this.measure(),
        });
        this.ranges.resize(this.template);
        this.stats = {
            drawCalls: 0,
            vertices: this.template.vertexCount,
            templateBuilds: 1,
            indexRebuilds: 0,
            positionUploads: 0,
            colorUploads: 0,
            uvUploads: 0,
            indices: 0,
            bufferBytes: templateBytes(this.template),
            clippingIgnored: 0,
        };
    }

    /**
     * Brings the buffers in line with a pose. Call after the pose engine has updated. Allocates
     * nothing once every draw range the skeleton needs has been used.
     *
     * Throws a `MarrowError` for a pose of another model and after {@link destroy}.
     */
    update(state: PoseState): void {
        this.check(state);
        if (state.skin !== this.template.skin || !this.resolve(state)) {
            this.rebuild(state);
            this.resolve(state);
        }
        const count = this.collect(state);

        if (count > 0) this.pose(state, count);
        if (this.indexDirty) this.reindex(count);
    }

    /** Frees the buffers, the meshes and the shaders. The textures belong to the caller. */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.ranges.destroy();
        this.positions.destroy();
        this.statics.destroy();
        this.colors.destroy();
        this.container.destroy({ children: true });
        this.shown.fill(null);
        this.visibleCount = 0;
        this.stats.drawCalls = 0;
        this.stats.indices = 0;
        this.stats.vertices = 0;
        this.stats.bufferBytes = 0;
    }

    private check(state: PoseState): void {
        if (this.destroyed) {
            throw new MarrowError('invalid-data', 'The view was destroyed and cannot draw a pose.', {
                fix: 'Create a new SkeletonView, or stop updating this one.',
            });
        }
        if (state.model !== this.model) {
            throw new MarrowError('invalid-data', 'The pose belongs to another skeleton model than the view.', {
                fix: 'Pass the PoseState of the model the view was created for.',
            });
        }
    }

    /** Builds the vertex ranges again: for the skin of the pose and for what its slots show now. */
    private rebuild(state: PoseState): void {
        const template = buildTemplate(this.model, this.atlas, this.lookup, state.skin, state.attachments, this.dark);

        this.template = template;
        this.positions.data = template.positions;
        this.statics.data = template.statics;
        this.colors.data = template.colors;
        this.ranges.resize(template);
        this.shown.fill(null);
        this.entries.fill(NONE);
        this.visibleCount = 0;
        this.indexDirty = true;
        this.boundsDirty = true;
        this.stats.templateBuilds++;
        this.stats.vertices = template.vertexCount;
    }

    /**
     * Finds the entry of every slot whose attachment changed since the last update. Returns false
     * when a slot shows a region or a mesh the template has no range for.
     */
    private resolve(state: PoseState): boolean {
        const { shown, entries, template } = this;
        const { attachments } = state;
        let known = true;

        for (let slot = 0; slot < shown.length; slot++) {
            const attachment = attachments[slot] ?? null;

            if (attachment === shown[slot]) continue;
            const entry = attachment?.type === 'clipping' ? CLIPPING : findEntry(template, slot, attachment);

            // not remembered: when the template cannot be built, the next update asks again
            if (entry === FOREIGN) known = false;
            else {
                shown[slot] = attachment;
                entries[slot] = entry;
            }
        }

        return known;
    }

    /**
     * Lists the visible entries in draw order. A slot is hidden without a region or mesh
     * attachment, on an inactive bone, and when its alpha times the alpha of the attachment is 0.
     * Marks the index buffer dirty when the list differs from the one before.
     */
    private collect(state: PoseState): number {
        const { entries, visible } = this;
        const { tints } = this.template;
        const { bones } = this.model.slots;
        const { drawOrder, active, colors } = state;
        let count = 0;
        let clipping = 0;

        for (let i = 0; i < drawOrder.length; i++) {
            const slot = i16(drawOrder, i);
            const entry = i32(entries, slot);

            if (u8(active, i16(bones, slot)) === 0) continue;
            if (entry === CLIPPING) clipping++;
            if (entry < 0 || f64(colors, slot * 4 + 3) * f64(tints, entry * 4 + 3) === 0) continue;
            if (visible[count] !== entry) {
                visible[count] = entry;
                this.indexDirty = true;
            }
            count++;
        }
        if (count !== this.visibleCount) this.indexDirty = true;
        this.visibleCount = count;
        this.stats.clippingIgnored = clipping;

        return count;
    }

    /** Positions, sequence frames and colors of the visible entries, then the uploads. */
    private pose(state: PoseState, count: number): void {
        const { visible, template, stats } = this;
        let colorsChanged = false;
        let uvsChanged = false;

        for (let i = 0; i < count; i++) {
            const entry = i32(visible, i);
            const slot = i32(template.slots, entry);

            if (i32(template.frameCounts, entry) > 1 && this.sequence(state, entry, slot)) uvsChanged = true;
            this.place(state, entry, slot);
            if (this.tint(state, entry, slot)) colorsChanged = true;
        }
        this.positions.update();
        this.boundsDirty = true;
        stats.positionUploads++;
        if (uvsChanged) {
            this.statics.update();
            stats.uvUploads++;
        }
        if (colorsChanged) {
            this.colors.update();
            stats.colorUploads++;
        }
    }

    /** Shows the region of a sequence the slot is at. Returns whether texture coordinates were rewritten. */
    private sequence(state: PoseState, entry: number, slot: number): boolean {
        const { template } = this;
        const attachment = template.attachments[entry];

        if (attachment === undefined) return false;
        const before = Math.floor(i32(template.pages, entry) / MAX_PAGES);

        if (!showFrame(template, entry, resolveSequenceIndex(attachment.sequence, i32(state.sequenceIndices, slot)))) {
            return false;
        }
        // a frame on a page of another group of 8 moves the entry to another draw range
        if (Math.floor(i32(template.pages, entry) / MAX_PAGES) !== before) this.indexDirty = true;

        return true;
    }

    /** Writes the world positions of one entry with the geometry kernel. */
    private place(state: PoseState, entry: number, slot: number): void {
        const { template } = this;
        const source = template.sources[entry];
        const bone = i16(this.model.slots.bones, slot);
        const at = i32(template.first, entry) * 2;

        if (source == null) {
            const offsets = i32(template.offsetAt, entry) + i32(template.frames, entry) * 8;

            computeRegionWorldVertices(template.offsets, offsets, state.world, bone, template.positions, at);
        } else {
            const deform = state.deform[slot] ?? NO_DEFORM;

            computeWorldVertices(
                source,
                state.world,
                bone,
                deform,
                i32(state.deformLengths, slot),
                template.positions,
                at,
            );
        }
    }

    /** Writes the colors of one entry when they differ from what its vertices hold. Returns whether it wrote. */
    private tint(state: PoseState, entry: number, slot: number): boolean {
        const { template } = this;
        const light = writeLight(template, entry, state.colors, slot);

        if (!template.hasDark) return light;
        const dark = writeDark(template, entry, state.darkColors, slot, u8(this.model.slots.hasDark, slot) === 1);

        return light || dark;
    }

    /** Rewrites the index buffers for the visible entries. Vertex data stays where it is. */
    private reindex(count: number): void {
        const { ranges, stats } = this;

        ranges.build(this.template, this.visible, count);
        this.indexDirty = false;
        stats.indexRebuilds++;
        stats.drawCalls = ranges.active;
        stats.indices = ranges.indices;
        stats.bufferBytes = templateBytes(this.template) + ranges.bytes;
    }

    /**
     * The bounds of the visible vertices. Pixi asks for them through the geometry of each mesh.
     * The vertices are scanned once after an update, and only when somebody asks.
     */
    private measure(): Bounds {
        const { bounds, visible, template } = this;

        if (!this.boundsDirty) return bounds;
        this.boundsDirty = false;
        bounds.clear();
        for (let i = 0; i < this.visibleCount; i++) {
            const entry = i32(visible, i);
            const first = i32(template.first, entry) * 2;
            const end = first + i32(template.counts, entry) * 2;

            for (let at = first; at < end; at += 2) {
                const x = f32(template.positions, at);
                const y = f32(template.positions, at + 1);

                if (x < bounds.minX) bounds.minX = x;
                if (x > bounds.maxX) bounds.maxX = x;
                if (y < bounds.minY) bounds.minY = y;
                if (y > bounds.maxY) bounds.maxY = y;
            }
        }

        return bounds;
    }
}
