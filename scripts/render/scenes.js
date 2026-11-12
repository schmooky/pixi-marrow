/*
 * Browser part of scripts/check-render.mjs: scenes. A scene is a stage with several instances and
 * some other Pixi objects, described as plain data by scripts/render/scene-plan.mjs. The same
 * description is built once per side: with the official runtime, with ours in the mesh mode and
 * with ours in the batched mode. Every side gets the same updates and is drawn alone, and the
 * pictures are compared like the pictures of a single rig.
 *
 * A side has `root`, `home`, `place` and `stats`, like an instance of scripts/render/sides.js, so
 * the comparison and its second look treat a whole stage as they treat one instance.
 */
import { capture, captureSecond, judge } from './judge.js';
import { countModes, readMode } from './mode.js';
import { BACKGROUNDS, createStudio } from './pixels.js';
import { chooseModes, probeModes } from './probe.js';

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
    { label: 'mesh', a: 'mesh', b: 'official', kind: 'match', group: 'sceneMesh' },
    { label: 'batched', a: 'batched', b: 'official', kind: 'match', group: 'sceneBatched' },
    { label: 'batched and mesh', a: 'batched', b: 'mesh', kind: 'modes', group: 'sceneModes', reference: 'official' },
    { label: 'batched against mesh', a: 'batched', b: 'mesh', kind: 'own', group: 'sceneOwn', reference: 'mesh' },
    { label: 'auto', a: 'auto', b: 'official', kind: 'match', group: 'sceneAuto', reference: 'official' },
    { label: 'auto against mesh', a: 'auto', b: 'mesh', kind: 'own', group: 'sceneAuto', reference: 'mesh' },
    { label: 'proof, two instances swapped', a: 'swapped', b: 'official', kind: 'proof', rejectedBy: ['match'] },
    {
        label: 'proof, ours with two instances swapped',
        a: 'mesh-swapped',
        b: 'official',
        kind: 'proof',
        rejectedBy: ['match'],
    },
    {
        label: 'proof, ours batched with two instances swapped',
        a: 'batched-swapped',
        b: 'official',
        kind: 'proof',
        rejectedBy: ['match'],
    },
];

/** A container for a group node: its transform, alpha, tint, filter and whether it is a render group. */
function makeGroup(PIXI, scene, node) {
    const group = new PIXI.Container(node.renderGroup ? { isRenderGroup: true } : {});

    group.position.set(node.x ?? 0, node.y ?? 0);
    group.scale.set(node.scale ?? 1);
    group.rotation = node.rotation ?? 0;
    if (node.alpha !== undefined) group.alpha = node.alpha;
    if (node.tint !== undefined) group.tint = node.tint;
    if (node.filter) {
        group.filters = [new PIXI.AlphaFilter({ alpha: node.filter.alpha })];
        // the area is given, so the bounds of a runtime do not decide how large the filter texture is
        group.filterArea = new PIXI.Rectangle(0, 0, scene.size, scene.size);
    }

    return group;
}

/** A Pixi object that is no instance: a rectangle drawn by a graphics object, or a tinted sprite. */
function makeShape(PIXI, node) {
    if (node.type === 'graphics') {
        return new PIXI.Graphics()
            .rect(node.x, node.y, node.width, node.height)
            .fill({ color: node.color, alpha: node.alpha });
    }
    const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);

    sprite.position.set(node.x, node.y);
    sprite.width = node.width;
    sprite.height = node.height;
    sprite.rotation = node.rotation ?? 0;
    sprite.tint = node.color;
    sprite.alpha = node.alpha;

    return sprite;
}

/** The render mode an instance of a side asks for. Only the batched side lets a node pick its own. */
const modeOf = (side, node) => (side.mode === 'batched' ? (node.mode ?? 'batched') : side.mode);

/** Creates the instance of a node, plays its animation and moves it to its place in time. */
async function makeInstance(scene, side, node) {
    const rig = scene.rigs[node.rig];
    const url = (file) => `/fixtures/${side.runtime.name}/${rig.version}/${file}`;
    const instance = await side.runtime.create({
        skeleton: url(rig.skel),
        atlas: url(rig.atlas),
        mode: modeOf(side, node),
    });

    side.instances.push(instance);
    side.named.set(node.name, instance);
    instance.node = node;
    if (rig.skin) instance.setSkin(rig.skin);
    instance.place(node);
    instance.play(rig.animation);
    // every instance at another time of its animation
    instance.update(node.time ?? 0);
    if (node.visible === false) instance.view.visible = false;
    if (node.renderable === false) instance.view.renderable = false;

    return instance.view;
}

/**
 * Builds a node and what is below it, and adds it to a parent.
 *
 * @param index Where in the child list of the parent it goes. Without it the node goes to the end.
 */
