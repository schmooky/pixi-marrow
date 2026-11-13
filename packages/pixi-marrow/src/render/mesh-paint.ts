import {
    type Bounds,
    Buffer,
    type Container,
    RenderContainer,
    type Renderer,
    type TextureSource,
    VERSION,
} from 'pixi.js';
import { MarrowError } from '../base/errors';
import { i16, i32 } from '../geometry/read';
import type { SkeletonModel } from '../model/model';
import { isNewer, type PoseState } from '../pose/state';
import { uploadStretch, uploadsStretch } from './batch-upload';
import { clipCode, clipCodeMissing } from './clip-code';
import { bendsEdges, type DrawGate } from './gate';
import { instanceBlock, instanceLayout } from './instance-layout';
import { InstancePaint, type InstanceWhy } from './instance-paint';
import type { MeshCode } from './mesh-code';
import { linkMeshPipe } from './mesh-pipe';
import { vertexBuffer } from './pages';
import { type PosePass, poseEntries } from './pose-pass';
import { DrawRanges, type DrawRangesOptions } from './ranges';
import { MeshSkin } from './skin-paint';
import type { ViewStats } from './stats';
import { type Template, templateBytes } from './template';
import { restoreColors } from './vertex-colors';
import type { VisibleList } from './visible';

/** The deform of a slot that has none. */
const NO_DEFORM = new Float64Array(0);

/** The covered slots of a build that draws nothing. */
const NO_SKIPS = new Uint8Array(0);

/** Whether this Pixi uploads a stretch of a buffer on its own. */
const RANGED = uploadsStretch(Buffer.prototype.update, VERSION);

/** What a {@link MeshPaint} is created with: what its draw ranges need, and the first vertex ranges. */
export interface MeshPaintOptions extends Omit<DrawRangesOptions, 'buffers' | 'blendModes' | 'shade'> {
    readonly template: Template;
    /** The skeleton: the bones and the blend modes of its slots. */
    readonly model: SkeletonModel;
    /** Whether the vertex shader places the vertices from the bones where it can: `skinning: 'gpu'`. */
    readonly gpu: boolean;
    /** Whether the view draws instanced where it can, with `gpu`: `instancing: 'auto'`. */
    readonly instancing: boolean;
    /** The view, which the pipe of instanced draws asks before every draw. */
    readonly gate: DrawGate;
}

/**
 * What a view draws with in the mesh mode. These are three Pixi vertex buffers on the data of
 * its vertex ranges, the draw ranges with their meshes, and the child that asks the view before
 * every draw. A view creates it when it first draws in the mesh mode. So a view that only ever
 * batches has no buffer and no mesh of its own.
 *
 * With `gpu` the vertex shader places the vertices that hang on bones alone, see `skin-paint.ts`.
 * A palette then holds the colors, and there is no color buffer. With `instancing` too, the view
 * draws instanced with the views around it in Pixi's render order where it can, see
 * `instance-pipe.ts`. Its meshes are hidden then, and it writes its pose into a pool.
 *
 * @example
 * const paint = new MeshPaint({ container, template, pages, dark, model, measure, gpu: false });
 * paint.pose(pass, template, state, seen);
 * paint.ranges.build(template, seen.list, seen.clips, cover.skipped, seen.count);
 */
export class MeshPaint {
    /** The draw calls: one Pixi mesh per range. */
    readonly ranges: DrawRanges;
    private readonly container: Container;
    private readonly model: SkeletonModel;
    private readonly positions: Buffer;
    private readonly statics: Buffer;
    private readonly colors: Buffer | undefined;
    /** What the vertex shader places the vertices from, with `gpu`. */
    private readonly skin: MeshSkin | undefined;
    /** The child that calls the view before every draw. It exists once the view cuts. */
    private probe: RenderContainer | undefined;
    /** The renderer that drew the paint last. It has a pipe for meshes and says when its context is lost. */
    private linked: Renderer | null = null;
    /** The instanced draw of the view, once it drew instanced. */
    private instance: InstancePaint | undefined;
    /** Why the view drew alone in its last update. */
    private blocked: InstanceWhy;
    private readonly instancing: boolean;
    private readonly gate: DrawGate;
    private readonly measure: () => Bounds;
    private readonly pages: readonly TextureSource[];
    private readonly dark: boolean;
    /** The bytes of the bone and palette textures that {@link ranges} counts. */
    private counted = 0;

    constructor(options: MeshPaintOptions) {
        const { template, model, gpu, instancing, gate, ...rest } = options;

        this.container = options.container;
        this.model = model;
        this.instancing = instancing;
        this.gate = gate;
        this.measure = rest.measure;
        this.pages = rest.pages;
        this.dark = rest.dark;
        this.blocked = gpu ? 'off' : 'cpu';
        // a template that a batch drew has no color per vertex, and only the CPU way needs one
        if (!gpu) restoreColors(template);
        // a renderer that was created before this code loaded may have no pipe for meshes
        this.container.onRender = (renderer): void => {
            if (renderer === this.linked) return;
            this.linked = renderer;
            linkMeshPipe(renderer);
        };
        this.positions = vertexBuffer(template.positions, 'marrow-positions');
        this.statics = vertexBuffer(template.statics, 'marrow-uvs');
        this.skin = gpu ? new MeshSkin(model, template, rest.pages, rest.dark) : undefined;
        this.colors = gpu ? undefined : vertexBuffer(template.colors, 'marrow-colors');
        this.ranges = new DrawRanges({
            ...rest,
            blendModes: model.slots.blendModes,
            buffers: { positions: this.positions, statics: this.statics, colors: this.colors, skin: this.skin?.buffer },
            shade: this.skin?.shade,
        });
        this.resize(template);
    }

