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
    // the code of the mesh mode may load on demand: the probe says how long that took
    const arrived = readings.mesh.waited ? `, ${Math.round(readings.mesh.waited)} ms after it was asked for` : '';

    return (
        `auto picked ${name(readings.auto)}${why(readings.auto)}. Asked for by name: mesh draws ${name(readings.mesh)}${arrived}, ` +
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

/** The line that says what a rig is and what it plays. */
export function describeRig(rig) {
    const plays = rig.sequences.map((s) => `${s.animation}${s.skin ? ` (${s.skin})` : ''}`).join(', ');
    const solves = [rig.physics && 'physics', rig.slider && 'slider'].filter(Boolean).join(' and ');

    return `${rig.id}  ${rig.size} px, scale ${rig.placement.scale}, ${solves ? `solves ${solves}, ` : ''}plays ${plays}`;
}

/** The line that says what a scene holds and what its pictures are judged against. */
export function describeScene(scene) {
    const rigs = Object.values(scene.rigs).map(
        (rig) => `${rig.id} plays ${rig.animation}${rig.skin ? ` (${rig.skin})` : ''}`,
    );
    const against = scene.official
        ? `against spine-pixi-v8 for Spine ${scene.official}`
        : `no official picture, ${scene.why}: the batched mode is judged against the mesh mode`;

    return `${scene.id}  ${scene.size} px, ${scene.title}. ${rigs.join(', ')}, ${against}`;
}

/**
 * The head of a renderer: its name, the GPU, and the versions of pixi.js the sides of a page run on.
 *
 * @param state `window.renderCheck` of the first page of the renderer.
 * @param versions The pixi.js the pages were bundled with: `page`, and `reference` for the
 * official runtime the pictures are judged by, or null where that is the pixi.js of the page.
 */
export function describeHead(renderer, state, versions) {
    const { page, reference } = versions;
    const sides = reference
        ? `pixi.js ${page} for pixi-marrow. The official runtime is judged on pixi.js ${reference}, ` +
          `the reference, and drawn on ${page} once more`
        : `pixi.js ${page} for pixi-marrow and for the official runtime`;

    return `${renderer}${state.gpu ? ` (${state.gpu})` : ''}, ${sides}`;
}

/**
 * What a page says against the head of its renderer, each as an error of the page: a pixi.js of
 * another version, or a runtime that does not run on the pixi.js of the page.
 *
 * @param pixi `window.renderCheck.pixi` of the page. A runtime the page did not load is null there.
 * @param versions What `describeHead` got.
 */
export function strayPixi(pixi, versions) {
    const errors = [];

    if (!pixi) return errors;
    if (pixi.version !== versions.page)
        errors.push(`the page runs on pixi.js ${pixi.version}, not on ${versions.page}`);
    if (pixi.reference && pixi.reference !== versions.reference) {
        errors.push(`the reference runs on pixi.js ${pixi.reference}, not on ${versions.reference}`);
    }
    // an official runtime was loaded, and the bundle has a reference for it that the page did not get
    if (versions.reference && pixi.official !== null && !pixi.reference) errors.push('the page has no reference');
    for (const side of ['ours', 'official']) {
        if (pixi[side] === false) errors.push(`${side} does not run on the pixi.js of the page`);
    }

    return errors;
}
