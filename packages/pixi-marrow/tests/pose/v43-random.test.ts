import { Skeleton } from 'spine-core-4.3';
import { expect, it } from 'vitest';
import { createPair, differences, type Pair, physicsBoth, playBoth, skinBoth, updateBoth } from './v43-pair';
import { ANIMATIONS, ATLAS, type Random, random, SKINS } from './v43-random-kit';
import { randomRig } from './v43-random-rig';

/*
 * Runs random calls on the random skeletons of v43-random-rig.ts, on our engine and on the
 * official core. After every call the pose must be that of the official core, bit for bit: the
 * animated local pose of every bone, the world transform of every bone, also of one that is not
 * active, and the applied pose of every slot and of the draw order. That holds after a setup pose
 * call and a change of skin too, where the applied pose of what a slider animates stays behind.
 * The numbers come from a seed, so a failure names a skeleton that can be made again.
 */

function play(r: Random, pair: Pair): void {
    const animation = r.int(ANIMATIONS);
    const [track, loop] = [r.int(3), r.chance(0.6)];
    const { mine, theirs } = playBoth(pair, track, animation, loop);

    if (track === 0 || r.chance(0.5)) return;
    const [alpha, additive] = [r.range(0, 1), r.chance(0.4)];

    pair.engine.configure(mine, { alpha, additive });
    Object.assign(theirs, { alpha, additive });
}

/** One random call that is about physics, on both sides. */
function physicsCall(r: Random, pair: Pair): void {
    const { engine, skeleton } = pair;
    const roll = r.next();

    if (roll < 0.4) physicsBoth(pair, r.pick(['none', 'reset', 'update', 'update', 'pose']));
    else if (roll < 0.6) {
        const [x, y] = [r.range(-30, 30), r.range(-30, 30)];

        engine.physicsTranslate(x, y);
        skeleton.physicsTranslate(x, y);
    } else if (roll < 0.8) {
        const [x, y, degrees] = [r.range(-30, 30), r.range(-30, 30), r.range(-90, 90)];

        engine.physicsRotate(x, y, degrees);
        skeleton.physicsRotate(x, y, degrees);
    } else {
        const forces = {
            windX: r.range(-1, 1),
            windY: r.range(-1, 1),
            gravityX: r.range(-1, 1),
            gravityY: r.range(-1, 1),
        };

        Object.assign(engine.state, forces);
        Object.assign(skeleton, forces);
    }
}

/** One random call that puts a setup pose back or places the skeleton, on both sides. */
function poseCall(r: Random, { engine, skeleton }: Pair): void {
    const roll = r.next();

    if (roll < 0.25) {
        engine.setupPose();
        skeleton.setupPose();
    } else if (roll < 0.5) {
        engine.setupPoseBones();
        skeleton.setupPoseBones();
    } else if (roll < 0.75) {
        engine.setupPoseSlots();
        skeleton.setupPoseSlots();
    } else {
        const placing = { scaleX: r.chance(0.5) ? -1.25 : 0.75, scaleY: r.chance(0.3) ? -0.8 : 1.5, x: 12.5, y: -7.25 };

        // with the y axis down the official skeleton negates the y scale it is given
        Object.assign(engine.state, placing, { scaleY: engine.state.yDown ? -placing.scaleY : placing.scaleY });
        Object.assign(skeleton, placing);
    }
}

/** One random call on both sides. Returns where the poses differ after it. */
function step(r: Random, pair: Pair, where: string): string[] {
    const roll = r.next();

    if (roll < 0.1) {
        const skin = r.int(SKINS + 1) - 1;

        skinBoth(pair, skin);

        return differences(pair, `${where} after skin ${skin}`);
    }
    if (roll < 0.28) play(r, pair);
    else if (roll < 0.36) poseCall(r, pair);
    else if (roll < 0.44) physicsCall(r, pair);
    else {
        const dt = r.next() * 0.12;

        // a slider at a time that is no number: the official deform timeline reads a key that is not there
        if (!updateBoth(pair, dt)) return [];

        return differences(pair, `${where} after an update by ${dt} with physics ${pair.physics}`);
    }

    return differences(pair, `${where} after a call`);
}

/** Runs one random skeleton. Every fourth one has the y axis down, as Pixi has it. */
async function runSeed(seed: number): Promise<{ problems: string[]; broken: boolean }> {
    const yDown = seed % 4 === 0;
    const problems: string[] = [];

    // the official skeleton reads the static when it is made and in every update
    Skeleton.yDown = yDown;
    try {
        const pair = await createPair({ skeleton: randomRig(seed), atlas: ATLAS });
        const r = random(seed * 31 + 7);

        Object.assign(pair.engine.state, { yDown, scaleY: yDown ? -1 : 1 });
        pair.engine.defaultMix = 0.25;
        pair.state.data.defaultMix = 0.25;
        problems.push(...differences(pair, `seed ${seed}, new`));
        for (let i = 0; i < 80 && problems.length === 0 && !pair.broken; i++)
            problems.push(...step(r, pair, `seed ${seed}, step ${i}`));
        expect(pair.engine.state.time).toBe(pair.skeleton.time);

        return { problems, broken: pair.broken };
    } finally {
        Skeleton.yDown = false;
    }
}

it('poses random skeletons with every constraint like the official core', async () => {
    const problems: string[] = [];
    let broken = 0;

    for (let seed = 1; seed <= 150 && problems.length === 0; seed++) {
        const result = await runSeed(seed);

        problems.push(...result.problems);
        if (result.broken) broken++;
    }
    expect(problems.slice(0, 5)).toEqual([]);
    // most skeletons run to the end
    expect(broken).toBeLessThan(30);
});
