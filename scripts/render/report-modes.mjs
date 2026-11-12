/**
 * The lines of the render check about render modes and scenes: which mode drew, how many draw
 * calls a scene took per side, and how often Pixi built the instructions of a render group again.
 */

const range = (pair) => (pair ? (pair[0] === pair[1] ? `${pair[0]}` : `${pair[0]} to ${pair[1]}`) : 'none');

/** What the page reads to learn the mode of an instance, for the line that says it found nothing. */
const SOURCES = 'stats.renderMode, then the row renderMode of perf.report()';

/** What the runtime said about its render modes for one rig, see scripts/render/probe.js. */
export function describeMode(info) {
    const { known, trusted, readings, drew = [] } = info;
    const name = (reading) => reading.mode ?? 'no mode';

    if (!known) {
        return trusted
            ? 'the runtime reports no render mode. The mode that was asked for is taken as the mode that drew (--trust-mode)'
            : `the runtime reports no render mode, so it has one render path and the batched comparisons did not run. The page reads ${SOURCES}`;
    }
    const why = (reading) => (reading.reason ? ` (${reading.reason})` : '');
    const moved = drew.filter((mode) => mode !== readings.auto.mode);

    return (
        `auto picked ${name(readings.auto)}${why(readings.auto)}. Asked for by name: mesh draws ${name(readings.mesh)}, ` +
        `batched draws ${name(readings.batched)}${readings.batched.mode === 'batched' ? '' : why(readings.batched)}` +
        `${moved.length ? `. While it played, auto also drew ${moved.join(' and ')}` : ''}`
    );
}

/** How many instances of a scene side drew in each mode. */
function modeCounts(counts) {
    const parts = [
        counts.batched ? `${counts.batched} batched` : '',
        counts.mesh ? `${counts.mesh} mesh` : '',
        counts.unknown ? `${counts.unknown} that report no mode` : '',
    ].filter(Boolean);

    return `${parts.join(', ') || 'no instance'}${counts.fromFirst ? ', as its first instance says' : ''}`;
}

/** Which modes the instances of a scene drew in. */
export function describeSceneMode(info) {
    const parts = [];

    if (info.batched) {
        const asked = info.askedMesh ? `, ${info.askedMesh} asked for mesh by name` : '';

        parts.push(`the batched side draws ${modeCounts(info.batched)}${asked}`);
    }
    if (info.auto) parts.push(`with the default options: ${modeCounts(info.auto)}`);
    if (!info.known) parts.push('the runtime reports no render mode');

    return parts.join('. ');
}

/** What the perf report says the rigs of a scene bring: draw ranges, blend modes, pages, clips, dark tint. */
export function describeSceneRows(info) {
    const rigs = info.rigs.map((rig) => `${rig.id}: ${rig.rows.join(', ')}`);

    return `one instance per rig on the ${info.side} side. ${rigs.join('. ')}`;
}

/** The draw calls of a scene per side, over its captured frames. */
export function describeSceneDraws(info) {
    return ['mesh', 'batched', 'auto', 'official']
        .filter((key) => info[key] !== undefined)
        .map((key) => `${key === 'auto' ? 'default options' : key} ${range(info[key])}`)
        .join(', ');
}

/** How often Pixi built the instructions of a scene again after its first frame, per side. */
export function describeSceneBuilds(info) {
    if (!info.counted) return 'not counted: this pixi.js has no _buildInstructions on its render group system';
    const sides = Object.entries(info.sides).map(([key, builds]) => `${key} ${builds.later}`);
    const changes = info.changes ? `, with ${info.changes} changes of the stage between them` : '';

    return `${info.frames} frames${changes}. Builds by Pixi after the first frame: ${sides.join(', ')}`;
}

/**
 * What the buffer checks of all rigs say about instruction builds, as one line per mode, and
 * which mode `auto` picked per rig. `add` takes the cases of one rig, `lines` returns the text.
 */
export function createModeSummary() {
    const picks = new Map();
    const builds = new Map();
    // true once a page found that the runtime reports no render mode, and whether that was trusted
    let silent = false;
    let trusted = false;

    return {
        add(rig, cases) {
            for (const entry of cases) {
                if (entry.kind === 'mode' && !entry.info.known) {
                    silent = true;
                    trusted = entry.info.trusted;
                } else if (entry.kind === 'mode' && !entry.scene) {
                    const pick = entry.info.readings.auto.mode ?? 'no mode';

                    picks.set(pick, [...(picks.get(pick) ?? []), rig.id]);
                }
                if (entry.kind !== 'steady' || typeof entry.info?.instructionBuilds !== 'number') continue;
                const mode = entry.label.endsWith('batched') ? 'batched' : 'mesh';
                const sum = builds.get(mode) ?? { animations: 0, rebuilt: 0, total: 0, most: 0, worst: '' };

                sum.animations++;
                sum.total += entry.info.instructionBuilds;
                if (entry.info.instructionBuilds > 0) sum.rebuilt++;
                if (entry.info.instructionBuilds > sum.most) {
                    sum.most = entry.info.instructionBuilds;
                    sum.worst = `${rig.id} ${entry.animation}`;
                }
                builds.set(mode, sum);
            }
        },
        lines() {
            const out = [];

            if (silent) out.push(`  ${'render mode'.padEnd(24)} ${describeMode({ known: false, trusted })}`);
            if (picks.size > 0) {
                const parts = [...picks].map(([pick, rigs]) => `${pick} for ${rigs.length} rigs`);

                out.push(`  ${'auto picked'.padEnd(24)} ${parts.join(', ')}`);
            }
            for (const [mode, sum] of builds) {
                const worst = sum.most > 0 ? `, most in ${sum.worst} with ${sum.most}` : '';

                out.push(
                    `  ${`instruction builds, ${mode}`.padEnd(24)} ${sum.total} while ${sum.animations} animations played 30 frames each, ` +
                        `${sum.rebuilt} animations with a build${worst}`,
                );
            }

            return out;
        },
    };
}
