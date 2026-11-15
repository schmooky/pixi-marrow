import { describe, expect, it } from 'vitest';
import {
    addBakedClips,
    bakeAnimation,
    bakeAnimations,
    bakedBytes,
    decodeBakedClips,
    encodeBakedClips,
} from '../../src/bake';
import { frameAt, frameCount } from '../../src/bake/clip';
import { playBaked } from '../../src/bake/playback';
import { bakesOf } from '../../src/bake/store';
import { MarrowError } from '../../src/core';
import { BAKE_RIGS, bakeable, DT, displayEngine, hostOf, modelOf } from './kit';

/*
 * The baker and the clips it makes: the frames, what is kept, the bytes, the errors, the bytes
 * of a file, and clips that a game hands to an asset.
 */

describe('the frames of a clip', () => {
    it('has one frame per sample below the duration and one at the duration', () => {
        expect(frameCount(1, 60)).toBe(61);
        expect(frameCount(1.01, 60)).toBe(62);
        expect(frameCount(0, 60)).toBe(1);
        // a duration a hair above a sample, as a 32-bit number of a file holds 16 / 60
        expect(frameCount(Math.fround(16 / 60), 60)).toBe(18);
    });

    it('shows the sample nearest to a time, and the last frame from the duration on', () => {
        const clip = { frames: 61, duration: 1, fps: 60 };

        expect(frameAt(clip, 0)).toBe(0);
        expect(frameAt(clip, 0.5)).toBe(30);
        expect(frameAt(clip, 0.5 - 1e-12)).toBe(30);
        expect(frameAt(clip, 0.5 - 1e-3)).toBe(30);
        expect(frameAt(clip, 0.5 + 1e-3)).toBe(30);
        expect(frameAt(clip, 0.5 - 0.6 / 60)).toBe(29);
        expect(frameAt(clip, 1 - 0.4 / 60)).toBe(60);
        expect(frameAt(clip, 1)).toBe(60);
        expect(frameAt(clip, 7)).toBe(60);
        expect(frameAt(clip, -1)).toBe(0);
        expect(Object.is(frameAt(clip, -0.001), 0)).toBe(true);
    });

    it('takes the last frame, at the duration, where it is nearer than the frame before', () => {
        // 0.99 seconds: frame 59 at 59 / 60, the last frame 60 at 0.99, the middle at 0.98667
        const clip = { frames: frameCount(0.99, 60), duration: 0.99, fps: 60 };

        expect(clip.frames).toBe(61);
        expect(frameAt(clip, 0.985)).toBe(59);
        expect(frameAt(clip, 0.9866)).toBe(59);
        expect(frameAt(clip, 0.9868)).toBe(60);
        expect(frameAt(clip, 0.98999)).toBe(60);
        expect(frameAt({ frames: 1, duration: 0, fps: 60 }, 0)).toBe(0);
        expect(frameAt({ frames: 2, duration: 0.01, fps: 60 }, 0.004)).toBe(0);
        expect(frameAt({ frames: 2, duration: 0.01, fps: 60 }, 0.006)).toBe(1);
    });

    it('shows each frame once for the ticks of a 60 Hz display with jitter in their timestamps', () => {
        const clip = { frames: frameCount(4, 60), duration: 4, fps: 60 };
        let seed = 7;
        // a fixed sequence, from -0.5 to 0.5 milliseconds
        const noise = (): number => {
            seed = (seed * 1103515245 + 12345) % 2 ** 31;

            return (seed / 2 ** 31 - 0.5) / 1000;
        };
        let time = 0;
        let before = 0;
        let stamp = 0;

        for (let tick = 1; tick < 240; tick++) {
            const next = tick / 60 + noise();

            // the delta between two timestamps, summed as the engine sums its updates
            time += next - stamp;
            stamp = next;
            const frame = frameAt(clip, time);

            expect(frame, `tick ${tick}`).toBe(before + 1);
            before = frame;
        }
    });
});

