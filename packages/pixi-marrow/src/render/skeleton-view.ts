import { Bounds, type Buffer, Container, RenderContainer, type Texture } from 'pixi.js';
import { MarrowError } from '../base/errors';
import { resolveSequenceIndex } from '../geometry/atlas-regions';
import { i16, i32 } from '../geometry/read';
import type { AtlasModel } from '../model/atlas';
import type { AttachmentData } from '../model/attachments';
import type { SkeletonModel } from '../model/model';
import type { AtlasOutlines } from '../model/outlines';
import { type AttachmentLookup, createAttachmentLookup } from '../pose/shared/lookup';
import type { PoseState } from '../pose/state';
import { measureEntries } from './bounds';
import { ClipShape } from './clip-shape';
import { CoverTest } from './cover';
import { type CutChoice, CutState } from './cut-state';
import { placeEntry, tintEntry } from './entry-pose';
import { bendsEdges, drawsPlain } from './gate';
import { pageSources, vertexBuffer } from './pages';
import { DrawRanges } from './ranges';
import { u8 } from './read';
import { MAX_PAGES } from './shader';
import { createViewStats, type ViewStats } from './stats';
import { buildTemplate, showFrame, type Template, templateBytes } from './template';
import { VisibleList } from './visible';

export type { ViewStats } from './stats';

/**
 * How a view cuts overdraw. The cuts need outlines. The defaults are exact: the picture stays
 * the same. Polygons in place of quads are asked for with `tightMesh: 'on'`.
 */
export type SkeletonViewOptions = CutChoice;

/** A view looks at its page textures in one update of this many. A power of two. */
const PAGE_POLL = 64;

/** The deform of a slot that has none. */
const NO_DEFORM = new Float64Array(0);

/** The scratch arrays all views shape their clip polygons with. Created when a skeleton first clips. */
let clipShape: ClipShape | undefined;

