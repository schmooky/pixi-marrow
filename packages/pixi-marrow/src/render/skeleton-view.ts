import { Bounds, Container, Texture } from 'pixi.js';
import { i32 } from '../geometry/read';
import type { AtlasModel } from '../model/atlas';
import type { AttachmentData } from '../model/attachments';
import type { SkeletonModel } from '../model/model';
import type { AtlasOutlines } from '../model/outlines';
import { type AttachmentLookup, createAttachmentLookup } from '../pose/shared/lookup';
import type { PoseState } from '../pose/state';
import { layoutSlots, type SlotLayout } from './batch-layout';
import { measureEntries } from './bounds';
import { batchClipper } from './clip-code';
import { restoreColors } from './colors';
import { CoverTest } from './cover';
import { type CutChoice, CutState } from './cut-state';
import { checkPose, placeEntry, showSequence, tintEntry } from './entry-pose';
import { type DrawGate, drawsPlain, type EdgeBend } from './gate';
import type { ViewParts } from './inspect';
import { releaseTemplate } from './layouts';
import { type ModeReason, modeFor, modeReason, type RenderMode } from './mode';
import { pageSources } from './pages';
import { ViewPaints } from './paints';
import { u8 } from './read';
import { createViewStats, type ViewStats } from './stats';
import { buildTemplate, type Template, templateBytes } from './template';
import { VisibleList } from './visible';

export type { ViewStats } from './stats';

/**
 * How a view draws and how it cuts overdraw. The cuts need outlines. The defaults are exact: the
 * picture stays the same. Polygons in place of quads are asked for with `tightMesh: 'on'`.
 */
export interface SkeletonViewOptions extends CutChoice {
    /**
     * `mesh` draws with meshes of the view, `batched` in the batches of its render group. `auto`
     * (the default) batches a small skeleton.
     */
    renderMode?: RenderMode | undefined;
}

/** A view looks at its page textures in one update of this many. A power of two. */
const PAGE_POLL = 64;