describe('baked playback at the ticks of a display', () => {
    it('shows the next frame in every update of a 60 Hz display with jitter in its timestamps', async () => {
        const model = await modelOf('4.2/spineboy-pro.skel');
        const host = await hostOf(model);
        const engine = displayEngine(host);
        const tally = playBaked(host, engine, null);
        const walk = model.animations.findIndex(({ name }) => name === 'walk');
        let seed = 11;
        // a fixed sequence, from -0.5 to 0.5 milliseconds
        const noise = (): number => {
            seed = (seed * 1103515245 + 12345) % 2 ** 31;

            return (seed / 2 ** 31 - 0.5) / 1000;
        };
        /** True when the engine shows frame `frame` of the clip for every bone the clip moves. */
        const shows = (frame: number): boolean => {
            const clip = bakesOf(model).find(engine.state.skin, walk, null)?.clip;
            const { world } = engine.state;

            return (
                clip !== undefined &&
                Array.from(clip.bones).every((bone, j) =>
                    [0, 1, 2, 3, 4, 5].every(
                        (i) => world[bone * 6 + i] === clip.world[(frame * clip.bones.length + j) * 6 + i],
                    ),
                )
            );
        };
        let stamp = 0;
        const tick = (at: number): void => {
            const next = at / 60 + noise();

            engine.update(next - stamp);
            stamp = next;
        };

        engine.setAnimation(0, walk, false);
        // posed by the engine, which bakes the clip, then baked
        tick(1);
        tick(2);
        const frames = bakesOf(model).find(engine.state.skin, walk, null)?.clip.frames ?? 0;

        expect(frames).toBeGreaterThan(40);
        for (let at = 3; at < frames - 2; at++) {
            tick(at);
            expect(shows(at), `update ${at}`).toBe(true);
        }
        expect(tally.baked).toBe(frames - 4);
    });
});

describe('bakeAnimation', () => {
    it.each(['4.1/spineboy-pro.skel', '4.2/spineboy-pro.skel', '4.3/spineboy-pro.skel'])(
        '%s: keeps the bones and the slot values that move, and reports its bytes',
        async (id) => {
            const model = await modelOf(id);
            const idle = await bakeAnimation(model, 'idle');
            const shoot = await bakeAnimation(model, 'shoot', { fps: 30 });

            expect(idle.frames).toBe(
                frameCount(model.animations.find(({ name }) => name === 'idle')?.duration ?? 0, 60),
            );
            expect(shoot.fps).toBe(30);
            // idle leaves the gun alone, shoot moves few bones
            expect(idle.bones.length).toBeGreaterThan(10);
            expect(idle.bones.length).toBeLessThan(model.bones.count);
            expect(shoot.bones.length).toBeLessThan(idle.bones.length);
            expect(idle.world.length).toBe(idle.frames * idle.bones.length * 6);
            expect(bakedBytes(idle)).toBe(
                idle.world.byteLength +
                    idle.bones.byteLength +
                    idle.placement.byteLength +
                    idle.colors.byteLength +
                    idle.colorSlots.byteLength +
                    idle.colorMasks.byteLength +
                    idle.attachments.byteLength +
                    idle.attachmentSlots.byteLength +
                    idle.deforms.byteLength +
                    idle.deformStarts.byteLength +
                    idle.deformLengths.byteLength +
                    idle.deformSlots.byteLength +
                    idle.drawOrders.byteLength +
                    idle.drawOrderFrames.byteLength +
                    idle.sequences.byteLength +
                    idle.sequenceSlots.byteLength +
                    idle.darkColors.byteLength +
                    idle.darkSlots.byteLength +
                    idle.darkMasks.byteLength,
            );
            expect(Array.from(idle.placement)).toEqual([0, 0, 1, -1]);
            expect((await bakeAnimations(model)).map(({ animation }) => animation)).toEqual(
                model.animations.map(({ name }) => name),
            );
        },
    );

    it('keeps an attachment, a deform, a color and a draw order that change', async () => {
        const kept = { attachments: 0, deforms: 0, colors: 0, orders: 0 };

        for (const fixture of BAKE_RIGS.filter(({ version }) => version === '4.2')) {
            const model = await modelOf(fixture.id);

            if (!bakeable(model)) continue;
            for (const clip of await bakeAnimations(model)) {
                kept.attachments += clip.attachmentSlots.length;
                kept.deforms += clip.deformSlots.length;
                kept.colors += clip.colorSlots.length;
                kept.orders += clip.drawOrderFrames.length > 0 ? 1 : 0;
            }
        }
        expect(kept.attachments).toBeGreaterThan(0);
        expect(kept.deforms).toBeGreaterThan(0);
        expect(kept.colors).toBeGreaterThan(0);
        expect(kept.orders).toBeGreaterThan(0);
    });

    it('throws for a name the skeleton lacks, a rate that is none and a rig with physics', async () => {
        const model = await modelOf('4.2/spineboy-pro.skel');
        const missing = await bakeAnimation(model, 'idel').catch((error: unknown) => error);

        expect(missing).toBeInstanceOf(MarrowError);
        expect((missing as MarrowError).code).toBe('unknown-name');
        expect((missing as MarrowError).closest).toBe('idle');
        expect((missing as MarrowError).validNames).toContain('run');
        await expect(bakeAnimation(model, 'idle', { skins: ['nope'] })).rejects.toThrow(/no skin "nope"/);
        await expect(bakeAnimation(model, 'idle', { fps: 0 })).rejects.toThrow(MarrowError);
        const physics = await modelOf('4.2/cloud-pot.skel');

        expect(bakeable(physics)).toBe(false);
        await expect(bakeAnimation(physics, 0)).rejects.toThrow(/physics constraint/);
    });
});

