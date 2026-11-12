/**
 * The scenes of the A/B mode on the Node side: which rigs a scene measures, what they play, and
 * with how many instances. The page builds a scene from that, see scripts/bench/scene.js.
 *
 * The scene `little` needs an animation that moves few bones while the rest stands still. Such
 * an animation is looked for on the rig itself: every animation is played with the pose engine,
 * and the share of the bones whose world transform changed in an update is counted. What an
 * animation keys does not say that: a keyed root bone moves every bone below it, and so does a
 * constraint. A rig without an animation that is clear enough gets one written at run time: a
 * copy of its JSON export with one more animation, which turns one bone.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The scenes `--scene` can name, in the order `--scene=all` runs them. */
const SCENES = ['play', 'rest', 'setup', 'moved', 'little', 'mixed'];
/** The instance count of every scene but `play` and `mixed`, unless `--instances` names others. */
const SCENE_INSTANCES = 200;
/** The scene `mixed`: so many instances of each of these rigs of one Spine version. */
const MIXED = {
    instancesPerRig: 6,
    // small rigs with a short animation each, as the symbols of a slot game have
    rigs: [
        ['4.2/coin-pro', 'animation', null],
        ['4.2/speedy-ess', 'run', null],
        ['4.2/powerup-pro', 'bounce', null],
        ['4.2/goblins-pro', 'walk', 'goblin'],
        ['4.2/alien-pro', 'jump', null],
    ],
    // frames between two starts of an animation, the same number as in scripts/bench/scene.js
    startEvery: 12,
};
/** An animation moves little when it moves at most this share of the bones in an update, on average. */
const LITTLE_SHARE = 0.15;
/** Updates an animation is played for to see how much of the skeleton it moves. */
const MOTION_STEPS = 60;
/**
 * Rigs that join the scene `little` when the run has the default rigs: each has an animation
 * that moves little, which most of the default rigs lack.
 */
const LITTLE_EXTRA = ['4.2/owl-pro', '4.3/spineboy-pro'];

const percent = (share) => `${(100 * share).toFixed(0)} percent`;

/** The scenes of a run: the value of `--scene`, `all` for every scene, `play` without it. */
export function scenesOf(value) {
    if (!value) return ['play'];
    const names = value === 'all' ? SCENES : value.split(',').filter(Boolean);
    const unknown = names.filter((name) => !SCENES.includes(name));

    if (unknown.length > 0) throw new Error(`--scene knows ${SCENES.join(', ')} and all, not ${unknown.join(', ')}`);

    return names;
}

/**
 * How much of a skeleton every animation moves: the share of the bones it keys, the share of
 * the slots it keys, and the share of the bones whose world transform changed in an update,
 * as the mean over one loop.
 *
 * @param core The loaded `pixi-marrow/core` of the build that is measured.
 */
async function measureMotion(core, model) {
    const bones = model.bones.count;
    const rows = [];

    for (const [index, animation] of model.animations.entries()) {
        const keyed = (kinds) =>
            new Set(animation.timelines.filter((line) => kinds.test(line.kind)).map((line) => line.target)).size;
        const engine = await core.createPoseEngine(model);
        const { world } = engine.state;
        let before = Float64Array.from(world);
        let moved = 0;

        engine.setAnimation(0, index, true);
        engine.update(0);
        for (let step = 0; step < MOTION_STEPS; step++) {
            before = Float64Array.from(world);
            engine.update(Math.max(animation.duration, 1 / 30) / MOTION_STEPS);
            for (let bone = 0; bone < bones; bone++) {
                if (world.subarray(bone * 6, bone * 6 + 6).some((value, at) => value !== before[bone * 6 + at]))
                    moved++;
            }
        }
        rows.push({
            name: animation.name,
            duration: animation.duration,
            keyedBones: keyed(/^(rotate|translate|scale|shear|inherit)/) / bones,
            keyedSlots: keyed(/^(rgba|rgb|alpha|rgba2|rgb2|attachment|deform|sequence)$/) / model.slots.count,
            movedBones: moved / MOTION_STEPS / bones,
        });
    }

    return rows;
}

/**
 * Writes a copy of the JSON export of a rig with one more animation, `little`, which turns one
 * bone back and forth in one second. The bone has no child. Where the rig has one, it is a bone
 * that carries a slot with an attachment, so that something on screen moves.
 *
 * @returns The file name of the copy and the name of the bone.
 */
