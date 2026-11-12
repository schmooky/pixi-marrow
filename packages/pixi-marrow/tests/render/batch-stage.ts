import {
    type Batch,
    BatcherPipe,
    BlendModePipe,
    type Buffer,
    ColorMaskPipe,
    Container,
    CustomRenderPipe,
    type Geometry,
    type InstructionSet,
    type Renderer,
    RenderGroupPipe,
    RenderGroupSystem,
    type Shader,
    type TextureSource,
} from 'pixi.js';
import type { BatchBody } from '../../src/render/batch-body';
import type { BatchElement } from '../../src/render/batch-element';
import { MarrowBatcher } from '../../src/render/batcher';
import type { SkeletonView } from '../../src/render/skeleton-view';

/*
 * A renderer without a GPU for the tests of the batched mode. It runs the code of Pixi that
 * decides what a batch is: the render group system, which builds and runs the instructions of a
 * render group, and the batch pipe with its batchers. Only the last step is replaced. Where Pixi
 * would bind buffers and draw, an adaptor notes what it was told to draw.
 *
 * So a test sees what a browser would see: how many draw calls a frame takes, which indices and
 * textures each one has, what the buffers of the batch hold, and how often Pixi built the
 * instructions. The pixels are the business of the render check.
 */

/** One draw call a frame asked for. */
interface Draw {
    /** `batch` for a batch of the batch pipe, `mesh` for a mesh of the mesh mode. */
    kind: 'batch' | 'mesh';
    /** The first index and the index count. 0 for a mesh. */
    start: number;
    size: number;
    blendMode: string;
    /** The textures the draw samples, in the order of their numbers. */
    textures: TextureSource[];
    /** The batcher whose buffers the draw reads. Null for a mesh. */
    batcher: MarrowBatcher | null;
    /** Whether the draw bound the geometry and the shader of its batcher first. */
    starts: boolean;
}

/** What a stage counted. */
interface StageCounts {
    /** How often Pixi built the instructions of a render group. */
    builds: number;
    /** The draw calls of the last frame. */
    draws: Draw[];
}

/** A stage to draw without a GPU. */
export interface Stage {
    /** The root: put display objects below it. */
    root: Container;
    /** The renderer, as far as the code under test reads one. */
    renderer: Renderer;
    counts: StageCounts;
    /**
     * Renders one frame, as `renderer.render(root)` does.
     *
     * @param note False notes no draw call, so that the stage itself allocates nothing.
     */
    render(note?: boolean): void;
}

/** What a stage renders with. */
export interface StageOptions {
    /** Whether the renderer rounds positions to pixels. */
    roundPixels?: boolean;
    /** Whether the target it draws to is multisampled. */
    antialias?: boolean;
    /** The most textures a batch can hold. Default 16. */
    maxTextures?: number;
}

/** The render group system of Pixi, with its render method in reach. */
class StageSystem extends RenderGroupSystem {
    /** Updates the render groups below a container and runs their instructions. */
    draw(frame: { container: Container; transform: never }): void {
        this.render(frame);
    }
}

/**
 * Creates a stage. Its renderer has the pipes Pixi needs to collect containers, and none of the
 * batched mode: that pipe must arrive on its own.
 */
export function createStage(options: StageOptions = {}): Stage {
    const counts: StageCounts = { builds: 0, draws: [] };
    const root = new Container();
    let started = false;
    let noting = true;
    const pipes: Record<string, unknown> = {};
    const fake = {
        roundPixels: options.roundPixels ?? false,
        renderPipes: pipes,
        limits: { maxBatchableTextures: options.maxTextures ?? 16 },
        runners: { destroy: { add: () => undefined }, prerender: { add: () => undefined } },
        renderTarget: { renderTarget: { colorTextures: [{ antialias: options.antialias ?? false }] } },
        globalUniforms: { start: () => undefined, push: () => undefined, pop: () => undefined },
    };
    const renderer = fake as unknown as Renderer;
    const adaptor = {
        start(_pipe: BatcherPipe, _geometry: Geometry, _shader: Shader): void {
            started = true;
        },
        execute(_pipe: BatcherPipe, batch: Batch): void {
            if (!noting) return;
            counts.draws.push({
                kind: 'batch',
                start: batch.start,
                size: batch.size,
                blendMode: batch.blendMode,
                textures: batch.textures.textures.slice(0, batch.textures.count),
                batcher: batch.batcher instanceof MarrowBatcher ? batch.batcher : null,
                starts: started,
            });
            started = false;
        },
    };
    const batch = new BatcherPipe(renderer, adaptor);

    pipes.batch = batch;
    pipes.blendMode = new BlendModePipe(renderer);
    pipes.colorMask = new ColorMaskPipe(renderer);
    pipes.customRender = new CustomRenderPipe(renderer);
    pipes.renderGroup = new RenderGroupPipe(renderer);
    // the meshes of the mesh mode: each one is a draw call of its own
    pipes.mesh = {
        validateRenderable: () => false,
        updateRenderable: () => undefined,
        addRenderable(mesh: Container, instructionSet: InstructionSet): void {
            batch.break(instructionSet);
            instructionSet.add(mesh as never);
        },
        execute(mesh: Container): void {
            if (!mesh.isRenderable || !noting) return;
            counts.draws.push({
                kind: 'mesh',
                start: 0,
                size: 0,
                blendMode: mesh.groupBlendMode,
                textures: [],
                batcher: null,
                starts: true,
            });
        },
    };
    // a stencil mask, which the mesh mode clips with: its mesh draws before and after what it masks
    const maskDraw = { renderPipeId: 'stencilMask', canBundle: false };

    pipes.stencilMask = {
        push(_effect: unknown, _container: Container, instructionSet: InstructionSet): void {
            batch.break(instructionSet);
            instructionSet.add(maskDraw as never);
        },
        pop(_effect: unknown, _container: Container, instructionSet: InstructionSet): void {
            batch.break(instructionSet);
            instructionSet.add(maskDraw as never);
        },
        execute(): void {
            if (!noting) return;
            counts.draws.push({
                kind: 'mesh',
                start: 0,
                size: 0,
                blendMode: 'normal',
                textures: [],
                batcher: null,
                starts: true,
            });
        },
    };
    const system = new StageSystem(renderer);
    const build: unknown = Reflect.get(system, '_buildInstructions');

    if (typeof build !== 'function') throw new Error('this Pixi builds its instructions somewhere else');
    Reflect.set(system, '_buildInstructions', (...args: unknown[]): void => {
        counts.builds++;
        Reflect.apply(build, system, args);
    });
    const frame = { container: root, transform: undefined as never };

    root.enableRenderGroup();

    return {
        root,
        renderer,
        counts,
        render(note = true): void {
            noting = note;
            counts.draws.length = 0;
            system.draw(frame);
        },
    };
}

