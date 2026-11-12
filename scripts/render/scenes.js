/*
 * Browser part of scripts/check-render.mjs: scenes. A scene is a stage with several instances and
 * some other Pixi objects, described as plain data by scripts/render/scene-plan.mjs. The same
 * description is built once per side: with the official runtime, with ours in the mesh mode and
 * with ours in the batched mode. Every side gets the same updates and is drawn alone, and the
 * pictures are compared like the pictures of a single rig.
 *
 * A side has `root`, `home`, `place` and `stats`, like an instance of scripts/render/sides.js, so
 * the comparison and its second look treat a whole stage as they treat one instance.
 *
 * A scene can hold a tooling proof: one more side that is wrong on purpose and must be rejected.
 * `proof.swap` names two instances that change places in the draw order. `proof.hold` names a
 * step whose update the side leaves out, so that it shows the picture of the frame before: what
 * a view shows that skips work it had to do. `proof.misplace` names an object an instance holds
 * and another slot of the same bone: the side attaches the object there, so it is drawn at the
 * wrong place in the draw order.
 */
import { capture, captureSecond, judge } from './judge.js';
import { countModes, readMode } from './mode.js';
import { BACKGROUNDS } from './pixels.js';
import { chooseModes, probeModes } from './probe.js';
import { applyEvent, buildSide, destroySide, modeOf } from './scene-build.js';