function writeLittleRig(root, made, rig) {
    const data = JSON.parse(readFileSync(join(root, 'fixtures/.cache', rig.version, rig.files.json), 'utf8'));
    const parents = new Set(data.bones.map((bone) => bone.parent));
    const leaves = data.bones.filter((bone) => !parents.has(bone.name)).map((bone) => bone.name);
    const shown = new Set(data.slots.filter((slot) => slot.attachment).map((slot) => slot.bone));
    const bone = leaves.find((name) => shown.has(name)) ?? leaves.at(-1) ?? data.bones.at(-1).name;
    const file = rig.files.json.replace(/\.json$/, '-little.json');

    data.animations.little = {
        bones: { [bone]: { rotate: [{ value: 0 }, { time: 0.5, value: 15 }, { time: 1, value: 0 }] } },
    };
    mkdirSync(join(made, rig.version), { recursive: true });
    writeFileSync(join(made, rig.version, file), JSON.stringify(data));

    return { file, bone };
}

/** The plan of a rig that plays another animation, with another skin or from another skeleton file. */
function playing(rig, animation, duration, more = {}) {
    const [sequence] = rig.sequences;

    return {
        ...rig,
        files: { ...rig.files, skel: more.skel ?? rig.files.skel },
        sequences: [{ ...sequence, animation, duration, skin: more.skin === undefined ? sequence.skin : more.skin }],
    };
}

/**
 * The plan of a rig for the scene `little`, and a note that says what it plays and why.
 *
 * @param context `root`, `made` (a folder for the fixtures this writes) and `core`, the loaded
 * core of the build that is measured.
 */
async function littleOf(rig, { root, made, core }) {
    const bytes = readFileSync(join(root, 'fixtures/.cache', rig.version, rig.files.skel));
    const motion = await measureMotion(core, await core.importSkeleton(new Uint8Array(bytes)));
    const [least] = motion.filter((row) => row.duration > 0).sort((a, b) => a.movedBones - b.movedBones);

    if (least && least.movedBones <= LITTLE_SHARE) {
        return {
            plan: playing(rig, least.name, least.duration),
            note:
                `plays ${least.name}: it keys ${percent(least.keyedBones)} of the bones and ${percent(least.keyedSlots)} of the slots, ` +
                `and an update moves ${percent(least.movedBones)} of the bones`,
        };
    }
    const { file, bone } = writeLittleRig(root, made, rig);
    const why = least
        ? `its calmest animation, ${least.name}, moves ${percent(least.movedBones)} of the bones in an update`
        : 'it has no animation with a duration';

    return {
        plan: playing(rig, 'little', 1, { skel: file }),
        note: `plays an animation written at run time, which turns the bone ${bone} alone: ${why}`,
    };
}

/**
 * What a run measures: per scene the subjects, each on a page of its own. A subject is one rig,
 * or the rigs of the scene `mixed`.
 *
 * @param options.scenes The scenes of the run. `options.rigs` are the rigs of the run and
 * `options.planned` every rig of the plan. `options.counts` are the instance counts and
 * `options.countsGiven` says whether `--instances` named them. `options.defaults` is true when
 * the run has the default rigs. `options.pkg` is the folder of the build that is measured.
 * @returns Per subject: `id`, `scene`, `official` (the Spine version of the official runtime),
 * `plans` (what the page loads), `counts`, and `frames` and `note` where the scene sets them.
 */
export async function planSubjects({ root, made, pkg, scenes, rigs, planned, counts, countsGiven, defaults }) {
    const subjects = [];
    const subject = (scene, rig, more = {}) => ({
        id: rig.id,
        scene,
        official: rig.official,
        rig,
        plans: rig,
        counts: scene === 'play' || countsGiven ? counts : [SCENE_INSTANCES],
        ...more,
    });

    for (const scene of scenes) {
        if (scene === 'mixed') {
            const plans = MIXED.rigs.map(([id, animation, skin]) => {
                const rig = planned.find((entry) => entry.id === id);

                if (!rig) throw new Error(`the scene mixed needs the rig ${id}`);

                return playing(rig, animation, rig.durations[animation], { skin });
            });
            const instances = plans.length * MIXED.instancesPerRig;

            subjects.push({
                id: `mixed: ${plans.map((plan) => plan.rig).join(', ')}`,
                scene,
                official: plans[0].official,
                rig: plans[0],
                plans,
                counts: [instances],
                // one round: every instance plays once
                frames: instances * MIXED.startEvery,
                note: `${MIXED.instancesPerRig} instances of each rig rest. Every ${MIXED.startEvery} frames the next one plays its animation once`,
            });
        } else if (scene === 'little') {
            const core = await import(pathToFileURL(join(pkg, 'dist/core.js')).href);
            const extra = defaults ? planned.filter((rig) => LITTLE_EXTRA.includes(rig.id)) : [];

            for (const rig of [...rigs, ...extra]) {
                const { plan, note } = await littleOf(rig, { root, made, core });

                subjects.push(subject(scene, rig, { plans: plan, note }));
            }
        } else for (const rig of rigs) subjects.push(subject(scene, rig));
    }

    return subjects;
}
