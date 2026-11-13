import { Bounds, Container, Texture } from 'pixi.js';
import { i32 } from '../geometry/read';
import type { AtlasModel } from '../model/atlas';
import type { AttachmentData } from '../model/attachments';
import type { SkeletonModel } from '../model/model';
import type { AtlasOutlines } from '../model/outlines';
import { type AttachmentLookup, createAttachmentLookup } from '../pose/shared/lookup';
import type { PoseState } from '../pose/state';
import type { ViewInserts } from './attach-work';
import { layoutSlots, type SlotLayout } from './batch-layout';
import { measureEntries } from './bounds';
import { clipCode, clipCodeMissing } from './clip-code';
import { restoreColors } from './colors';
import { CoverTest } from './cover';
import { type CutChoice, CutState } from './cut-state';
import { checkPose } from './entry-pose';
import { type DrawGate, drawsPlain, type EdgeBend } from './gate';
import type { ViewParts } from './inspect';
import { releaseTemplate } from './layouts';
import { meshCode, wantMeshCode } from './mesh-code';
import type { RenderMode } from './mode';
import { pageSources } from './pages';
import { ViewPaints } from './paints';
import { clipsMoved, createPosePass, notePass, type PosePass, poseEntries } from './pose-pass';
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
    /** `mesh` draws with meshes, `batched` in batches. `auto` batches a small skeleton. Batched until the mesh code loads. */
    renderMode?: RenderMode | undefined;
    /** `gpu` places the mesh-mode vertices in the vertex shader where it can. `cpu` and `auto` use the CPU. */
    skinning?: 'auto' | 'cpu' | 'gpu' | undefined;
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
 * showing, hiding and reordering slots rewrites indices only. Positions are handed on for the
 * slots that moved, colors when they change, texture coordinates when a sequence shows another region.
 *
 * A clipping attachment cuts the slots after it, by the rules of the official runtime of the
 * model's version. In the mesh mode those slots are draw ranges behind a stencil mask that holds
 * the clip polygon: two more draw calls, and one small upload when the polygon moved. In the
 * batched mode their triangles are cut on the CPU and stay in the batch, see `batch-clip.ts`.
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
    /** The containers that are attached between slots, once there is one. See `attach-work.ts`. */
    inserts: ViewInserts | undefined;
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
    /** The `renderMode` option. */
    private choice: RenderMode;
    /** Where the slots keep their vertices in a batch. */
    private slots: SlotLayout;
    /** The pose of the last update. */
    private last: PoseState | undefined;
    private template: Template;
    private boundsDirty = true;
    /** What the last pass over the visible entries did, and the version of the pose it drew. */
    private readonly pass: PosePass = createPosePass();
    /** True when the mode must be picked again: the option, the layout or what a renderer can batch changed. */
    private restyle = true;
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
        this.choice = options.renderMode ?? 'auto';
        // a batch needs no color per vertex. Which mode draws is known for sure with the first update
        this.template = this.build(-1, null, false);
        this.slots = layoutSlots(this.template, model.slots.count);
        this.seen = new VisibleList(model);
        this.container = new Container({ label: 'marrow-skeleton' });
        this.stats = createViewStats(this.template.vertexCount, templateBytes(this.template));
        // the first update knows what the skeleton shows, and creates what draws in its mode
        this.paints = new ViewPaints({
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
        });
        this.stats.renderMode = this.paints.pick(this.choice, this.slots.plain, false) ?? 'batched';
        // a view that is made for the mesh mode asks for its code, also after a load that failed
        if (this.paints.waits) wantMeshCode();
        this.baked = this.template.tightOffsets.length > 0 || this.template.hollow.includes(1);
    }

    /**
     * The `renderMode` option. Setting it takes effect with the next update. The mesh mode
     * draws once its code is loaded, which setting `mesh` asks for.
     */
    get renderMode(): RenderMode {
        return this.choice;
    }

    set renderMode(mode: RenderMode) {
        this.choice = mode;
        this.restyle = true;
        if (mode === 'mesh') wantMeshCode();
    }

    /**
     * Brings the buffers in line with a pose. Call after the pose engine has updated. Allocates
     * nothing once every draw range the skeleton needs has been used.
     *
     * The view does the work the stamps of the pose ask for, see `pose-pass.ts`. A pose with the
     * version the view drew last asks for none, and the update returns at once. It does not when
     * the outlines or the mode of the view changed, or a search for covered slots is owed.
     *
     * Throws a `MarrowError` for a pose of another model, after {@link destroy}, and for a
     * clipping attachment with fewer than three vertices, which it names.
     */
    update(state: PoseState): void {
        checkPose(this.destroyed, state.model === this.model);
        const { pass, paints, seen } = this;
        const stale = this.outdated() || state.skin !== this.template.skin;
        const same = state === this.last && state.version === pass.seen && !pass.all;
        const arrived = paints.waits && meshCode() !== undefined;

        if (same && !stale && !this.restyle && !this.cover.owes && !arrived) {
            this.stats.skips++;
            pass.skipped = true;

            return;
        }
        if (state !== this.last) pass.all = true;
        this.last = state;
        // what is visible can change with the draw order, an attachment or an alpha, not with a bone that moves
        let listed = pass.all || (!same && seen.relists(this.template, state, pass.seen));

        if (stale || (listed && !seen.resolve(this.template, state))) {
            this.layout(state.skin, state.attachments);
            seen.reset();
            seen.resolve(this.template, state);
            listed = true;
        }
        this.finish(state, listed ? seen.collect(this.template, state) : seen.count, listed);
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

    /** Draws with meshes from now on, and nothing until their code is loaded: a renderer cannot batch the skeleton. */
    refuseBatch(): void {
        this.refused = true;
        this.restyle = true;
        this.seen.dirty = true;
        wantMeshCode();
        if (this.last !== undefined && !this.destroyed) this.update(this.last);
    }

    /** The state of the view as it is, for `inspectView`, which the perf report loads on demand. */
    get parts(): ViewParts {
        const { template, seen, cover, cutState, paints, choice, refused, pass, last } = this;

        return { template, seen, cover, cutState, paints, renderMode: choice, refused, pass, pose: last };
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
        const mode = this.paints.pick(this.choice, this.slots.plain, this.refused);

        this.restyle = false;
        if (mode !== undefined) this.enter(mode);
    }

    /** Starts to draw in a mode. Pixi builds the instructions of the render group again for it. */
    private enter(mode: ViewStats['renderMode']): void {
        if (mode === 'mesh') restoreColors(this.template);
        this.paints.enter(mode, this.template, this.slots);
        this.stats.renderMode = mode;
        // what draws in the mode holds nothing of the pose yet
        this.pass.all = true;
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
        // new vertex ranges hold no pose, and can have another count for `auto`
        this.pass.all = true;
        this.restyle = true;
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
        this.finish(state, this.seen.count, true);
    }

    /**
     * What follows the list of visible entries: the mode, the vertex data of what changed, covered
     * slots, indices and clips.
     *
     * @param listed Whether the list was made again for this pose.
     */
    private finish(state: PoseState, count: number, listed: boolean): void {
        const { pass, seen, stats, template, cover } = this;
        const { bones, hasDark } = this.model.slots;

        if (listed) this.inserts?.cut(seen, template, state);
        // the code that clips loads with an asset whose skeleton has a clipping attachment
        if (seen.clipped > 0 && clipCode() === undefined) throw clipCodeMissing();
        stats.clips = seen.applied;
        this.choose();
        const { mesh, element } = this.paints;

        poseEntries(pass, template, state, bones, hasDark, seen, element);
        if (element === undefined) mesh?.upload(pass, template.hasDark ? 8 : 4);
        notePass(stats, pass);
        const moved = pass.placed > 0 || listed;

        if (moved) this.boundsDirty = true;
        // a sequence on a page of another group of 8 moves its entry to another draw range
        if (pass.regrouped) seen.dirty = true;
        // the slots that can hide others are chosen again when the list or their alpha changed
        const relisted = seen.dirty || pass.recolored || pass.all;

        if (cover.follow(template, seen, state.world, bones, this.container, moved, relisted)) seen.dirty = true;
        stats.coveredSlots = cover.covered;
        const indexed = seen.dirty;

        if (indexed) this.reindex(count);
        this.clip(state, indexed);
        pass.before = pass.seen;
        pass.seen = state.version;
        pass.all = false;
        pass.skipped = false;
    }

    /** Shapes the mask of a clip again when its polygon moved or the list changed, see `pose-pass.ts`. */
    private clip(state: PoseState, indexed: boolean): void {
        const { pass, seen, stats } = this;
        const { mesh, element, body } = this.paints;
        const shaped =
            seen.clipped > 0 && (indexed || pass.all || clipsMoved(state, seen, this.model.slots.bones, pass.seen));

        if (element !== undefined) {
            // a batch holds cut triangles: they are cut again then, and when a slot inside a clip was placed
            if (shaped || pass.cut) clipCode()?.pose(element, state);
            if (element.dirty) body?.touch();
        } else if (shaped && mesh !== undefined && mesh.ranges.masks > 0) {
            mesh.clip(this.model, state, seen, stats);
            // a mask grows when its slot shows a polygon with more vertices
            stats.bufferBytes = templateBytes(this.template) + mesh.ranges.bytes;
        }
    }

    /** Brings the indices in line with the visible entries, in the meshes or in the batch. Vertex data stays where it is. */
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
            // A skeleton that shows nothing leaves the batch, so that it breaks no batch of others.
            // One that no renderer can batch draws nothing while it waits for the code of the mesh mode
            const shows = count > 0 && !(this.refused && this.paints.waits);

            if (this.paints.body !== undefined) this.paints.body.visible = shows;
            stats.drawCalls = shows ? runs : 0;
            stats.maskDraws = 0;
            stats.indices = indices;
            stats.bufferBytes = templateBytes(template) + element.bytes;
        } else if (mesh !== undefined) {
            const { ranges } = mesh;

            ranges.build(template, visible, seen.clips, skipped, count, seen);
            stats.maskDraws = ranges.masks * 2;
            stats.drawCalls = ranges.active + stats.maskDraws;
            stats.indices = ranges.indices;
            stats.bufferBytes = templateBytes(template) + ranges.bytes;
        }
        seen.dirty = false;
        this.inserts?.place(this.paints, this.container);
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
