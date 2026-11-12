import { describe, expect, it } from 'vitest';
import { createPoseEngine, importSkeleton, MarrowError } from '../../src/core';
import { createPose } from '../../src/pose/v43/pose';
import { prepareRig } from '../../src/pose/v43/rig';
import { sliderRigs } from '../parity/pose-rig-slider';
import { sliderSlotRigs } from '../parity/pose-rig-slider-slots';
import { createPair, differences, NO_REGIONS, type Pair, playBoth, skinBoth, updateBoth } from './v43-pair';
import { type Json, RIG, SORTED, TEXT, wave } from './v43-slider-rigs';

/*
 * Sliders of the 4.3 engine, where the parity scripts do not reach. The scripts compare after an
 * update. Here the pose is compared after every call: a slider gives what it animates an applied
 * pose of its own, and that pose stays behind until the next update. Also here: what the engine
 * refuses, what a skeleton pays for sliders, and that a slider fires no events.
 */

const [PLAY, S0, S3, S4] = [3, 0, 3, 4];
const pairOf = (): Promise<Pair> => createPair({ skeleton: TEXT, atlas: NO_REGIONS });

/** `times` updates on both sides. Returns where the poses differ after each. */
function run(pair: Pair, dt: number, times: number, where: string): string[] {
    const problems: string[] = [];

    for (let i = 0; i < times && problems.length === 0; i++) {
        if (!updateBoth(pair, dt)) throw new Error(`The official core threw ${where}`);
        problems.push(...differences(pair, `${where}, update ${i}`));
    }

    return problems;
}

/** One setup pose call on both sides. */
function setupBoth({ engine, skeleton }: Pair, call: 'setupPose' | 'setupPoseBones' | 'setupPoseSlots'): void {
    engine[call]();
    skeleton[call]();
}