/**
 * Draws one skeleton instance with Pixi from its pose, in one of two modes.
 *
 * In the mesh mode the view has one Pixi mesh per draw range, all ranges on the same vertex
 * buffers. A skeleton without multiply or screen slots and with up to 8 atlas pages is one draw
 * call. In the batched mode the view writes its vertices into the batch of its render group, so
 * that skeletons next to each other share draw calls. See {@link SkeletonViewOptions.renderMode}.
 *
 * The vertex layout is stable. Every attachment a slot can show has its own vertex range, so
 * showing, hiding and reordering slots rewrites indices only. Positions are handed on with every
 * update, colors when they change, texture coordinates when a sequence shows another region.
 *
 * A clipping attachment cuts the slots after it, by the rules of the official runtime of the
 * model's version. In the mesh mode those slots are draw ranges behind a stencil mask that holds
 * the clip polygon: two more draw calls and one small upload per update. In the batched mode
 * their triangles are cut on the CPU and stay in the batch, see `batch-clip.ts`.
 *
 * With outlines the view cuts overdraw in two ways that leave the picture as it is. A slot that
 * lies inside the opaque rectangle of a later slot is left out of the index buffer. A region
 * attachment whose region shows no pixel has no vertex. With `tightMesh: 'on'` a region
 * attachment is drawn as the polygon around its visible pixels, which is not exact to the bit.
 * Pixi tells the view how it is about to draw it, see {@link beforeDraw}. In the mesh mode a
 * child of {@link container} that draws nothing does that, in the batched mode the pipe that
 * runs the batch.
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
export class SkeletonView implements DrawGate {
    /** The Pixi objects to put into the display list. */
    readonly container: Container;
    /** What the view did and what it holds. */
    readonly stats: ViewStats;
    /** The mode the view was asked for. Setting it takes effect with the next update. */
    renderMode: RenderMode;
    private readonly model: SkeletonModel;
    private readonly atlas: AtlasModel;
    private readonly lookup: AttachmentLookup;
    private readonly dark: boolean;
    private readonly bounds: Bounds = new Bounds();
    /** The outlines, the options and what Pixi did to the last draw. */
    private readonly cutState: CutState;
    /** Finds the slots a later slot covers. Its marks are all 0 while nothing is covered. */
    private readonly cover: CoverTest;
    /** The slots that are drawn, in draw order. The index buffers hold this list. */
    private readonly seen: VisibleList;
    /** What draws in each mode, and the mode that draws now. */
    private readonly paints: ViewPaints;
    /** Why the view draws in its mode. */
    private reason: ModeReason;
    /** Where the slots keep their vertices in a batch. */
    private slots: SlotLayout;
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
    /** True once a renderer could not batch the skeleton. */
    private refused = false;

    /**
     * Lays out the vertex ranges for the default skin. Throws a `MarrowError` when the atlas
     * misses a region of an attachment, when a page has no texture, or when a texture is not
     * premultiplied.
     *
     * @param textures One texture per atlas page, in page order, premultiplied on the GPU.
     * @param options The render mode, the outlines of the atlas, and which cuts to make with them.
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
        this.renderMode = options.renderMode ?? 'auto';
        // a batch needs no color per vertex. Which mode draws is known for sure with the first update
        this.template = this.build(-1, null, this.renderMode === 'mesh');
        this.slots = layoutSlots(this.template, model.slots.count);
        this.seen = new VisibleList(model);
        this.container = new Container({ label: 'marrow-skeleton' });
        this.reason = modeReason(this.renderMode, this.slots.plain, 0, false);
        const mode = modeFor(this.renderMode, this.reason);

        this.stats = createViewStats(this.template.vertexCount, templateBytes(this.template), mode);
        // the first update knows what the skeleton shows, and creates what draws in its mode
        this.paints = new ViewPaints(
            {
                container: this.container,
                gate: this,
                pages,
                texture: textures[0] ?? Texture.EMPTY,
                dark: this.dark,
                model,
                seen: this.seen,
                cover: this.cover,
                stats: this.stats,
                measure: () => this.measure(),
            },
            mode,
        );
        this.baked = this.template.tightOffsets.length > 0 || this.template.hollow.includes(1);
    }

    /**
     * Brings the buffers in line with a pose. Call after the pose engine has updated. Allocates
     * nothing once every draw range the skeleton needs has been used.
     *
     * Throws a `MarrowError` for a pose of another model, after {@link destroy}, and for a
     * clipping attachment with fewer than three vertices, which it names.
     */
    update(state: PoseState): void {
        checkPose(this.destroyed, state.model === this.model);
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
     * Checks what the pose does not say, right before Pixi draws the skeleton. Pixi calls it at
     * the time of the draw, when the alpha and the blend mode of every ancestor are final for
     * the frame. In the mesh mode a child of {@link container} calls it, in the batched mode the
     * pipe that runs the batch.
     *
     * An alpha below 1 or a blend mode on an ancestor puts the covered slots back at once. Only
     * index data changes then, never the list of meshes or the size of a batch, so it is in time
     * for this draw. A renderer that moves edges inside a pixel turns both cuts off for good: the
     * vertex ranges are laid out again as quads, for the pose of the last update.
     *
     * @param bends What the renderer does that moves edges: it rounds positions to pixels or draws
     * to a multisampled target. True when it does one of them, false when it does neither.
     *
     * @example
     * hero.alpha = 0.5;
     * view.beforeDraw(false);
     * console.log(view.stats.coveredSlots); // 0
     */
    beforeDraw(bends: EdgeBend | boolean): void {
        const state = this.last;
        const { cutState, cover } = this;

        if (this.destroyed) return;
        if (bends !== false) cutState.forbid(bends === true ? null : bends);
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

    /** Draws with meshes from now on: a renderer cannot sample the pages of a run in one batch. */
    refuseBatch(): void {
        this.refused = true;
        if (this.last !== undefined && !this.destroyed) this.update(this.last);
    }

    /** The state of the view as it is, for `inspectView`, which the perf report loads on demand. */
    get parts(): ViewParts {
        const { template, seen, cover, cutState, paints, reason, renderMode } = this;

        return { template, seen, cover, cutState, paints, reason, renderMode };
    }

    /** Frees the buffers, the meshes and the shaders. The textures belong to the caller. */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        releaseTemplate(this.template);
        this.paints.destroy();
        this.container.destroy({ children: true });
        this.seen.reset();
        this.last = undefined;
        const none = { drawCalls: 0, maskDraws: 0, clips: 0, indices: 0, vertices: 0, bufferBytes: 0 };

        Object.assign(this.stats, none, { tightRanges: 0, coveredSlots: 0 });
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

    /** Adds the child that calls {@link beforeDraw} in the mesh mode, once the view cuts. */
    private watch(): void {
        if (this.paints.mode === 'mesh' && this.cutState.wanted) this.paints.mesh?.watch(this);
    }

    /** Picks the mode for what the view shows now, and changes to it. */
    private choose(): void {
        // without the code that clips in a batch, a clip draws with meshes and a stencil mask
        const clipped = batchClipper() === undefined ? this.seen.clipped : 0;
        const reason = modeReason(this.renderMode, this.slots.plain, clipped, this.refused);
        const mode = modeFor(this.renderMode, reason);

        this.reason = reason;
        if (mode !== this.paints.mode || !this.paints.ready) this.enter(mode);
    }

    /** Starts to draw in a mode. Pixi builds the instructions of the render group again for it. */
    private enter(mode: ViewStats['renderMode']): void {
        if (mode === 'mesh') restoreColors(this.template);
        this.paints.enter(mode, this.template, this.slots);
        this.stats.renderMode = mode;
        this.seen.dirty = true;
        this.watch();
    }

    /** The vertex ranges for a skin and for what the slots show, with the cuts that hold now. */
    private build(skin: number, shown: readonly (AttachmentData | null)[] | null, colors: boolean): Template {
        const { model, atlas, lookup, dark, cutState } = this;

        return buildTemplate(model, atlas, lookup, skin, shown, dark, cutState.take(), colors);
    }

    /** Lays the vertex ranges out for a skin and for what the slots show, with the cuts that hold now. */
    private layout(skin: number, shown: readonly (AttachmentData | null)[]): void {
        const template = this.build(skin, shown, this.paints.mode === 'mesh');

        releaseTemplate(this.template);
        this.template = template;
        this.slots = layoutSlots(template, this.model.slots.count);
        this.baked = template.tightOffsets.length > 0 || template.hollow.includes(1);
        this.paints.relayout(template, this.slots);
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

    /** What follows the list of visible entries: the mode, vertex data, covered slots, indices, clip masks. */
    private finish(state: PoseState, count: number): void {
        this.stats.clips = this.seen.applied;
        this.choose();
        if (count > 0) this.pose(state, count);
        if (this.hide(state, count)) this.seen.dirty = true;
        if (this.seen.dirty) this.reindex(count);
        const { mesh, element, body } = this.paints;

        if (element !== undefined) {
            element.clip(state);
            body?.touch();
        } else if (mesh !== undefined && mesh.ranges.masks > 0) {
            mesh.clip(this.model, state, this.seen, this.stats);
            // a mask grows when its slot shows a polygon with more vertices
            this.stats.bufferBytes = templateBytes(this.template) + mesh.ranges.bytes;
        }
    }

    /** Positions, sequence frames and colors of the visible entries, then the uploads or the marks for the batch. */
    private pose(state: PoseState, count: number): void {
        const { template, stats } = this;
        const { bones, hasDark } = this.model.slots;
        const visible = this.seen.list;
        const { element } = this.paints;
        let colorsChanged = false;
        let uvsChanged = false;

        for (let i = 0; i < count; i++) {
            const entry = i32(visible, i);
            const slot = i32(template.slots, entry);

            // a hollow entry has no vertex to place or to color
            if (i32(template.counts, entry) === 0) continue;
            const moved = i32(template.frameCounts, entry) > 1 ? showSequence(template, state, entry, slot) : 0;

            if (moved > 0) {
                uvsChanged = true;
                element?.mark(entry);
                // a frame on a page of another group of 8 moves the entry to another draw range
                if (moved > 1) this.seen.dirty = true;
            }
            placeEntry(template, state, bones, entry, slot);
            const alpha = u8(template.light, entry * 4 + 3);

            if (!tintEntry(template, state, hasDark, entry, slot)) continue;
            colorsChanged = true;
            element?.mark(entry);
            // the alpha of a slot with an opaque rectangle decides whether it can hide others
            if (u8(template.light, entry * 4 + 3) !== alpha && i32(template.opaqueAt, entry) >= 0)
                this.recolored = true;
        }
        if (element === undefined) this.paints.mesh?.upload(colorsChanged, uvsChanged);
        else element.dirty = true;
        this.boundsDirty = true;
        stats.positionUploads++;
        if (uvsChanged) stats.uvUploads++;
        if (colorsChanged) stats.colorUploads++;
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

    /**
     * Brings the indices in line with the visible entries: the index buffers of the meshes are
     * rewritten, or the batch is told to rewrite its part. Vertex data stays where it is.
     */
    private reindex(count: number): void {
        const { stats, template, seen } = this;
        const visible = seen.list;
        const { skipped } = this.cover;
        const { element, mesh } = this.paints;
        let tight = 0;
        let indices = 0;

        for (let i = 0; i < count; i++) {
            const entry = i32(visible, i);

            if (i32(template.tightAt, entry) >= 0 || u8(template.hollow, entry) === 1) tight++;
            if (u8(skipped, i) === 0) indices += template.triangles[entry]?.length ?? 0;
        }
        if (element !== undefined) {
            const runs = element.plan();

            // a skeleton that shows nothing leaves the batch, so that it breaks no batch of others
            if (this.paints.body !== undefined) this.paints.body.visible = count > 0;
            stats.drawCalls = count > 0 ? runs : 0;
            stats.maskDraws = 0;
            stats.indices = indices;
            stats.bufferBytes = templateBytes(template) + element.bytes;
        } else if (mesh !== undefined) {
            const { ranges } = mesh;

            ranges.build(template, visible, seen.clips, skipped, count);
            stats.maskDraws = ranges.masks * 2;
            stats.drawCalls = ranges.active + stats.maskDraws;
            stats.indices = ranges.indices;
            stats.bufferBytes = templateBytes(template) + ranges.bytes;
        }
        seen.dirty = false;
        stats.indexRebuilds++;
        stats.tightRanges = tight;
        stats.coveredSlots = this.cover.covered;
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