describe('baked clips as bytes', () => {
    it('reads back what it wrote', async () => {
        const clips = [
            ...(await bakeAnimations(await modelOf('4.2/spineboy-pro.skel'))),
            ...(await bakeAnimations(await modelOf('4.3/dragon-ess.skel'))),
        ];
        const bytes = encodeBakedClips(clips);
        // a view into a larger buffer at an odd place reads the same
        const shifted = new Uint8Array(bytes.length + 3);

        shifted.set(bytes, 3);
        expect(decodeBakedClips(bytes)).toEqual(clips);
        expect(decodeBakedClips(shifted.subarray(3))).toEqual(clips);
        expect(bytes.length).toBeLessThan(clips.reduce((sum, clip) => sum + bakedBytes(clip), 0) + 40_000);
    });

    it('throws for bytes that are no baked clips', async () => {
        const bytes = encodeBakedClips([await bakeAnimation(await modelOf('4.2/spineboy-pro.skel'), 'idle')]);

        expect(() => decodeBakedClips(new Uint8Array(4))).toThrow(MarrowError);
        expect(() => decodeBakedClips(bytes.subarray(0, 40))).toThrow(MarrowError);
        expect(() => decodeBakedClips(bytes.subarray(0, bytes.length - 8))).toThrow(/runs past the end/);
        const other = bytes.slice();

        other[4] = 9;
        expect(() => decodeBakedClips(other)).toThrow(/format 9/);
    });
});

describe('addBakedClips', () => {
    it('hands clips to the instances of an asset, which play them', async () => {
        const model = await modelOf('4.3/raptor-pro.skel');
        const host = await hostOf(model);
        const walk = model.animations.findIndex(({ name }) => name === 'walk');
        const clip = decodeBakedClips(encodeBakedClips([await bakeAnimation(model, walk)]))[0];

        if (clip === undefined) throw new Error('no clip');
        addBakedClips({ model }, [clip]);
        expect(bakesOf(model).find(-1, walk, null)?.clip).toBe(clip);
        const engine = displayEngine(host);
        const tally = playBaked(host, engine, [walk]);

        engine.setAnimation(0, walk, true);
        for (let i = 0; i < 20; i++) engine.update(DT);
        expect(tally.baked).toBe(19);
        // an animation the list leaves out plays without baking
        engine.setAnimation(0, 0, true);
        for (let i = 0; i < 20; i++) engine.update(DT);
        expect(tally.baked).toBe(19);
        expect(tally.last).toContain('not in the list');
        expect(bakesOf(model).bytes).toBeGreaterThanOrEqual(bakedBytes(clip));
    });

    it('throws for a clip of another skeleton', async () => {
        const spineboy = await bakeAnimation(await modelOf('4.2/spineboy-pro.skel'), 'idle');
        const raptor = await modelOf('4.2/raptor-pro.skel');

        expect(() => addBakedClips({ model: raptor }, [spineboy])).toThrow(MarrowError);
        expect(() => addBakedClips({ model: raptor }, [{ ...spineboy, animation: 'roar', boneCount: 1 }])).toThrow(
            /bones/,
        );
    });

    it('plays a clip baked at another place of the skeleton without it', async () => {
        const model = await modelOf('4.1/spineboy-pro.skel');
        const host = await hostOf(model);

        addBakedClips({ model }, [await bakeAnimation(model, 'run', { placement: [0, 0, 1, 1] })]);
        const engine = displayEngine(host);
        const tally = playBaked(host, engine, null);

        engine.setAnimation(
            0,
            model.animations.findIndex(({ name }) => name === 'run'),
            true,
        );
        for (let i = 0; i < 5; i++) engine.update(DT);
        expect(tally.baked).toBe(0);
        expect(tally.last).toContain('another placement');
    });
});