    /** The bytes of the bone and palette textures, with `gpu`. */
    get skinBytes(): number {
        return this.skin?.bytes ?? 0;
    }

    /** Whether the vertex shader places the vertices from the bones where it can: `skinning: 'gpu'`. */
    get gpu(): boolean {
        return this.skin !== undefined;
    }

    /** The instanced draw of the view while it draws instanced. */
    get instanced(): InstancePaint | undefined {
        return this.instance?.slot === undefined ? undefined : this.instance;
    }

    /** Why the view draws alone, or null while it draws instanced. */
    get why(): InstanceWhy {
        return this.instanced === undefined ? this.blocked : null;
    }

    /** Points the buffers at the data of other vertex ranges and makes room for their indices. */
    resize(template: Template): void {
        // the slot belongs to a pool of the layout before. The next update takes one of the new layout
        this.leave();
        this.positions.data = template.positions;
        this.statics.data = template.statics;
        if (this.colors !== undefined) this.colors.data = template.colors;
        this.skin?.resize(template);
        this.ranges.resize(template);
        this.counted = 0;
        this.recount();
    }

    /** Counts the bones and the palette of the view in the bytes of its ranges: data it holds, like its indices. */
    private recount(): void {
        this.ranges.bytes += this.skinBytes - this.counted;
        this.counted = this.skinBytes;
    }

    /**
     * Brings the vertex data of the visible entries in line with a pose and uploads what changed.
     * That is the positions and the colors of the vertices it wrote, and the texture coordinates
     * when a sequence showed another region. A stretch uploads on its own where Pixi can do that,
     * see `uploadsStretch`. With `gpu` the bones and the palette go to the GPU, and the positions
     * only of what the CPU places.
     */
    pose(pass: PosePass, template: Template, state: PoseState, seen: VisibleList): void {
        const { bones, hasDark } = this.model.slots;
        const { skin } = this;

        if (skin !== undefined) {
            this.choose(pass, template, state, seen);
            skin.pose(pass, template, state, seen);
            const instance = this.instanced;

            // the pool holds what the shader reads, and uploads with the draw
            if (instance !== undefined) {
                if (pass.framed > 0) instance.reframe(template, seen);

                return;
            }
        } else {
            poseEntries(pass, template, state, bones, hasDark, seen, undefined);
            if (pass.colored > 0 && this.colors !== undefined) {
                uploadStretch(this.colors, RANGED, pass.colorFrom, pass.colorTo, template.hasDark ? 8 : 4);
            }
        }
        if (pass.placed > 0) uploadStretch(this.positions, RANGED, pass.from, pass.to, 8);
        if (pass.framed > 0) this.statics.update();
    }

    /**
     * Places on the CPU what the vertex shader places, for code that reads the positions of a
     * template: the bounds and the debug overlays. Does nothing without `gpu`, and when the
     * positions show the pose already.
     */
    settle(template: Template, state: PoseState, seen: VisibleList): void {
        this.skin?.settle(template, state, seen);
    }

    /**
     * Adds the child that calls `beforeDraw` of a view, once. It stays the first child. While the
     * view draws instanced it is hidden: the pipe of instanced draws asks the view.
     */
    watch(gate: DrawGate): void {
        if (this.probe !== undefined) return;
        this.probe = new RenderContainer({
            label: 'marrow-probe',
            render: (renderer) => gate.beforeDraw(bendsEdges(renderer)),
        });
        this.probe.visible = this.instanced === undefined;
        this.container.addChildAt(this.probe, 0);
    }

    /**
     * Brings the indices in line with the visible entries: the index buffers of the draw ranges,
     * or the entries a view that draws instanced shows. Notes the draw calls in the stats.
     *
     * @param indices The indices of the visible entries that no later slot covers.
     */
    reindex(template: Template, seen: VisibleList, skipped: Uint8Array, indices: number, stats: ViewStats): void {
        const { ranges } = this;
        const instance = this.instanced;

        if (instance !== undefined) {
            instance.show(template, seen, skipped);
            // the view is a part of one instanced draw, which it shares
            stats.maskDraws = 0;
            stats.drawCalls = seen.count > 0 ? 1 : 0;
            stats.indices = indices;
            stats.bufferBytes = templateBytes(template) + ranges.bytes + instance.bytes;

            return;
        }
        ranges.build(template, seen.list, seen.clips, skipped, seen.count, seen);
        stats.maskDraws = ranges.masks * 2;
        stats.drawCalls = ranges.active + stats.maskDraws;
        stats.indices = ranges.indices;
        stats.bufferBytes = templateBytes(template) + ranges.bytes;
    }

