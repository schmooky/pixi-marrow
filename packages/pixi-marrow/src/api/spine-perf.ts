import type { PhysicsMode, PoseEngine } from '../pose/engine';
import type { Link } from '../render/attach-work';
import type { SkeletonView } from '../render/skeleton-view';
import type { ViewStats } from '../render/stats';
import type { MarrowAsset } from './asset';
import type { PerfEntry } from './report-base';

/**
 * Bytes that one instance and its asset hold, as `perf.memory()` counts them. Only memory with a
 * known size is counted: typed arrays, GPU buffers and textures. JavaScript objects, strings and
 * plain arrays are not counted. Among them are names, track entries, listeners and Pixi meshes.
 */
export interface PerfMemory {
    /**
     * What the asset holds once, however many instances exist. These are the typed arrays of
     * the skeleton model and of the atlas, and the triangles that views share for the outlines.
     * The vertex layout of this instance counts here too: all instances that show the same skin
     * share it.
     *
     * Not counted: names, the polygons and rectangles of the outlines, which are plain arrays,
     * and what a pose engine derives from the model.
     */
    shared: number;
    /**
     * What this instance holds in typed arrays. First `engine.bytes`: the pose and what
     * constraints add to it. Then the arrays of the view: the vertex and index data, the clip
     * masks, the list of visible slots and the test of covered slots.
     *
     * Not counted: track entries and their handles, and the Pixi objects of the view.
     */
    instance: number;
    /** What is on the GPU: `gpuBuffers` plus `gpuTextures`. */
    gpu: number;
    /**
     * The vertex, index and clip mask buffers of this instance on the GPU. They hold a copy of
     * data that counts in `instance` too. A buffer keeps its size when its data shrinks. It is 0
     * once the instance was destroyed.
     */
    gpuBuffers: number;
    /**
     * The page textures on the GPU: width times height times 4 bytes for every mip level. All
     * instances of the asset share them, so they count once however many instances exist.
     *
     * A compressed texture takes less than is counted. The image a texture was made from is not counted.
     */
    gpuTextures: number;
}

/** What the perf tools read of the display object they belong to. */
export interface PerfOwner {
    readonly asset: MarrowAsset;
    readonly engine: PoseEngine;
    readonly stats: ViewStats;
    readonly physics: PhysicsMode;
}

/**
 * The perf tools of one display object: `hero.perf`. The object is made when it is first asked
 * for, so an instance that never asks pays nothing. The code that reads the instance loads with
 * the first call of {@link report} or {@link memory}. An app that never calls them does not load it.
 *
 * @example
 * console.table(await hero.perf.report());
 * const { shared, instance, gpu } = await hero.perf.memory();
 * console.log(`${shared + instance} bytes of arrays, ${gpu} bytes on the GPU`);
 */
export class MarrowPerf {
    private readonly owner: PerfOwner;
    private readonly view: SkeletonView;
    private readonly links: () => readonly Link[];

    /**
     * @param view The view that draws the display object.
     * @param links Hands out the containers that follow a bone or are attached to a slot at the moment.
     */
    constructor(owner: PerfOwner, view: SkeletonView, links: () => readonly Link[] = () => []) {
        this.owner = owner;
        this.view = view;
        this.links = links;
    }

    /**
     * Every decision the runtime made for this instance, with its reason and the counters behind
     * it, as plain objects. The rows come in a fixed order, one per feature.
     *
     * The instance is read when the promise resolves. The first call loads the code first, which
     * takes a moment: the rows then show the instance as its last update before that left it.
     *
     * @example
     * const rows = await hero.perf.report();
     * const tight = rows.find((row) => row.feature === 'tightMesh');
     * console.log(tight?.value, tight?.reason); // 'off' 'the page images are still being read for outlines'
     */
    async report(): Promise<PerfEntry[]> {
        const { readReport } = await import('./perf-read');

        return readReport(this.owner, this.view, this.links());
    }

    /**
     * The bytes this instance and its asset hold: shared per asset, per instance and on the GPU.
     * For `n` instances like this one the total is `shared + gpuTextures + n * (instance + gpuBuffers)`.
     * See {@link PerfMemory} for what each number counts. Like {@link report} it loads its code
     * with the first call and reads the instance when the promise resolves.
     *
     * @example
     * const memory = await hero.perf.memory();
     * console.log(memory.shared, memory.instance, memory.gpuBuffers, memory.gpuTextures);
     */
    async memory(): Promise<PerfMemory> {
        const { readMemory } = await import('./perf-read');

        return readMemory(this.owner, this.view);
    }
}