const message = (error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

/**
 * The comparisons of one frame of a scene, like `PAIRS` of scripts/render/judge.js. `reference`
 * keeps a comparison for the scenes that are judged against that side.
 *
 * A scene with `reference: 'official'` judges each mode of ours against the official runtime and
 * measures the two modes against each other. A scene the official runtime cannot draw has
 * `reference: 'mesh'`: there the batched mode is judged against the mesh mode, as kind `own`.
 */
const SCENE_PAIRS = [
    { label: 'scene twice', a: 'twin', b: 'official', kind: 'exact', group: 'sceneTwice' },
    // on a page that runs on another pixi.js: the official runtime there against the reference
    { label: 'official, this pixi.js', a: 'official-here', b: 'official', kind: 'pixi', group: 'scenePixi' },
    { label: 'mesh', a: 'mesh', b: 'official', kind: 'match', group: 'sceneMesh' },
    { label: 'batched', a: 'batched', b: 'official', kind: 'match', group: 'sceneBatched' },
    { label: 'batched and mesh', a: 'batched', b: 'mesh', kind: 'modes', group: 'sceneModes', reference: 'official' },
    { label: 'batched against mesh', a: 'batched', b: 'mesh', kind: 'own', group: 'sceneOwn', reference: 'mesh' },
    { label: 'auto', a: 'auto', b: 'official', kind: 'match', group: 'sceneAuto', reference: 'official' },
    { label: 'auto against mesh', a: 'auto', b: 'mesh', kind: 'own', group: 'sceneAuto', reference: 'mesh' },
    { label: 'proof, official', a: 'wrong', b: 'official', kind: 'proof', rejectedBy: ['match'] },
    { label: 'proof, ours', a: 'mesh-wrong', b: 'official', kind: 'proof', rejectedBy: ['match'] },
    { label: 'proof, ours batched', a: 'batched-wrong', b: 'official', kind: 'proof', rejectedBy: ['match'] },
];

/** The labels of the three proof comparisons of a scene, by what its proof does. */
const PROOF_LABELS = {
    swap: [
        'proof, two instances swapped',
        'proof, ours with two instances swapped',
        'proof, ours batched with two instances swapped',
    ],
    hold: [
        'proof, a frame held back',
        'proof, ours with a frame held back',
        'proof, ours batched with a frame held back',
    ],
    misplace: [
        'proof, a container at another slot',
        'proof, ours with a container at another slot',
        'proof, ours batched with a container at another slot',
    ],
};

/** The comparisons of a frame of a scene: `SCENE_PAIRS` with the labels of the proof of the scene. */
function pairsOf(scene) {
    const labels = PROOF_LABELS[['hold', 'misplace'].find((kind) => scene.proof?.[kind]) ?? 'swap'];
    const proofs = SCENE_PAIRS.filter((pair) => pair.kind === 'proof');

    return SCENE_PAIRS.map((pair) => (pair.kind === 'proof' ? { ...pair, label: labels[proofs.indexOf(pair)] } : pair));
}

/** Adds the instruction builds of one render of a side to its counters. */
function countBuild(side, builds) {
    if (side.builds.first === null) side.builds.first = builds;
    else side.builds.later += builds;
    side.builds.renders++;
}

/**
 * The sides a scene is built for.
 *
 * Without ours the tooling proof runs alone: the official stage twice, and once made wrong. The
 * side `auto` has the default options. It is drawn at the first frame only: that says which mode
 * `auto` picks with this many instances, and that the pick draws. On a page that draws the
 * default options alone it stays for the whole scene.
 */
function sidesOf(scene, official, ours, run, officialHere = null) {
    const specs = [];
    const add = (key, runtime, mode, more = {}) => specs.push({ key, runtime, mode, ...more });

    if (official) add('official', official);
    // where `official` is the reference: the official runtime on the pixi.js of the page
    if (official && officialHere) add('official-here', officialHere);
    if (official && !ours) add('twin', official);
    if (official && scene.proof) add('wrong', official, undefined, { wrong: true });
    if (!ours) return specs;
    if (run.mesh || (run.batched && scene.reference === 'mesh')) add('mesh', ours, 'mesh');
    if (run.batched) add('batched', ours, 'batched');
    if (run.auto) add('auto', ours, 'auto', { once: run.mesh || run.batched, picks: Boolean(scene.lazy) });
    if (official && scene.proof && run.mesh) add('mesh-wrong', ours, 'mesh', { wrong: true });
    if (official && scene.proof && run.batched) add('batched-wrong', ours, 'batched', { wrong: true });

    return specs;
}

/**
 * How many instances of a side draw in each mode. Where the runtime has no `stats.renderMode`
 * the report row of the first instance stands for all of them.
 */
async function modesOfSide(side) {
    const spines = side.instances.map((instance) => instance.spine);
    const counts = countModes(spines);

    if (spines.length > 0 && counts.unknown === spines.length) {
        const { mode } = await readMode(spines[0]);

        if (mode) return { mesh: 0, batched: 0, unknown: 0, [mode]: spines.length, fromFirst: true };
    }

    return counts;
}

/**
 * The case that says which modes the instances of a scene drew in at its first frame. It is
 * information: an instance that asked for the batched mode may draw meshes, for example while a
 * clip cuts a visible slot. `askedMesh` counts the nodes that ask for the mesh mode by name.
 */
async function modeCase(sides, known) {
    const batched = sides.find((side) => side.key === 'batched');
    const auto = sides.find((side) => side.key === 'auto');
    const info = { known };

    if (!batched && !auto) return null;
    if (batched) {
        info.batched = await modesOfSide(batched);
        info.askedMesh = batched.instances.filter((instance) => modeOf(batched, instance.node) === 'mesh').length;
    }
    if (auto) info.auto = await modesOfSide(auto);

    return { label: 'render mode', kind: 'sceneMode', reasons: [], info };
}

/** The rows of the perf report that say what a rig brings to a scene, from one instance per rig. */
async function rowsCase(scene, sides) {
    const side = sides.find((entry) => entry.key === 'mesh') ?? sides.find((entry) => entry.key === 'batched');
    const wanted = ['drawCalls', 'blend', 'pages', 'clipping', 'darkTint'];
    const rigs = [];

    if (!side) return null;
    for (const [key, rig] of Object.entries(scene.rigs)) {
        const instance = side.instances.find((entry) => entry.node.rig === key);

        if (!instance) continue;
        try {
            const rows = (await instance.spine.perf.report()).filter((row) => wanted.includes(row.feature));

            rigs.push({ id: rig.id, rows: rows.map((row) => `${row.feature} ${row.value}`) });
        } catch (error) {
            rigs.push({ id: rig.id, rows: [`no report: ${message(error)}`] });
        }
    }

    return { label: 'what the rigs bring', kind: 'sceneRows', reasons: [], info: { side: side.key, rigs } };
}

/** The draw calls of the captured frames and the instruction builds of every side, as two cases. */
function countCases(scene, sides, options, counted) {
    const range = (values) => (values.length ? [Math.min(...values), Math.max(...values)] : null);
    const draws = {};
    const builds = {};
    const reasons = [];

    for (const side of sides) {
        if (side.wrong || side.key === 'twin') continue;
        draws[side.key] = range(side.draws);
        if (!side.once) builds[side.key] = { ...side.builds };
    }
    if (options.strictRebuilds && counted && scene.events.length === 0 && builds.batched?.later > 0) {
        reasons.push(
            `Pixi built instructions ${builds.batched.later} times for the batched side after its first frame`,
        );
    }

    return [
        { label: 'draw calls', kind: 'sceneDraws', reasons: [], info: draws },
        {
            label: 'instruction builds',
            kind: 'sceneBuilds',
            reasons,
            info: { counted, frames: scene.steps, changes: scene.events.length, sides: builds },
        },
    ];
}

/**
 * Which modes of ours a scene draws: asks the runtime with the first rig of the scene. A scene
 * about the lazy mesh mode asks nothing: an instance that asks for the mesh mode would load the
 * code the scene watches for.
 */
async function askModes(env, scene, studio, options, report) {
    if (scene.lazy) return { run: { mesh: false, batched: false, auto: true }, known: true };
    const [rig] = Object.values(scene.rigs);
    const url = (file) => `/fixtures/ours/${rig.version}/${file}`;
    const readings = await probeModes(env.ours, studio, {
        skeleton: url(rig.skel),
        atlas: url(rig.atlas),
        skin: rig.skin,
        animation: rig.animation,
        placement: { x: scene.size / 2, y: scene.size / 2, scale: 0.1 },
    });
    const { run, entry } = chooseModes(readings, options);

    // What one instance alone says is in the report of its rig. Here it counts when it is a
    // finding, or when the runtime reports no mode, which the summary says once
    if (entry.reasons.length > 0 || !entry.info.known) report.cases.push({ ...entry, scene: true });

    return { run, known: entry.info.known };
}

/** Draws every side of one frame, compares the captured ones and notes their draw calls. */
async function compareFrame(ctx, scene, sides, at) {
    const frames = new Map();

    for (const side of sides) {
        try {
            const frame = await capture(ctx.studio, side);

            frames.set(side.key, frame);
            side.draws.push(frame.solid.draws);
            side.builds.later += frame.clear.builds + frame.solid.builds;
        } catch (error) {
            ctx.report.cases.push({
                ...at,
                label: `${side.key} failed in render`,
                kind: 'error',
                reasons: [message(error)],
            });
        }
    }
    for (const pair of pairsOf(scene)) {
        const a = frames.get(pair.a);
        const b = frames.get(pair.b);
        const again = async () => ({
            a: await captureSecond(
                ctx.studio,
                sides.find((side) => side.key === pair.a),
            ),
            b: await captureSecond(
                ctx.studio,
                sides.find((side) => side.key === pair.b),
            ),
        });

        if (pair.reference && pair.reference !== scene.reference) continue;
        // a proof that holds a frame back is wrong at that frame alone
        if (pair.kind === 'proof' && scene.proof?.hold && scene.proof.hold.step !== at.step) continue;
        if (a && b) ctx.report.cases.push(await judge(ctx, at, pair, a, b, again));
    }
}

/**
 * The seconds the instances of a side advance at a step. Every side advances by the step of the
 * scene, and by nothing at the first frame. The wrong side of a proof that holds a frame back
 * leaves the update of that step out and makes up for it at the next one.
 */
function secondsOf(scene, side, step) {
    const held = side.wrong ? scene.proof.hold?.step : undefined;

    if (step === 0 || step === held) return 0;

    return step - 1 === held ? scene.dt * 2 : scene.dt;
}

/** How long a scene about the lazy mesh mode waits at its end for an instance that asked for it. */
const LAZY_WAIT = 2000;

/** The instances of a side that ask for the mesh mode: by a node, or by an event while the scene plays. */
function askingForMesh(scene, side) {
    const names = scene.events
        .filter((event) => event.op === 'mode' && event.mode === 'mesh')
        .map((event) => event.name);

    return side.instances.filter((instance) => instance.node.mode === 'mesh' || names.includes(instance.node.name));
}

/**
 * Notes the modes the instances with the default options drew in at one frame, and what the
 * report says about an instance that asks for the mesh mode and does not draw in it yet. Then
 * the page gets a turn of its event loop: a chunk that loads on demand arrives in such a turn.
 */
async function noteLazyFrame(scene, sides, lazy) {
    const side = sides.find((entry) => entry.key === 'auto');

    if (side) lazy.frames.push(countModes(side.instances.map((instance) => instance.spine)));
    // a scene whose rig `auto` draws with meshes follows its first instance, the others the ones that ask
    const followed = scene.lazy === 'first' ? side?.instances.slice(0, 1) : side && askingForMesh(scene, side);

    for (const instance of followed ?? []) {
        const { mode, reason } = await instance.mode();
        const said = `${mode ?? 'no mode'}: ${reason}`;

        // the report is noted when it says something new
        if (lazy.said.at(-1)?.text !== said) lazy.said.push({ frame: lazy.frames.length - 1, text: said });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The case of a scene about the lazy mesh mode, from the modes of its frames.
 *
 * `lazy: 'first'` is a rig that `auto` draws with meshes: its first frame must be drawn in the
 * mesh mode, so the code must be there when the asset has loaded. `lazy: 'switch'` asks an
 * instance for the mesh mode while the scene plays, and `lazy: 'create'` creates one that asks
 * for it without the load that waits for its code. Both draw in a batch until the code is
 * there. They must draw in every frame, which the comparisons with the official runtime show,
 * and they must arrive in the mesh mode: the scene waits a moment at its end for that.
 * `lazy: 'never'` needs no mesh mode. There the Node side looks at the requests of the page.
 */
async function lazyCase(scene, sides, lazy) {
    const side = sides.find((entry) => entry.key === 'auto');
    const reasons = [];
    const info = { lazy: scene.lazy, frames: lazy.frames, said: lazy.said, waited: 0 };
    const [first] = lazy.frames;

    if (!side || !first) {
        return { label: 'lazy mesh mode', kind: 'lazy', reasons: ['the default options did not draw'], info };
    }
    if (first.unknown > 0) info.silent = true;
    else if (scene.lazy === 'first' && first.batched > 0) {
        reasons.push(`${first.batched} of ${first.batched + first.mesh} instances drew their first frame in a batch`);
    } else if (scene.lazy === 'switch' || scene.lazy === 'create') {
        const asked = askingForMesh(scene, side);
        const started = performance.now();
        const waiting = () => asked.some((instance) => instance.stats()?.renderMode !== 'mesh');

        // an instance takes its new mode with an update, once the code of that mode is there
        while (waiting() && performance.now() - started < LAZY_WAIT) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            for (const instance of side.instances) instance.update(0);
        }
        info.waited = performance.now() - started;
        if (waiting()) {
            reasons.push(`an instance that asked for the mesh mode did not draw in it ${LAZY_WAIT} ms after the scene`);
        }
    }

    return { label: 'lazy mesh mode', kind: 'lazy', reasons, info };
}

/** Runs one scene. The result is plain data for the Node side, like the result of a rig. */
export async function runScene(env, scene, options) {
    const report = { cases: [], notes: [], missing: env.missing };
    // the render texture of ours, or of the official runtime where the tooling proof runs alone
    const studio = (env.ours ?? env.official).studio(scene.size);
    const ctx = {
        plan: { size: scene.size, additive: scene.additive, rig: scene.id },
        options,
        studio,
        report,
        shotsLeft: options.shots,
        sampled: false,
        clipped: false,
    };
    const official = scene.official ? env.official : null;
    const asked = env.ours
        ? await askModes(env, scene, studio, options, report)
        : { run: { mesh: false, batched: false, auto: false }, known: false };
    // where a frame is in the scene, for the lines of the report
    const at = (step) => ({ step, time: Math.round(step * scene.dt * 1000) / 1000 });
    // every side that was built, and the ones that are still on stage
    const built = [];
    // A scene about the lazy mesh mode: per frame how many instances drew in which mode, and what
    // the report said about the ones that ask for the mesh mode
    const lazy = { frames: [], said: [] };
    let sides = [];

    ctx.sampleLabel = env.ours ? (asked.run.mesh ? 'mesh' : 'batched') : 'scene twice';
    try {
        for (const spec of sidesOf(scene, official, env.ours, asked.run, env.officialHere)) {
            try {
                built.push(await buildSide(env, scene, spec));
            } catch (error) {
                report.cases.push({ label: `${spec.key} did not start`, kind: 'error', reasons: [message(error)] });
            }
        }
        sides = [...built];
        for (let step = 0; step < scene.steps; step++) {
            for (const side of [...sides]) {
                try {
                    for (const event of scene.events) {
                        if (event.step === step) await applyEvent(env, scene, side, event);
                    }
                    const seconds = secondsOf(scene, side, step);

                    if (seconds > 0) for (const instance of side.instances) instance.update(seconds);
                    // every frame is drawn, so the builds of the frames between two captures count too
                    countBuild(side, side.studio.draw(side.stage, BACKGROUNDS.solid).builds);
                } catch (error) {
                    // a side that throws leaves the stage. The others play on
                    report.cases.push({
                        ...at(step),
                        label: `${side.key} failed`,
                        kind: 'error',
                        reasons: [message(error)],
                    });
                    sides = sides.filter((entry) => entry !== side);
                }
            }
            const modes = step === 0 ? await modeCase(sides, asked.known) : null;

            if (modes) report.cases.push(modes);
            if (scene.lazy) await noteLazyFrame(scene, sides, lazy);
            if (scene.captures.includes(step)) {
                await compareFrame(ctx, scene, sides, at(step));
            }
            // the side with the default options has said what it picks, and has drawn it once
            for (const side of sides.filter((entry) => entry.once)) destroySide(side);
            sides = sides.filter((entry) => !entry.once);
        }
        if (env.ours) {
            const rows = await rowsCase(scene, sides);

            if (scene.lazy) report.cases.push(await lazyCase(scene, sides, lazy));
            if (rows) report.cases.push(rows);
            report.cases.push(...countCases(scene, built, options, studio.countsBuilds));
        }
    } catch (error) {
        report.cases.push({ label: 'the scene failed', kind: 'error', reasons: [message(error)] });
    } finally {
        for (const side of sides) {
            try {
                destroySide(side);
            } catch (error) {
                report.notes.push(`destroy failed: ${message(error)}`);
            }
        }
    }

    return report;
}