    /**
     * Stops drawing while the view draws in a batch: every mesh and the probe are hidden, and the
     * view draws instanced no more. The buffers and the meshes stay for the next time.
     */
    rest(template: Template, seen: VisibleList, skipped: Uint8Array): void {
        this.leave();
        this.ranges.build(template, seen.list, seen.clips, skipped, 0, seen);
        if (this.probe !== undefined) this.probe.visible = false;
    }

    /** Draws again after a rest: the buffers take the vertex ranges as they are now. */
    wake(template: Template): void {
        if (this.skin === undefined) restoreColors(template);
        this.resize(template);
        if (this.probe !== undefined) this.probe.visible = true;
    }

    /**
     * Moves the clip masks with their bones: shapes the polygon of each clipping attachment that
     * cuts a visible slot, as the official clipper does, and uploads it.
     */
    clip(model: SkeletonModel, state: PoseState, seen: VisibleList, stats: ViewStats): void {
        const { ranges } = this;
        const clipShape = clipCode()?.shape;

        // the code that shapes a polygon loads with an asset whose skeleton has a clipping attachment
        if (clipShape === undefined) throw clipCodeMissing();
        for (let index = 0; index < ranges.masks; index++) {
            const slot = ranges.maskSlot(index);
            const attachment = seen.shown[slot];

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
    }

    /**
     * Draws instanced or alone, for what the view shows now. A change hides one and shows the
     * other, and the next pass writes everything into the store it takes: Pixi builds the
     * instructions of the render group again for it. Instanced, a new draw order takes the index
     * buffer of that order.
     */
    private choose(pass: PosePass, template: Template, state: PoseState, seen: VisibleList): void {
        const why = this.blockOf(template, state, seen);
        const instance = this.instanced;

        this.blocked = why ?? this.blocked;
        if (instance !== undefined && why === null) {
            if (pass.all || isNewer(state.drawOrderStamp, pass.seen)) instance.follow(state);

            return;
        }
        if ((instance === undefined) === (why !== null)) return;
        pass.all = true;
        seen.dirty = true;
        if (why !== null) {
            this.leave();

            return;
        }
        const skin = this.skin;
        const shared = skin && instanceLayout(template, this.model, skin.skinLayout, this.pages.length);

        if (skin === undefined || shared === undefined) return;
        this.instance ??= this.createInstance();
        skin.use(this.instance.enter(shared, state.drawOrder));
        this.recount();
        // every mesh hides, and the probe: the pipe of instanced draws asks the view before each draw
        this.ranges.build(template, seen.list, seen.clips, NO_SKIPS, 0, seen);
        if (this.probe !== undefined) this.probe.visible = false;
    }

    /** Why the view must draw alone at the moment, or null when it can draw instanced. */
    private blockOf(template: Template, state: PoseState, seen: VisibleList): InstanceWhy {
        const { skin } = this;

        if (skin === undefined) return 'cpu';
        if (!this.instancing) return 'off';
        const block = instanceBlock(template, this.model, skin.skinLayout, this.pages.length);

        if (block !== null) return block;
        const shared = instanceLayout(template, this.model, skin.skinLayout, this.pages.length);

        if (seen.clipped > 0) return 'clip';
        if (seen.cutCount > 0) return 'attached';
        const { cpuAt } = shared.shape;

        // a deform the layout did not expect: the CPU places the mesh, and its slot has no texels for it
        for (let i = 0; i < seen.count; i++) {
            const entry = i32(seen.list, i);

            if (i32(cpuAt, entry) < 0 && i32(state.deformLengths, i32(template.slots, entry)) > 0) return 'deform';
        }

        return null;
    }

    /** Stops to draw instanced: the view writes into textures of its own and draws its meshes again. */
    private leave(): void {
        const { instance, skin } = this;

        if (instance?.slot === undefined || skin === undefined) return;
        instance.leave();
        skin.use(undefined);
        this.recount();
        // the vertex buffer of the view missed the sequences that showed other regions meanwhile
        this.statics.update();
        if (this.probe !== undefined) this.probe.visible = true;
    }

    /** The instanced draw of the view, with its body behind the meshes. */
    private createInstance(): InstancePaint {
        const instance = new InstancePaint(this.gate, this.measure, this.pages, this.dark);

        this.container.addChild(instance.body);

        return instance;
    }

    /** Frees the buffers, the meshes and the shaders, and gives the slot of an instanced draw back. */
    destroy(): void {
        this.linked = null;
        this.instance?.destroy();
        this.ranges.destroy();
        this.positions.destroy();
        this.statics.destroy();
        this.colors?.destroy();
        this.skin?.destroy();
    }
}

/**
 * The code of the mesh mode. `mesh-code.ts` hands it out once this module is loaded.
 *
 * @example
 * const { meshMode } = await import('./mesh-paint');
 * const paint = meshMode.createPaint({ container, template, pages, dark, model, measure, gpu: false });
 */
export const meshMode: MeshCode = {
    createPaint: (options: MeshPaintOptions): MeshPaint => new MeshPaint(options),
};
