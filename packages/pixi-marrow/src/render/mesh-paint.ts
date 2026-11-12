import { Buffer, type Container, RenderContainer, VERSION } from 'pixi.js';
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
import type { PosePass } from './pose-pass';
import { DrawRanges, type DrawRangesOptions } from './ranges';
import type { ViewStats } from './stats';
import type { Template } from './template';
import type { VisibleList } from './visible';

/** The deform of a slot that has none. */
const NO_DEFORM = new Float64Array(0);

/** Whether this Pixi uploads a stretch of a buffer on its own. */
const RANGED = uploadsStretch(Buffer.prototype.update, VERSION);

/** What a {@link MeshPaint} is created with: what its draw ranges need, and the first vertex ranges. */
export interface MeshPaintOptions extends Omit<DrawRangesOptions, 'buffers'> {
    readonly template: Template;
}

/**
 * What a view draws with in the mesh mode. These are three Pixi vertex buffers on the data of
 * its vertex ranges, the draw ranges with their meshes, and the child that asks the view before
 * every draw. A view creates it when it first draws in the mesh mode. So a view that only ever
 * batches has no buffer and no mesh of its own.
 *
 * @example
 * const paint = new MeshPaint({ container, template, pages, dark, blendModes, measure });
 * paint.upload(true, true);
 * paint.ranges.build(template, seen.list, seen.clips, cover.skipped, seen.count);
 */
export class MeshPaint {
    /** The draw calls: one Pixi mesh per range. */
    readonly ranges: DrawRanges;
    private readonly container: Container;
    private readonly positions: Buffer;
    private readonly statics: Buffer;
    private readonly colors: Buffer;
    /** The child that calls the view before every draw. It exists once the view cuts. */
    private probe: RenderContainer | undefined;

    constructor(options: MeshPaintOptions) {
        const { template, ...rest } = options;

        this.container = options.container;
        // a renderer that was created before this code loaded may have no pipe for meshes
        this.container.onRender = linkMeshPipe;
        this.positions = vertexBuffer(template.positions, 'marrow-positions');
        this.statics = vertexBuffer(template.statics, 'marrow-uvs');
        this.colors = vertexBuffer(template.colors, 'marrow-colors');
        this.ranges = new DrawRanges({
            ...rest,
            buffers: { positions: this.positions, statics: this.statics, colors: this.colors },
        });
        this.ranges.resize(template);
    }

    /** Points the buffers at the data of other vertex ranges and makes room for their indices. */
    resize(template: Template): void {
        this.positions.data = template.positions;
        this.statics.data = template.statics;
        this.colors.data = template.colors;
        this.ranges.resize(template);
    }

    /**
     * Uploads what a pass over the visible entries changed, and nothing else: the positions and
     * the colors of the vertices it wrote, and the texture coordinates when a sequence showed
     * another region. A stretch uploads on its own where Pixi can do that, see `uploadsStretch`.
     *
     * @param colorBytes The bytes of the colors of one vertex.
     */
    upload(pass: PosePass, colorBytes: number): void {
        if (pass.placed > 0) uploadStretch(this.positions, RANGED, pass.from, pass.to, 8);
        if (pass.colored > 0) uploadStretch(this.colors, RANGED, pass.colorFrom, pass.colorTo, colorBytes);
        if (pass.framed > 0) this.statics.update();
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
        this.ranges.destroy();
        this.positions.destroy();
        this.statics.destroy();
        this.colors.destroy();
    }
}

/**
 * The code of the mesh mode. `mesh-code.ts` hands it out once this module is loaded.
 *
 * @example
 * const { meshMode } = await import('./mesh-paint');
 * const paint = meshMode.createPaint({ container, template, pages, dark, blendModes, measure });
 */
export const meshMode: MeshCode = {
    createPaint: (options: MeshPaintOptions): MeshPaint => new MeshPaint(options),
};
