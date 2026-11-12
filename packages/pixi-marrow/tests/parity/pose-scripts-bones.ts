import type { TrackFields } from '../../src/core';
import { DT, ODD, type PoseScript, pick, type ScriptBuilder, script } from './pose-script';
import { BONE_FIELDS, type BoneField, type PoseRigInfo } from './pose-shared';

/*
 * Scripts for writes to a bone from outside the engine. The display object hands out bones, and
 * code such as `hero.bone('gun').rotation += 10` writes the local pose between two updates. The
 * official counterpart is a write to `bone.rotation`, or to `bone.pose.rotation` in 4.3.
 *
 * What the official runtime does with such a value is the rule. A bone no animation keys keeps
 * it until a setup pose call. A keyed bone gets its keys again in the next update, in part when
 * the track has a weight below 1. A constraint, a bone below and a slider read it in that update.
 * An engine that rests must wake for it, and one that skips bones must not skip this one.
 */

/** Steps over the end of an animation and a third of its length on, whatever the length is. */
function past(s: ScriptBuilder, duration: number): void {
    s.update(Math.max(DT, duration * 0.45), 3);
}

/** What makes an entry add to the tracks below it, in the words of the version. */
const adding = (rig: PoseRigInfo): TrackFields => (rig.version === '4.3' ? { additive: true } : { mixBlend: 'add' });

/** Up to `count` items of a list, evenly picked, the first among them. */
function spread(list: readonly number[], count: number): number[] {
    const step = Math.max(1, Math.ceil(list.length / count));

    return list.filter((_, i) => i % step === 0).slice(0, count);
}

/** A value for a field of a bone that is far from any setup value. `n` picks one of four. */
function valueFor(field: BoneField, n: number): number {
    if (field === 'rotation') return [35, -80, 170, -15][n % 4] ?? 0;
    if (field === 'x' || field === 'y') return [12, -9, 25, -30][n % 4] ?? 0;
    if (field === 'scaleX' || field === 'scaleY') return [1.3, -0.7, 0.5, 2][n % 4] ?? 1;

    return [15, -25, 8, -5][n % 4] ?? 0;
}

/** The bones a script writes, picked for the animations it plays. */
function bonesFor(rig: PoseRigInfo, animations: readonly number[]) {
    const keyed = new Set(animations.flatMap((index) => rig.animations[index]?.keyed ?? []));
    const special = new Set([...rig.constrained, ...rig.sources]);
    const parents = new Set(rig.parents);
    const plain = rig.parents
        .map((_, bone) => bone)
        .filter((bone) => !keyed.has(bone) && !rig.skinBones.includes(bone));

    return {
        /** A bone that no animation of the script keys and no constraint writes or reads. */
        free: plain.find((bone) => bone > 0 && !special.has(bone)) ?? plain.at(-1) ?? rig.bones - 1,
        /** A bone the first animation keys. The root bone when it keys none. */
        keyed: rig.animations[animations[0] ?? 0]?.keyed[0] ?? 0,
        /** A bone with bones below it that no animation of the script keys. */
        parent: plain.find((bone) => bone > 0 && parents.has(bone)) ?? 0,
    };
}

/** A bone no animation keys: the value stays, over many updates and without a track, until a setup pose call. */
function unkeyed(rig: PoseRigInfo): PoseScript[] {
    const { a } = pick(rig);
    const { free } = bonesFor(rig, [a]);

    return [
        script('bone written that no animation keys', (s) => {
            s.set(0, a, true);
            s.update(DT, 4);
            s.bone(free, 'rotation', 37.5);
            s.update(DT, 24);
            s.bone(free, 'x', 12);
            s.bone(free, 'scaleY', 1.7);
            s.update(ODD, 6);
            s.bone(free, 'shearX', -20);
            s.bone(free, 'y', -8);
            s.bone(free, 'scaleX', -0.8);
            s.bone(free, 'shearY', 15);
            s.update(DT, 4);
            // the setup pose takes the writes back
            s.setupPoseBones();
            s.update(DT, 2);
            s.bone(free, 'rotation', -110);
            s.clearTracks();
            s.update(DT, 4);
        }),
    ];
}