/** The display object of the batched mode below a view, or undefined while the view has none. */
export function bodyOf(view: SkeletonView): BatchBody | undefined {
    return view.parts.paints.body;
}

/** The batch element of a view. Throws for a view that never drew in the batched mode. */
export function elementOf(view: SkeletonView): BatchElement {
    const body = bodyOf(view);

    if (body === undefined) throw new Error('the view has no batch element');

    return body.element;
}

/** The batcher that holds the element of a view. Throws before Pixi built the instructions with it. */
export function batcherOf(view: SkeletonView): MarrowBatcher {
    const { home } = elementOf(view);

    if (!(home instanceof MarrowBatcher)) throw new Error('the view is in no batch');

    return home;
}

/** One vertex of a skeleton as the batch holds it. */
export interface BatchVertex {
    x: number;
    y: number;
    u: number;
    v: number;
    /** The light color, the tint and the dark color as 0xAABBGGRR. The dark color is 0 without dark colors. */
    light: number;
    tint: number;
    dark: number;
    /** The number of the texture in the batch, and the flags: 255 for additive and for rounding. */
    texture: number;
    additive: number;
    round: number;
}

/** Reads a vertex of a view from the buffers of its batch, by its number inside the skeleton. */
export function readVertex(view: SkeletonView, vertex: number): BatchVertex {
    const element = elementOf(view);
    const batcher = batcherOf(view);
    const at = element._attributeStart / 2 + vertex;
    const words = batcher.staticWords;
    const positions = batcher.attributeBuffer.float32View;
    const bytes = batcher.staticBytes;
    const flags = bytes[at * words + 4] ?? 0;

    return {
        x: positions[at * 2] ?? Number.NaN,
        y: positions[at * 2 + 1] ?? Number.NaN,
        u: batcher.statics[at * words] ?? Number.NaN,
        v: batcher.statics[at * words + 1] ?? Number.NaN,
        light: bytes[at * words + 2] ?? 0,
        tint: bytes[at * words + 3] ?? 0,
        dark: words > 5 ? (bytes[at * words + 5] ?? 0) : 0,
        texture: flags & 0xff,
        additive: (flags >> 8) & 0xff,
        round: (flags >> 16) & 0xff,
    };
}

/**
 * The indices a view draws, as vertex numbers inside the skeleton, run by run. A triangle
 * without area is left out: the batch fills the room of a skeleton with them.
 */
export function readRuns(view: SkeletonView): number[][] {
    const element = elementOf(view);
    const batcher = batcherOf(view);
    const first = element._attributeStart / 2;
    const runs: number[][] = [];
    let at = element._indexStart;

    for (let run = 0; run < element.runs; run++) {
        const end = at + (element.runSizes[run] ?? 0);
        const indices: number[] = [];

        for (; at < end; at += 3) {
            const [a = 0, b = 0, c = 0] = batcher.indexBuffer.subarray(at, at + 3);

            if (a !== b || b !== c) indices.push(a - first, b - first, c - first);
        }
        runs.push(indices);
    }

    return runs;
}

/** How often each buffer of a batcher was told to upload, and how many bytes. */
export interface UploadCounts {
    positions: number;
    statics: number;
    indices: number;
    /** The bytes of the uploads of the static data and of the indices. */
    staticBytes: number;
    indexBytes: number;
}

/** Counts the uploads of the buffers of a batcher from now on. */
export function watchUploads(batcher: MarrowBatcher): UploadCounts {
    const counts: UploadCounts = { positions: 0, statics: 0, indices: 0, staticBytes: 0, indexBytes: 0 };
    const [positions] = batcher.geometry.buffers;
    const watch = (buffer: Buffer | undefined, count: (bytes: number) => void): void => {
        if (buffer === undefined) return;
        const update = buffer.update.bind(buffer);

        buffer.update = (size?: number, offset?: number): void => {
            count(size ?? buffer.data.byteLength);
            update(size, offset);
        };
    };

    watch(positions, () => counts.positions++);
    watch(batcher.staticBuffer, (bytes) => {
        counts.statics++;
        counts.staticBytes += bytes;
    });
    watch(batcher.geometry.indexBuffer, (bytes) => {
        counts.indices++;
        counts.indexBytes += bytes;
    });

    return counts;
}
