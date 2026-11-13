import { Buffer, type Container, RenderContainer, type Renderer, VERSION } from 'pixi.js';
import { MarrowError } from '../base/errors';
import { i16, i32 } from '../geometry/read';
import type { SkeletonModel } from '../model/model';
import type { PoseState } from '../pose/state';
import { uploadStretch, uploadsStretch } from './batch-upload';
import { clipCode, clipCodeMissing } from './clip-code';
import { bendsEdges, type DrawGate } from './gate';
import type { MeshCode } from './mesh-code';
import { linkMeshPipe } from './mesh-pipe';
import { vertexBuffer } from './pages';
import { type PosePass, poseEntries } from './pose-pass';
import { DrawRanges, type DrawRangesOptions } from './ranges';
import { MeshSkin } from './skin-paint';
import type { ViewStats } from './stats';
import type { Template } from './template';
import { restoreColors } from './vertex-colors';
import type { VisibleList } from './visible';

/** The deform of a slot that has none. */
const NO_DEFORM = new Float64Array(0);

/** Whether this Pixi uploads a stretch of a buffer on its own. */
const RANGED = uploadsStretch(Buffer.prototype.update, VERSION);

/** What a {@link MeshPaint} is created with: what its draw ranges need, and the first vertex ranges. */
export interface MeshPaintOptions extends Omit<DrawRangesOptions, 'buffers' | 'blendModes' | 'shade'> {
    readonly template: Template;
    /** The skeleton: the bones and the blend modes of its slots. */
    readonly model: SkeletonModel;
    /** Whether the vertex shader places the vertices from the bones where it can: `skinning: 'gpu'`. */
    readonly gpu: boolean;
}

/**
 * What a view draws with in the mesh mode. These are three Pixi vertex buffers on the data of
 * its vertex ranges, the draw ranges with their meshes, and the child that asks the view before
 * every draw. A view creates it when it first draws in the mesh mode. So a view that only ever
 * batches has no buffer and no mesh of its own.
 *
 * With `gpu` the vertex shader places the vertices that hang on bones alone, see `skin-paint.ts`.
 * A palette then holds the colors, and there is no color buffer.
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

    constructor(options: MeshPaintOptions) {
        const { template, model, gpu, ...rest } = options;

        this.container = options.container;
        this.model = model;
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

    /** Points the buffers at the data of other vertex ranges and makes room for their indices. */
    resize(template: Template): void {
        this.positions.data = template.positions;
        this.statics.data = template.statics;
        if (this.colors !== undefined) this.colors.data = template.colors;
        this.skin?.resize(template);
        this.ranges.resize(template);
        // the bones and the palette of the view are data it holds, like its indices
        this.ranges.bytes += this.skinBytes;
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

        if (this.skin !== undefined) this.skin.pose(pass, template, state, seen);
        else {
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

    /** Adds the child that calls `beforeDraw` of a view, once. It stays the first child. */
    watch(gate: DrawGate): void {
        if (this.probe !== undefined) return;
        this.probe = new RenderContainer({
            label: 'marrow-probe',
            render: (renderer) => gate.beforeDraw(bendsEdges(renderer)),
        });
        this.container.addChildAt(this.probe, 0);
    }

    /**
     * Stops drawing while the view draws in a batch: every mesh and the probe are hidden. The
     * buffers and the meshes stay for the next time.
     */
    rest(template: Template, seen: VisibleList, skipped: Uint8Array): void {
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

    /** Frees the buffers, the meshes and the shaders. */
    destroy(): void {
        this.linked = null;
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