/** A keyed bone: the next update poses it from its keys, all the way on track 0 and in part on a track with less weight. */
function keyed(rig: PoseRigInfo): PoseScript[] {
    const { a } = pick(rig, 1);
    const bone = bonesFor(rig, [a]).keyed;

    return [
        script('bone written that the animation keys', (s) => {
            s.set(0, a, true);
            s.update(DT, 4);
            s.bone(bone, 'rotation', 123);
            s.bone(bone, 'x', 50);
            s.update(DT, 3);
            s.bone(bone, 'scaleX', 2);
            s.bone(bone, 'shearY', 25);
            s.update(DT, 3);
            // an upper track with half its weight: the write counts for half, and for less with every update
            s.clearTrack(0);
            s.set(1, a, true, { alpha: 0.5 });
            s.update(DT, 3);
            s.bone(bone, 'rotation', -200);
            s.bone(bone, 'y', 40);
            s.update(DT, 8);
            // a track that adds: the write is what it adds to
            s.set(1, a, true, adding(rig));
            s.bone(bone, 'rotation', 10);
            s.update(DT, 5);
        }),
    ];
}

/** A skeleton at rest: it wakes for the write, shows it, and rests again. */
function atRest(rig: PoseRigInfo): PoseScript[] {
    const { a, duration } = pick(rig, 2);
    const { free, keyed: key, parent } = bonesFor(rig, [a]);

    return [
        script('bone written while the skeleton rests', (s) => {
            s.set(0, a, false);
            past(s, duration(a));
            s.update(DT, 8);
            s.bone(free, 'rotation', 45);
            s.update(DT, 6);
            // a keyed bone: the entry at rest poses it again
            s.bone(key, 'rotation', 45);
            s.bone(key, 'x', -30);
            s.update(DT, 5);
            s.bone(parent, 'y', 30);
            s.update(DT, 5);
            // an update of no time shows the write too
            s.bone(free, 'scaleX', 1.4);
            s.update(0, 2);
            s.update(DT, 4);
            s.clearTracks();
            s.update(DT, 4);
            s.bone(parent, 'rotation', -25);
            s.update(DT, 5);
        }),
    ];
}

/** Two tracks that mix: the bones each animation keys and a bone neither keys, written in the middle of the mix. */
function mixing(rig: PoseRigInfo): PoseScript[] {
    const { a, b, c } = pick(rig);
    const { free } = bonesFor(rig, [a, b, c]);
    const [inA, inB, inC] = [a, b, c].map((animation) => bonesFor(rig, [animation]).keyed);

    return [
        script('bone written while two tracks mix', (s) => {
            s.defaultMix(0.3);
            s.set(0, a, true);
            s.update(DT, 4);
            s.set(0, b, true);
            s.update(DT, 3);
            s.bone(inA ?? 0, 'rotation', 90);
            s.bone(inB ?? 0, 'x', 25);
            s.bone(free, 'scaleY', 0.5);
            s.update(DT, 4);
            s.bone(inB ?? 0, 'rotation', -60);
            s.update(DT, 6);
            s.set(1, c, true, { alpha: 0.5 });
            s.update(DT, 2);
            s.bone(inC ?? 0, 'rotation', 150);
            s.bone(free, 'x', -14);
            s.update(DT, 5);
            s.setEmpty(0, 0.2);
            s.update(DT, 3);
            s.bone(inB ?? 0, 'y', 33);
            s.update(DT, 6);
        }),
    ];
}

/** Bones a constraint writes, and bones a constraint reads to pose others, while an animation plays and at rest. */
function constrained(rig: PoseRigInfo): PoseScript[] {
    if (rig.constrained.length === 0) return [];
    const { a } = pick(rig, 1);
    const written = spread(rig.constrained, 4);
    const read = spread(rig.sources, 3);
    const fields: BoneField[] = ['rotation', 'x', 'scaleX', 'y'];
    const write = (s: ScriptBuilder, bones: number[], shift: number): void => {
        bones.forEach((bone, i) => {
            const field = fields[(i + shift) % fields.length] ?? 'rotation';

            s.bone(bone, field, valueFor(field, i + shift));
        });
    };

    return [
        script('bone written that a constraint writes or reads', (s) => {
            s.set(0, a, true);
            s.update(DT, 3);
            write(s, written, 0);
            s.update(DT, 4);
            write(s, read, 1);
            s.update(DT, 4);
            // without a track nothing takes the writes back
            s.clearTracks();
            s.update(DT, 3);
            write(s, written, 2);
            s.update(DT, 4);
            s.setupPoseBones();
            write(s, read, 3);
            s.update(DT, 3);
        }),
    ];
}