/**
 * Draws one skeleton instance with Pixi from its pose, in mesh mode: one Pixi mesh per draw range,
 * all ranges on the same vertex buffers. A skeleton without multiply or screen slots and with up
 * to 8 atlas pages is one draw call.
 *
 * The vertex layout is stable. Every attachment a slot can show has its own vertex range, so
 * showing, hiding and reordering slots rewrites the index buffer only. Positions upload on every
 * update, colors when they change, texture coordinates when a sequence shows another region.
 *
 * A clipping attachment cuts the slots after it, by the rules of the official runtime of the
 * model's version. Those slots are draw ranges of their own behind a stencil mask that holds the
 * clip polygon. A clip costs two more draw calls and one small upload per update, and a skeleton
 * that shows no clipping attachment pays nothing. See {@link ViewStats.maskDraws}.
 *
 * With outlines the view cuts overdraw in two ways that leave the picture as it is. A slot that
 * lies inside the opaque rectangle of a later slot is left out of the index buffer. A region
 * attachment whose region shows no pixel has no vertex. With `tightMesh: 'on'` a region
 * attachment is drawn as the polygon around its visible pixels, which is not exact to the bit.
 * A child of {@link container} that draws nothing tells the view how Pixi is about to draw it,
 * see {@link beforeDraw}.
 *
 * The textures must hold premultiplied colors on the GPU. The view samples the whole source of
 * each texture.
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
    /** The outlines, the options and what Pixi did to the last draw. */
    private readonly cutState: CutState;
    /** Finds the slots a later slot covers. Its marks are all 0 while nothing is covered. */
    private readonly cover: CoverTest;
    /** The slots that are drawn, in draw order. The index buffers hold this list. */
    private readonly seen: VisibleList;
    /** The child that calls {@link beforeDraw}. It exists once the view cuts. */
    private probe: RenderContainer | undefined;
    /** The pose of the last update. */
    private last: PoseState | undefined;
    private template: Template;
    private boundsDirty = true;
    /** True when the alpha of a slot that can hide others changed since the covered slots were tested. */
    private recolored = true;
    /** True when the layout holds polygons or regions without a vertex: cuts that every draw makes. */
    private baked = false;
    /** Counts the updates between two looks at the page textures. */
    private polled = 0;
    private destroyed = false;

    /**
     * Lays out the vertex ranges for the default skin. Throws a `MarrowError` when the atlas
     * misses a region of an attachment, when a page has no texture, or when a texture is not
     * premultiplied.
     *
     * @param textures One texture per atlas page, in page order, premultiplied on the GPU.
     * @param options The outlines of the atlas, and which cuts to make with them.
     */
    constructor(
        model: SkeletonModel,
        atlas: AtlasModel,
        textures: readonly Texture[],
        options: SkeletonViewOptions = {},
    ) {
        const pages = pageSources(atlas, textures);

        this.model = model;
        this.atlas = atlas;
        this.lookup = createAttachmentLookup(model);
        this.dark = model.slots.hasDark.includes(1);
        this.cutState = new CutState(atlas, pages, options);
        this.cover = new CoverTest(model.slots.count);
        this.template = buildTemplate(model, atlas, this.lookup, -1, null, this.dark, this.cutState.take());
        this.seen = new VisibleList(model);
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
        this.baked = this.template.tightOffsets.length > 0 || this.template.hollow.includes(1);
        this.stats = createViewStats(this.template.vertexCount, templateBytes(this.template));
        this.watch();
    }

    /**
     * Brings the buffers in line with a pose. Call after the pose engine has updated. Allocates
     * nothing once every draw range the skeleton needs has been used.
     *
     * Throws a `MarrowError` for a pose of another model, after {@link destroy}, and for a
     * clipping attachment with fewer than three vertices, which it names.
     */
    update(state: PoseState): void {
        this.check(state);
        this.last = state;
        if (state.skin !== this.template.skin || this.outdated() || !this.seen.resolve(this.template, state)) {
            this.layout(state.skin, state.attachments);
            this.seen.reset();
            this.seen.resolve(this.template, state);
        }
        this.finish(state, this.seen.collect(this.template, state));
    }

    /**
     * Gives the view the outlines of its atlas, other ones, or none. The next update lays the
     * vertex ranges out again, once, and so does a draw that comes first. The picture stays
     * the same.
     *
     * @example
     * await asset.optimized;
     * view.setOutlines(asset.outlines);
     */
    setOutlines(outlines: AtlasOutlines | undefined): void {
        this.cutState.setOutlines(outlines);
    }

    /**
     * Checks what the pose does not say, right before Pixi draws the meshes. Pixi calls it
     * through a child of {@link container}, at the time it draws that child, when the alpha and
     * the blend mode of every ancestor are final for the frame.
     *
     * An alpha below 1 or a blend mode on an ancestor puts the covered slots back at once. Only
     * index data changes then, never the list of meshes, so it is in time for this draw. A
     * renderer that moves edges inside a pixel turns both cuts off for good: the vertex ranges are
     * laid out again as quads, for the pose of the last update.
     *
     * @param bends Whether the renderer rounds positions to pixels or draws to a multisampled target.
     *
     * @example
     * hero.alpha = 0.5;
     * view.beforeDraw(false);
     * console.log(view.stats.coveredSlots); // 0
     */
    beforeDraw(bends: boolean): void {
        const state = this.last;
        const { cutState, cover } = this;

        if (this.destroyed) return;
        if (bends) cutState.forbid();
        // nothing is drawn before the first update, which then lays the quads out
        if (state === undefined) return;
        // only a draw that skips a slot has to ask how Pixi blends it
        if (cover.covered > 0 && !drawsPlain(this.container) && cover.clear()) this.reindex(this.seen.count);
        // and only a draw that leaves something out has to look at the page textures
        const cuts = this.baked || cover.covered > 0;
        const outdated = cutState.changed || (cuts && cutState.pagesMoved());

        // a pose that moved on without an update keeps its buffers until that update
        if (outdated && this.seen.inStep(this.template, state)) this.redraw(state);
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
        this.seen.reset();
        this.last = undefined;
        this.stats.drawCalls = 0;
        this.stats.maskDraws = 0;
        this.stats.clips = 0;
        this.stats.indices = 0;
        this.stats.vertices = 0;
        this.stats.bufferBytes = 0;
        this.stats.tightRanges = 0;
        this.stats.coveredSlots = 0;
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

    /**
     * Whether the vertex ranges must be laid out again for other outlines or other page textures.
     * The textures are looked at in one update of {@link PAGE_POLL}. A draw that leaves something
     * out looks at them itself, so a texture that changed never reaches the screen with a cut.
     */
    private outdated(): boolean {
        if (this.cutState.changed) return true;
        this.polled = (this.polled + 1) & (PAGE_POLL - 1);

        return this.polled === 1 && this.cutState.pagesMoved();
    }

    /** Adds the child that calls {@link beforeDraw}, once the view cuts. It stays the first child. */
    private watch(): void {
        if (this.probe !== undefined || !this.cutState.wanted) return;
        this.probe = new RenderContainer({
            label: 'marrow-probe',
            render: (renderer) => this.beforeDraw(bendsEdges(renderer)),
        });
        this.container.addChildAt(this.probe, 0);
        this.ranges.lead = 1;
    }

    /** Lays the vertex ranges out for a skin and for what the slots show, with the cuts that hold now. */
    private layout(skin: number, shown: readonly (AttachmentData | null)[]): void {
        const { model, atlas, lookup, dark, cutState } = this;
        const template = buildTemplate(model, atlas, lookup, skin, shown, dark, cutState.take());

        this.template = template;
        this.baked = template.tightOffsets.length > 0 || template.hollow.includes(1);
        this.positions.data = template.positions;
        this.statics.data = template.statics;
        this.colors.data = template.colors;
        this.ranges.resize(template);
        this.cover.clear();
        this.seen.dirty = true;
        this.boundsDirty = true;
        this.stats.templateBuilds++;
        this.stats.vertices = template.vertexCount;
        this.watch();
    }

    /**
     * Lays the vertex ranges out again while Pixi draws. The visible slots, their order and their
     * clips stay, so the list of meshes stays. Only the data of the buffers changes.
     */
    private redraw(state: PoseState): void {
        const before = this.template;

        this.layout(before.skin, state.attachments);
        this.seen.carry(before, this.template, state);
        this.finish(state, this.seen.count);
    }

    /** What follows the list of visible entries: vertex data, covered slots, index buffers, clip masks. */
    private finish(state: PoseState, count: number): void {
        this.stats.clips = this.seen.applied;
        if (count > 0) this.pose(state, count);
        if (this.hide(state, count)) this.seen.dirty = true;
        if (this.seen.dirty) this.reindex(count);
        if (this.ranges.masks > 0) this.clip(state);
    }

    /** Positions, sequence frames and colors of the visible entries, then the uploads. */
    private pose(state: PoseState, count: number): void {
        const { template, stats } = this;
        const { bones, hasDark } = this.model.slots;
        const visible = this.seen.list;
        let colorsChanged = false;
        let uvsChanged = false;

        for (let i = 0; i < count; i++) {
            const entry = i32(visible, i);
            const slot = i32(template.slots, entry);

            // a hollow entry has no vertex to place or to color
            if (i32(template.counts, entry) === 0) continue;
            if (i32(template.frameCounts, entry) > 1 && this.sequence(state, entry, slot)) uvsChanged = true;
            placeEntry(template, state, bones, entry, slot);
            const alpha = u8(template.light, entry * 4 + 3);

            if (!tintEntry(template, state, hasDark, entry, slot)) continue;
            colorsChanged = true;
            // the alpha of a slot with an opaque rectangle decides whether it can hide others
            if (u8(template.light, entry * 4 + 3) !== alpha && i32(template.opaqueAt, entry) >= 0)
                this.recolored = true;
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
        if (Math.floor(i32(template.pages, entry) / MAX_PAGES) !== before) this.seen.dirty = true;

        return true;
    }

    /**
     * Marks the visible slots that a later opaque slot covers. Most frames have nothing to do
     * here: no slot is skipped and it is not the turn of a search, see `CoverTest`. Nothing is
     * covered while Pixi multiplies an alpha below 1 into the skeleton or blends it in another
     * mode than normal. Returns whether a mark changed.
     */
    private hide(state: PoseState, count: number): boolean {
        const { cover, template, seen } = this;
        // the slots that can hide others are chosen again when the list or their alpha changed
        const moved = seen.dirty || this.recolored;

        this.recolored = false;
        // a layout without an opaque rectangle has nothing to test with
        if (template.opaqueCount === 0 || !cover.begin(moved)) return false;
        let changed = false;

        if (drawsPlain(this.container)) {
            changed = cover.run(template, seen.list, seen.clips, count, state.world, this.model.slots.bones);
        } else {
            changed = cover.clear();
            cover.rest(false);
        }
        this.stats.coveredSlots = cover.covered;

        return changed;
    }

    /** Rewrites the index buffers for the visible entries. Vertex data stays where it is. */
    private reindex(count: number): void {
        const { ranges, stats, template, seen } = this;
        const visible = seen.list;
        let tight = 0;

        ranges.build(template, visible, seen.clips, this.cover.skipped, count);
        for (let i = 0; i < count; i++) {
            const entry = i32(visible, i);

            if (i32(template.tightAt, entry) >= 0 || u8(template.hollow, entry) === 1) tight++;
        }
        seen.dirty = false;
        stats.indexRebuilds++;
        stats.maskDraws = ranges.masks * 2;
        stats.drawCalls = ranges.active + stats.maskDraws;
        stats.indices = ranges.indices;
        stats.bufferBytes = templateBytes(template) + ranges.bytes;
        stats.tightRanges = tight;
        stats.coveredSlots = this.cover.covered;
    }

    /**
     * Moves the clip masks with their bones: shapes the polygon of each clipping attachment that
     * cuts a visible slot, as the official clipper does, and uploads it.
     */
    private clip(state: PoseState): void {
        const { ranges, stats, model } = this;

        clipShape ??= new ClipShape();
        for (let index = 0; index < ranges.masks; index++) {
            const slot = ranges.maskSlot(index);
            const attachment = this.seen.shown[slot];

            if (attachment?.type !== 'clipping') {
                throw new MarrowError(
                    'invalid-data',
                    `Slot ${slot} cuts other slots and shows no clipping attachment.`,
                    {
                        fix: 'Report this as a bug of pixi-marrow.',
                    },
                );
            }
            clipShape.compute(
                model.version,
                attachment,
                state.world,
                i16(model.slots.bones, slot),
                state.deform[slot] ?? NO_DEFORM,
                i32(state.deformLengths, slot),
            );
            if (ranges.placeMask(index, clipShape)) stats.maskRebuilds++;
            stats.maskUploads++;
        }
        // a mask grows when its slot shows a polygon with more vertices
        stats.bufferBytes = templateBytes(this.template) + ranges.bytes;
    }

    /**
     * The bounds of the visible slots. Pixi asks for them through the geometry of each mesh. They
     * are measured once after an update, and only when somebody asks.
     */
    private measure(): Bounds {
        const { bounds, last } = this;

        if (!this.boundsDirty) return bounds;
        this.boundsDirty = false;
        if (last === undefined) bounds.clear();
        else {
            const { list, count } = this.seen;

            measureEntries(bounds, this.template, list, count, last.world, this.model.slots.bones);
        }

        return bounds;
    }
}