async function addNode(env, scene, side, node, parent, index) {
    const { PIXI } = env;
    let object;

    if (node.type === 'spine') object = await makeInstance(scene, side, node);
    else if (node.type === 'group') {
        object = makeGroup(PIXI, scene, node);
        for (const child of node.children) await addNode(env, scene, side, child, object);
        if (node.mask) {
            const mask = new PIXI.Graphics().circle(...node.mask.circle).fill(0xffffff);

            object.addChild(mask);
            object.mask = mask;
        }
    } else object = makeShape(PIXI, node);
    if (index === undefined) parent.addChild(object);
    else parent.addChildAt(object, index);
}

/**
 * One side of a scene: a stage of its own with every node of the scene.
 *
 * @param spec.key The name of the side. `spec.runtime` is the official side or ours, and
 * `spec.mode` the render mode its instances ask for. `spec.swapped` builds the tooling proof: two
 * instances change places in the child list.
 */
async function buildSide(env, scene, spec) {
    const stage = new env.PIXI.Container();
    const side = {
        ...spec,
        root: stage,
        stage,
        instances: [],
        named: new Map(),
        home: { x: 0, y: 0 },
        place(placement) {
            side.home = placement;
            stage.position.set(placement.x, placement.y);
        },
        stats: () => null,
        // draw calls of the captured frames, and how often Pixi built instructions
        draws: [],
        builds: { first: null, later: 0, renders: 0 },
    };

    try {
        for (const node of scene.nodes) await addNode(env, scene, side, node, stage);
        if (spec.swapped) {
            const [a, b] = scene.proof.swap.map((name) => side.named.get(name).view);

            stage.swapChildren(a, b);
        }
    } catch (error) {
        destroySide(side);
        throw error;
    }

    return side;
}

function destroySide(side) {
    for (const instance of side.instances) instance.destroy();
    side.instances.length = 0;
    side.stage.destroy({ children: true });
}

/** Applies one change between two frames to a side: see the events of scripts/render/scene-plan.mjs. */
async function applyEvent(env, scene, side, event) {
    const target = event.name ? side.named.get(event.name) : null;

    if (event.op === 'add') await addNode(env, scene, side, event.node, side.stage, event.index);
    else if (event.op === 'remove') side.stage.removeChild(target.view);
    else if (event.op === 'insert') side.stage.addChildAt(target.view, event.index);
    else if (event.op === 'move') side.stage.setChildIndex(target.view, event.index);
    else if (event.op === 'set') {
        if (event.visible !== undefined) target.view.visible = event.visible;
        if (event.renderable !== undefined) target.view.renderable = event.renderable;
    } else if (event.op === 'destroy') {
        target.destroy();
        side.instances.splice(side.instances.indexOf(target), 1);
        side.named.delete(event.name);
    } else throw new Error(`unknown event ${event.op}`);
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
 * Without ours the tooling proof runs alone: the official stage twice, and once with two
 * instances swapped. The side `auto` has the default options. It is drawn at the first frame
 * only: that says which mode `auto` picks with this many instances, and that the pick draws.
 */
function sidesOf(scene, official, ours, run) {
    const specs = [];
    const add = (key, runtime, mode, more = {}) => specs.push({ key, runtime, mode, ...more });

    if (official) add('official', official);
    if (official && !ours) add('twin', official);
    if (official && scene.proof) add('swapped', official, undefined, { swapped: true });
    if (!ours) return specs;
    if (run.mesh || (run.batched && scene.reference === 'mesh')) add('mesh', ours, 'mesh');
    if (run.batched) add('batched', ours, 'batched');
    if (run.auto) add('auto', ours, 'auto', { once: true });
    if (official && scene.proof && run.mesh) add('mesh-swapped', ours, 'mesh', { swapped: true });
    if (official && scene.proof && run.batched) add('batched-swapped', ours, 'batched', { swapped: true });

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
        if (side.swapped || side.key === 'twin') continue;
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

/** Which modes of ours a scene draws: asks the runtime with the first rig of the scene. */
async function askModes(env, scene, studio, options, report) {
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
    for (const pair of SCENE_PAIRS) {
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
        if (a && b) ctx.report.cases.push(await judge(ctx, at, pair, a, b, again));
    }
}

/** Runs one scene. The result is plain data for the Node side, like the result of a rig. */
export async function runScene(env, scene, options) {
    const report = { cases: [], notes: [], missing: env.missing };
    const studio = createStudio(env.PIXI, env.renderer, scene.size, env.draws, false, env.builds);
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
    let sides = [];

    ctx.sampleLabel = env.ours ? (asked.run.mesh ? 'mesh' : 'batched') : 'scene twice';
    try {
        for (const spec of sidesOf(scene, official, env.ours, asked.run)) {
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
                    if (step > 0) for (const instance of side.instances) instance.update(scene.dt);
                    // every frame is drawn, so the builds of the frames between two captures count too
                    countBuild(side, studio.draw(side.stage, BACKGROUNDS.solid).builds);
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
            if (scene.captures.includes(step)) {
                await compareFrame(ctx, scene, sides, at(step));
            }
            // the side with the default options has said what it picks, and has drawn it once
            for (const side of sides.filter((entry) => entry.once)) destroySide(side);
            sides = sides.filter((entry) => !entry.once);
        }
        if (env.ours) {
            const rows = await rowsCase(scene, sides);

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
