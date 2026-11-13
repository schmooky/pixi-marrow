import { attachCodeState } from '../render/attach-code';
import type { Link } from '../render/attach-work';
import { inspectView } from '../render/inspect';
import type { SkeletonView } from '../render/skeleton-view';
import { sharedBytes, textureBytes } from './memory';
import { buildReport } from './report';
import type { PerfEntry } from './report-base';
import type { PerfMemory, PerfOwner } from './spine-perf';

/*
 * What `perf.report()` and `perf.memory()` run. `MarrowPerf` loads this module with a dynamic
 * import, and nothing else imports it or the modules it brings: the rows of the report, the byte
 * counts and the code that describes a view. An app that never asks does not load them.
 */

/** The pacing of an owner that has none: every frame, on the screen. */
const NO_PACING = {
    rate: 'display',
    offscreen: 'update',
    hidden: false,
    size: Number.POSITIVE_INFINITY,
    physicsOff: false,
} as const;

/**
 * The rows of the perf report of a display object, read from it as it is now.
 *
 * @example
 * const { readReport } = await import('./perf-read');
 * console.table(readReport(spine, view));
 */
export function readReport(owner: PerfOwner, view: SkeletonView, links: readonly Link[] = []): PerfEntry[] {
    const { asset, engine, stats, physics } = owner;

    return buildReport({
        model: asset.model,
        atlas: asset.atlas,
        info: asset.info,
        outlines: asset.outlines,
        outlinesState: asset.outlinesState,
        state: engine.state,
        stats,
        view: inspectView(view),
        links,
        attachCode: attachCodeState(),
        physics,
        // the engine runs one update in mode reset, then the mode of the display object returns
        resetPending: engine.physics !== physics,
        perf: owner.perfSettings,
        pacing: owner.pacingStatus?.() ?? NO_PACING,
    });
}

/**
 * The bytes a display object and its asset hold, read from them as they are now.
 *
 * @example
 * const { readMemory } = await import('./perf-read');
 * console.log(readMemory(spine, view).instance);
 */
export function readMemory(owner: PerfOwner, view: SkeletonView): PerfMemory {
    const { asset, engine } = owner;
    const { arrayBytes, layoutBytes, gpuBytes } = inspectView(view);
    const gpuTextures = textureBytes(asset.textures);

    return {
        shared: sharedBytes(asset.model, asset.atlas, asset.outlines) + layoutBytes,
        instance: engine.bytes + arrayBytes,
        gpu: gpuBytes + gpuTextures,
        gpuBuffers: gpuBytes,
        gpuTextures,
    };
}
