import type { PoseSource } from '../pose/engine';
import { attachCodeState } from '../render/attach-code';
import type { Link } from '../render/attach-work';
import { inspectView } from '../render/inspect';
import type { SkeletonView } from '../render/skeleton-view';
import { sharedBytes, textureBytes } from './memory';
import { buildReport } from './report';
import type { BakeReading, PerfEntry } from './report-base';
import type { PerfMemory, PerfOwner } from './spine-perf';

/*
 * What `perf.report()` and `perf.memory()` run. `MarrowPerf` loads this module with a dynamic
 * import, and nothing else imports it or the modules it brings: the rows of the report, the byte
 * counts and the code that describes a view. An app that never asks does not load them.
 */

/** What the source of baked playback says of itself, read by shape: its code is a chunk of its own. */
function readBake(source: PoseSource | null): BakeReading | null {
    if (source === null || !('baked' in source && 'unbaked' in source && 'last' in source && 'bytes' in source)) {
        return null;
    }
    const { baked, unbaked, last, bytes } = source;

    return { baked: Number(baked), unbaked: Number(unbaked), last: String(last), bytes: Number(bytes) };
}

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
        bake: readBake(engine.source),
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
        // the baked clips of the asset, which its instances share
        shared:
            sharedBytes(asset.model, asset.atlas, asset.outlines) + layoutBytes + (readBake(engine.source)?.bytes ?? 0),
        instance: engine.bytes + arrayBytes,
        gpu: gpuBytes + gpuTextures,
        gpuBuffers: gpuBytes,
        gpuTextures,
    };
}