/** The root bone and another bone with bones below it: everything below moves, though it was not written. */
function above(rig: PoseRigInfo): PoseScript[] {
    const { a } = pick(rig, 2);
    const { parent } = bonesFor(rig, [a]);

    return [
        script('bone written above bones that stand still', (s) => {
            s.update(DT, 2);
            s.bone(0, 'rotation', 30);
            s.update(DT, 3);
            s.bone(0, 'x', -18);
            s.bone(0, 'scaleX', 1.3);
            s.update(DT, 3);
            s.set(0, a, true);
            s.update(DT, 3);
            s.bone(parent, 'scaleY', -1.2);
            s.bone(parent, 'shearX', 12);
            s.update(DT, 4);
            s.bone(parent, 'rotation', 200);
            s.update(ODD, 4);
        }),
    ];
}

/** A bone that needs a skin: the write shows once a skin makes the bone active. */
function inactive(rig: PoseRigInfo): PoseScript[] {
    const [first, other = first] = [rig.skinBones[0], rig.skinBones.at(-1)];

    if (first === undefined || other === undefined) return [];
    const { a } = pick(rig);

    return [
        script('bone written that is not active', (s) => {
            s.set(0, a, true);
            s.update(DT, 2);
            s.bone(first, 'rotation', 77);
            s.bone(first, 'x', 9);
            s.update(DT, 3);
            for (let skin = 0; skin < Math.min(rig.skins, 5); skin++) {
                s.skin(skin);
                s.update(DT, 2);
            }
            s.skin(-1);
            s.bone(other, 'scaleX', 1.6);
            s.update(DT, 2);
            s.skin(rig.skins - 1);
            s.bone(first, 'rotation', -33);
            s.update(DT, 3);
        }),
    ];
}

/** Writes before the first update, between a setup pose call and an update, and of a value that is there already. */
function edges(rig: PoseRigInfo): PoseScript[] {
    const { a, duration } = pick(rig, 1);
    const { free, keyed: key } = bonesFor(rig, [a]);

    return [
        script('bone written before the first update and after a setup pose call', (s) => {
            s.bone(free, 'rotation', 15);
            s.bone(key, 'y', 9);
            s.set(0, a, true);
            s.update(DT, 3);
            s.setupPose();
            s.bone(free, 'scaleX', 0.5);
            s.bone(key, 'rotation', -40);
            s.update(DT, 3);
            s.setupPoseBones();
            s.bone(free, 'x', 7);
            s.update(0, 2);
            s.update(DT, 2);
        }),
        script('bone written with the value that is there', (s) => {
            s.set(0, a, false);
            past(s, duration(a));
            s.update(DT, 5);
            s.bone(free, 'rotation', 20);
            s.update(DT, 3);
            // the pose is marked and nothing changes
            s.bone(free, 'rotation', 20);
            s.update(DT, 4);
            s.bone(free, 'rotation', 20);
            s.bone(free, 'rotation', 20);
            s.update(0, 2);
            // changed and changed back before the update
            s.bone(free, 'rotation', 21);
            s.bone(free, 'rotation', 20);
            s.update(DT, 3);
        }),
    ];
}

/**
 * A call between the write and the update. None of these calls changes a bone, so the write must
 * show in the update after them: an engine that notes the write must not forget it when another
 * call comes first. Once at rest and once while an animation loops.
 */