describe('what a slider of the 4.3 pose engine animates', () => {
    it('has the applied pose of a new official skeleton before the first update', async () => {
        const pair = await pairOf();
        const { state } = pair.engine;

        expect(differences(pair, 'new')).toEqual([]);
        // the slot of a slot timeline of a slider: a new official slot pose, white and empty
        expect([state.attachments[S0], Array.from(state.colors.subarray(0, 4))]).toEqual([null, [1, 1, 1, 1]]);
        // a slot no slider animates: the setup pose
        expect(state.attachments[S3]?.name).toBe('p0');
        expect(run(pair, 0.05, 3, 'the first updates')).toEqual([]);
        expect(state.attachments[S0]?.name).toBe('p0');
    });

    it('keeps its applied pose after a setup pose call and a change of skin, until the next update', async () => {
        const pair = await pairOf();
        const problems: string[] = [];
        const check = (where: string): number => problems.push(...differences(pair, where));

        playBoth(pair, 0, PLAY, true);
        problems.push(...run(pair, 0.07, 6, 'playing'));
        for (const call of ['setupPoseSlots', 'setupPoseBones', 'setupPose'] as const) {
            const { colors } = pair.engine.state;
            const shown = Array.from(colors);

            setupBoth(pair, call);
            check(`after ${call}`);
            // the slots of the sliders show what they did. A slot without a pose of its own shows the setup pose
            expect(Array.from(colors.subarray(0, 12))).toEqual(shown.slice(0, 12));
            if (call !== 'setupPoseBones') expect(Array.from(colors.subarray(S4 * 4))).toEqual([1, 1, 1, 1]);
            problems.push(...run(pair, 0.07, 4, `after ${call}`));
        }
        skinBoth(pair, 1);
        check('with the skin');
        setupBoth(pair, 'setupPoseSlots');
        check('with the skin after setupPoseSlots');
        problems.push(...run(pair, 0.07, 6, 'with the skin'));
        // the animation ends and is taken away: every update starts from the animated pose it left
        playBoth(pair, 0, PLAY, false);
        problems.push(...run(pair, 0.07, 16, 'to the end'));
        pair.engine.clearTrack(0);
        pair.state.clearTrack(0);
        expect(pair.engine.state.deformLengths[S0]).toBeGreaterThan(0);
        problems.push(...run(pair, 0.07, 6, 'with nothing playing'));
        expect(problems.slice(0, 4)).toEqual([]);
    });

    it('sorts a path constraint by the animated attachment of its slot, not by the applied one', async () => {
        const pair = await createPair({ skeleton: JSON.stringify(SORTED), atlas: NO_REGIONS });
        const problems: string[] = [];

        // the slot shows the path of the first skin, which has weights for the bone `w`
        skinBoth(pair, 1);
        playBoth(pair, 0, 1, true);
        problems.push(...run(pair, 0.07, 4, 'with the first skin'));
        expect(pair.engine.state.attachments[0]?.name).toBe('line');
        // the second skin has no such path, so the slot keeps it. The slider shows another one
        skinBoth(pair, 2);
        problems.push(...differences(pair, 'after the second skin'));
        problems.push(...run(pair, 0.07, 8, 'with the second skin'));
        expect(problems.slice(0, 4)).toEqual([]);
    });

    it('shows the constrained pose it had last when a slider gets its skin back', async () => {
        const pair = await pairOf();
        const { engine } = pair;
        const problems: string[] = [];
        const check = (where: string): number => problems.push(...differences(pair, where));
        const bytes = engine.bytes;

        playBoth(pair, 0, PLAY, false);
        skinBoth(pair, 1);
        check('with the skin, before an update');
        problems.push(...run(pair, 0.11, 4, 'with the skin'));
        const held = [Array.from(engine.state.drawOrder), Array.from(engine.state.colors.subarray(S4 * 4))];
        const now = (): number[][] => [
            Array.from(engine.state.drawOrder),
            Array.from(engine.state.colors.subarray(S4 * 4)),
        ];

        // without the skin the slider is off: its slot and the draw order show the animated pose
        skinBoth(pair, -1);
        check('without the skin');
        problems.push(...run(pair, 0.11, 5, 'without the skin'));
        setupBoth(pair, 'setupPoseSlots');
        check('without the skin after setupPoseSlots');
        expect(now()).toEqual([
            [0, 1, 2, 3, 4],
            [1, 1, 1, 1],
        ]);
        // the constrained poses come back as they were left, long ago
        skinBoth(pair, 1);
        check('with the skin again');
        expect(now()).toEqual(held);
        expect(held[0]).toEqual([0, 2, 1, 3, 4]);
        skinBoth(pair, 0);
        skinBoth(pair, 1);
        check('with the skin once more');
        problems.push(...run(pair, 0.11, 5, 'with the skin again'));
        expect(problems.slice(0, 4)).toEqual([]);
        // the poses that were set aside are counted
        expect(engine.bytes).toBeGreaterThan(bytes);
    });

    it('is posed like the official core between the updates of the rigs made for sliders', async () => {
        const problems: string[] = [];

        for (const source of [...sliderRigs(), ...sliderSlotRigs()]) {
            const pair = await createPair(source.read());
            const [animations, skins] = [pair.data.animations.length, pair.data.skins.length];

            problems.push(...differences(pair, `${source.id}, new`));
            for (let i = 0; i < animations * 2 && problems.length === 0; i++) {
                const where = `${source.id}, round ${i}`;

                playBoth(pair, i % 3, i % animations, i % 2 === 0);
                problems.push(...run(pair, 0.07, 3, where));
                setupBoth(pair, (['setupPoseSlots', 'setupPoseBones', 'setupPose'] as const)[i % 3] ?? 'setupPose');
                problems.push(...differences(pair, `${where}, after a setup pose call`));
                skinBoth(pair, (i % (skins + 1)) - 1);
                problems.push(...differences(pair, `${where}, after a change of skin`));
                problems.push(...run(pair, 0.13, 2, `${where}, at the end`));
            }
        }
        expect(problems.slice(0, 4)).toEqual([]);
    });

    it('fires no events', async () => {
        const pair = await pairOf();
        const fired: string[] = [];

        for (let i = 0; i < 30; i++) {
            updateBoth(pair, 0.05);
            fired.push(...pair.engine.takeEvents().map((event) => event.type));
        }
        expect(fired).toEqual([]);
        // a track fires them
        playBoth(pair, 0, 0, false);
        for (let i = 0; i < 10; i++) {
            updateBoth(pair, 0.05);
            fired.push(...pair.engine.takeEvents().map((event) => event.type));
        }
        expect(fired.filter((type) => type === 'event')).toHaveLength(2);
    });
});

