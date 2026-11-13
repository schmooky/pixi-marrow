import type { PacingStatus } from './pacing';
import type { ResolvedPerf } from './presets';
import type { PerfEntry } from './report-base';

/** The settings that differ from the preset or were given by name, as text. */
function settingsText(perf: ResolvedPerf): string {
    const rate = typeof perf.updateRate === 'number' ? `${perf.updateRate} a second` : perf.updateRate;
    const bake = Array.isArray(perf.bake) ? perf.bake.join(', ') : perf.bake;

    return `tightMesh ${perf.tightMesh}, skinning ${perf.skinning}, bake ${bake}, idleCache ${perf.idleCache}, offscreen ${perf.offscreen}, updateRate ${rate}, lod ${perf.lod}`;
}

/**
 * The row of the `perf` settings: the preset and the settings in effect.
 *
 * @example
 * const row = perfRow(resolvePerf('balanced'));
 */
export function perfRow(perf: ResolvedPerf): PerfEntry {
    const given = [...perf.given];
    const by = given.length === 0 ? '' : `. Given by name: ${given.join(', ')}`;

    return { feature: 'perf', value: perf.preset, reason: `${settingsText(perf)}${by}` };
}

/**
 * The row of the pacing: how often the pose is updated at the moment, and why.
 *
 * @example
 * const row = pacingRow(pacer.status(true));
 */
export function pacingRow(status: PacingStatus): PerfEntry {
    const size = Number.isFinite(status.size) ? `${Math.round(status.size)} pixels across` : 'not rendered yet';
    const physics = status.physicsOff ? ', physics left out while it is drawn this small' : '';

    if (status.hidden && status.offscreen === 'pause') {
        return {
            feature: 'pacing',
            value: 'paused',
            reason: `the skeleton is off the screen and offscreen is pause${physics}`,
        };
    }
    if (status.hidden && status.offscreen === 'throttle') {
        return {
            feature: 'pacing',
            value: '4 a second',
            reason: `the skeleton is off the screen and offscreen is throttle${physics}`,
        };
    }
    const value = status.rate === 'display' ? 'every frame' : `${status.rate} a second`;

    return { feature: 'pacing', value, reason: `updateRate ${status.rate}, ${size}${physics}` };
}