function beforeCalls(rig: PoseRigInfo): PoseScript[] {
    const last = rig.skins - 1;
    const { a, b, duration } = pick(rig);
    const { free } = bonesFor(rig, [a]);
    const calls: ((s: ScriptBuilder, entry: number) => void)[] = [
        // the skin that is set already
        (s) => s.skin(-1),
        (s) => s.setupPoseSlots(),
        // a track that holds nothing
        (s) => s.clearTrack(3),
        (s) => s.defaultMix(0.1),
        (s) => s.setMix(a, b, 0.1),
        (s) => s.timeScale(1),
        (s) => s.physics('update'),
        (s) => s.physicsTranslate(0, 0),
        (s) => s.physicsRotate(0, 0, 0),
        (s) => s.place(0, 0, 1, 1),
        (s) => s.yDown(false),
        (s) => s.forces(1, 0, 0, 1),
        (s, entry) => s.configure(entry, { alpha: 1 }),
        (s) => s.update(0),
        // a skin, and then the same skin again
        (s) => s.skin(last),
        (s) => s.skin(last),
    ];

    return [false, true].map((loop) =>
        script(`bone written before another call and the update, ${loop ? 'in a loop' : 'at rest'}`, (s) => {
            const entry = s.set(0, a, loop);

            past(s, duration(a));
            s.update(DT, 4);
            calls.forEach((call, i) => {
                const field = BONE_FIELDS[i % BONE_FIELDS.length] ?? 'rotation';

                s.bone(free, field, valueFor(field, i));
                call(s, entry);
                s.update(DT, 2);
            });
        }),
    );
}

/** Many writes in a row, to a dozen bones all over the rig and to another field in every round. */
function many(rig: PoseRigInfo): PoseScript[] {
    const { a } = pick(rig);
    const bones = spread(
        rig.parents.map((_, bone) => bone),
        12,
    );

    return [
        script('bones written in a row', (s) => {
            s.set(0, a, true);
            s.update(DT, 2);
            for (let round = 0; round < 4; round++) {
                bones.forEach((bone, i) => {
                    const field = BONE_FIELDS[(i + round) % BONE_FIELDS.length] ?? 'rotation';

                    s.bone(bone, field, valueFor(field, i + round));
                });
                s.update(round % 2 === 0 ? DT : ODD, 2);
            }
            s.setupPoseBones();
            s.update(DT, 2);
        }),
    ];
}

/** On a rig with physics: the root bone jumps, physics bones and the bones above them turn, in every physics mode. */
function physics(rig: PoseRigInfo): PoseScript[] {
    if (rig.physics === 0) return [];
    const { a } = pick(rig);
    const bones = spread(rig.constrained, 5);

    return [
        script('bone written on a rig with physics', (s) => {
            // nothing plays, and the physics has nothing to do until a bone is written
            s.update(DT, 6);
            s.bone(0, 'x', 60);
            s.update(DT, 5);
            bones.forEach((bone, i) => {
                s.bone(bone, 'rotation', valueFor('rotation', i));
            });
            for (const dt of [0.001, 0.02, 1 / 60, 0.05, 0.004, ODD]) s.update(dt);
            s.physics('pose');
            s.bone(0, 'y', -40);
            s.update(DT, 2);
            s.physics('none');
            s.bone(0, 'rotation', 20);
            s.update(DT, 2);
            s.physics('update');
            s.update(DT, 3);
            s.set(0, a, true);
            s.update(DT, 3);
            s.bone(0, 'rotation', 45);
            s.update(DT, 4);
        }),
    ];
}

/** On a rig with sliders: every field a slider can read, written to the bones that constraints read. */
function sliders(rig: PoseRigInfo): PoseScript[] {
    if (rig.sliders === 0) return [];
    const { a } = pick(rig);
    const read = rig.sources.slice(0, 8);
    const fields: BoneField[] = ['rotation', 'x', 'y', 'scaleX', 'scaleY', 'shearY'];
    const write = (s: ScriptBuilder, shift: number): void => {
        read.forEach((bone, i) => {
            for (const field of fields) s.bone(bone, field, valueFor(field, i + shift));
            s.update(DT, 2);
        });
    };

    return [
        script('bone written that a slider reads', (s) => {
            s.update(DT, 2);
            write(s, 0);
            s.set(0, a, true);
            s.update(DT, 3);
            write(s, 1);
            s.setupPoseBones();
            s.update(DT, 2);
        }),
    ];
}

/** The scripts for writes to a bone from outside the engine. */
export function boneScripts(rig: PoseRigInfo): PoseScript[] {
    const all = [
        unkeyed,
        keyed,
        atRest,
        mixing,
        constrained,
        above,
        inactive,
        edges,
        beforeCalls,
        many,
        physics,
        sliders,
    ];

    return all.flatMap((scripts) => scripts(rig));
}