describe('what a skeleton pays for sliders in the 4.3 pose engine', () => {
    it('is a second pose only for what a slider animates', async () => {
        const full = createPose(prepareRig(await importSkeleton(TEXT)));
        const bonesOnly = { ...RIG, constraints: [{ type: 'slider', name: 'timed', animation: 'second' }] };
        const lean = createPose(
            prepareRig(
                await importSkeleton(
                    JSON.stringify({
                        ...bonesOnly,
                        skins: [(RIG.skins as Json[])[0]],
                        animations: {
                            second: { bones: { c: { rotate: wave(0, 40) } } },
                            play: (RIG.animations as Json).play,
                        },
                    }),
                ),
            ),
        );
        const { state, solve } = full;

        // slots, the draw order, an inherit mode and a constraint are animated: each has two poses
        expect(solve.split).not.toBeNull();
        expect(full.colors).not.toBe(state.colors);
        expect(full.attachments).not.toBe(state.attachments);
        expect(full.drawOrder).not.toBe(state.drawOrder);
        expect(solve.inherit).not.toBe(state.inherit);
        expect(solve.applied).not.toBe(solve.values);
        expect(solve.split?.applied.colors).toBe(state.colors);
        expect(solve.split?.applied.local).toBe(solve.local);
        // a slot no slider animates shares its deform
        expect(full.deform[S3]).toBe(state.deform[S3]);
        expect(full.deform[S0]).not.toBe(state.deform[S0]);
        // a slider that animates bones only: one pose of everything else
        expect(lean.solve.split).not.toBeNull();
        expect([lean.colors, lean.attachments, lean.deform, lean.drawOrder]).toEqual([
            lean.state.colors,
            lean.state.attachments,
            lean.state.deform,
            lean.state.drawOrder,
        ]);
        expect(lean.colors).toBe(lean.state.colors);
        expect(lean.drawOrder).toBe(lean.state.drawOrder);
        expect(lean.solve.inherit).toBe(lean.state.inherit);
        expect(lean.solve.applied).toBe(lean.solve.values);
        expect(lean.solve.split?.slotPosed.length).toBe(0);
    });

    it('is the same for two instances of one model', async () => {
        const model = await importSkeleton(TEXT);
        const [first, second] = [await createPoseEngine(model), await createPoseEngine(model)];

        first.setAnimation(0, PLAY, true);
        for (let i = 0; i < 20; i++) first.update(0.05);
        second.setAnimation(0, PLAY, true);
        for (let i = 0; i < 20; i++) second.update(0.05);
        expect(second.bytes).toBe(first.bytes);
        expect(Array.from(second.state.world)).toEqual(Array.from(first.state.world));
    });
});

describe('slider data the official 4.3 core fails on', () => {
    const errorOf = async (damage: (rig: Json, model: Awaited<ReturnType<typeof importSkeleton>>) => void) => {
        const model = await importSkeleton(TEXT);

        damage(RIG, model);

        return createPoseEngine(model).then(
            () => 'no error',
            (reason: unknown) => (reason instanceof MarrowError ? reason.message : `not a MarrowError: ${reason}`),
        );
    };
    const sliderOf = (model: Awaited<ReturnType<typeof importSkeleton>>, name: string) => {
        const found = model.constraints.find((each) => each.name === name);

        if (found?.type !== 'slider') throw new Error(`The rig has no slider ${name}`);

        return found;
    };

    it('names the slider and what it points at', async () => {
        const errors = await Promise.all([
            errorOf((_, model) => Object.assign(sliderOf(model, 'driven'), { property: null })),
            errorOf((_, model) => Object.assign(sliderOf(model, 'timed'), { animation: 40 })),
            errorOf((_, model) => {
                for (const timeline of model.animations[0]?.timelines ?? [])
                    if (timeline.kind === 'rgba') timeline.target = 9;
            }),
            errorOf((_, model) => {
                for (const timeline of model.animations[0]?.timelines ?? [])
                    if (timeline.kind === 'rotate') timeline.target = 77;
            }),
            errorOf((_, model) => {
                for (const timeline of model.animations[0]?.timelines ?? [])
                    if (timeline.kind === 'sliderMix') timeline.target = 0;
            }),
            errorOf((_, model) => {
                for (const timeline of model.animations[2]?.timelines ?? [])
                    if (timeline.kind === 'slider') timeline.target = -1;
            }),
        ]);

        expect(errors).toEqual([
            expect.stringContaining('The slider constraint "driven" has a bone and no property of it.'),
            expect.stringContaining(
                'The slider constraint "timed" plays animation 40, which the skeleton does not have.',
            ),
            expect.stringContaining(
                'The slider constraint "timed" points at an animation for slot 9, but the skeleton has 5 slots.',
            ),
            expect.stringContaining(
                'The slider constraint "timed" points at an animation for bone 77, but the skeleton has 6 bones.',
            ),
            expect.stringContaining(
                'Animation "inner" has a sliderMix timeline for constraint 0, which is no slider constraint.',
            ),
            expect.stringContaining(
                'Animation "third" has a slider timeline for constraint -1, which is no slider constraint.',
            ),
        ]);
    });
});
