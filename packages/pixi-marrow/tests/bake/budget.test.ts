import { beforeAll, describe, expect, it, vi } from 'vitest';
import { addBakedClips, type BakedClip, bakeAnimation, bakedBytes, setBakeBudget } from '../../src/bake';
import { playBaked } from '../../src/bake/playback';
import { BAKE_BUDGET, type Baker, bakesOf, type ModelBakes } from '../../src/bake/store';
import { importSkeleton, loadPoseEngine, MarrowError, type SkeletonModel } from '../../src/core';
import { MarrowSpine } from '../../src/index';
import { animationIndex, fixtureAsset, fixtureFiles } from '../api/helpers';

/*
 * The byte budget of the clips that a game bakes while it plays, found in an audit: 50 symbols
 * with 10 clips each held 9 to 69 MB, per skin, for the life of the asset.
 */

/** The updates after which a clip that nobody played counts as out of use: `RECENT` of store.ts. */
const RECENT = 600;
const NAMES = ['walk', 'run', 'jump', 'idle'] as const;

describe('the byte budget of baked clips', () => {
    const clips = new Map<string, BakedClip>();
    let bytes: Record<(typeof NAMES)[number], number>;

    /** A model of its own, so that every test has a store of its own. */
    async function fresh(): Promise<{ model: SkeletonModel; bakes: ModelBakes; bake: Baker; baked: string[] }> {
        const model = await importSkeleton(fixtureFiles('4.2/spineboy-pro.skel').skeleton);
        const baked: string[] = [];
        // a bake that answers at once, with a clip that was baked before
        const bake: Baker = (animation, _, done) => {
            const name = model.animations[animation]?.name ?? '';

            baked.push(name);
            done(clips.get(name) ?? new Error(`no clip of ${name}`));
        };

        return { model, bakes: bakesOf(model), bake, baked };
    }

    /** Uses the clips of a store without one of them playing, so that every clip is out of use. */
    function age(model: SkeletonModel, bakes: ModelBakes): void {
        const other = animationIndex(model, 'death');

        for (let i = 0; i <= RECENT; i++) bakes.find(-1, other, null);
    }

    beforeAll(async () => {
        const model = await importSkeleton(fixtureFiles('4.2/spineboy-pro.skel').skeleton);

        for (const name of NAMES) clips.set(name, await bakeAnimation(model, name));
        bytes = Object.fromEntries(
            NAMES.map((name) => [name, bakedBytes(clips.get(name) as BakedClip)]),
        ) as typeof bytes;
    });

    it('is 4 MB per model until it is set', async () => {
        const { model, bakes } = await fresh();

        expect(BAKE_BUDGET).toBe(4 * 1024 * 1024);
        expect(bakes.budget).toBe(BAKE_BUDGET);
        setBakeBudget({ model }, 1024);
        expect(bakes.budget).toBe(1024);
    });

    it('lets the clip go that played longest ago when a new one needs the room', async () => {
        const { model, bakes, bake, baked } = await fresh();
        const [walk, run, jump] = ['walk', 'run', 'jump'].map((name) => animationIndex(model, name)) as [
            number,
            number,
            number,
        ];

        bakes.budget = bytes.walk + bytes.run + bytes.jump - 1;
        expect(bakes.find(-1, walk, bake)?.clip).toBe(clips.get('walk'));
        expect(bakes.find(-1, run, bake)?.clip).toBe(clips.get('run'));
        age(model, bakes);
        // run played since, walk did not
        bakes.find(-1, run, bake);
        age(model, bakes);
        expect(bakes.find(-1, jump, bake)?.clip).toBe(clips.get('jump'));
        expect(bakes.evicted).toBe(1);
        expect(bakes.bytes).toBe(bytes.run + bytes.jump);
        expect(bakes.find(-1, run, null)?.clip).toBe(clips.get('run'));
        // the clip that went is baked again when its animation next plays alone
        expect(bakes.find(-1, walk, null)).toBeNull();
        expect(baked).toEqual(['walk', 'run', 'jump']);
    });

    it('never lets a clip in use go: a new clip without room is dropped, and asks again later', async () => {
        const { model, bakes, bake, baked } = await fresh();
        const [walk, run] = ['walk', 'run'].map((name) => animationIndex(model, name)) as [number, number];

        bakes.budget = bytes.walk + bytes.run - 1;
        const held = bakes.find(-1, walk, bake);

        if (held === null) throw new Error('walk bakes');
        expect(bakes.find(-1, run, bake)).toBeNull();
        expect(bakes.reason(-1, run)).toBe('its clip does not fit the byte budget of the baked clips');
        expect(bakes.bytes).toBe(bytes.walk);
        // while walk plays, run does not bake again and again
        for (let i = 0; i < RECENT * 3; i++) {
            bakes.touch(held);
            expect(bakes.find(-1, run, bake)).toBeNull();
        }
        expect(baked).toEqual(['walk', 'run']);
        expect(bakes.evicted).toBe(0);
        // walk stops playing: after a while run finds room
        for (let i = 0; i <= RECENT; i++) bakes.find(-1, run, bake);
        expect(bakes.find(-1, run, bake)?.clip).toBe(clips.get('run'));
        expect(bakes.reason(-1, run)).toBeUndefined();
        expect(bakes.evicted).toBe(1);
        expect(bakes.bytes).toBe(bytes.run);
    });

    it('does not count the clips a game handed over, and never lets them go', async () => {
        const { model, bakes, bake } = await fresh();
        const [walk, run] = ['walk', 'run'].map((name) => animationIndex(model, name)) as [number, number];

        addBakedClips({ model }, [clips.get('walk') as BakedClip]);
        setBakeBudget({ model }, bytes.run);
        expect(bakes.find(-1, walk, bake)?.given).toBe(true);
        age(model, bakes);
        expect(bakes.find(-1, run, bake)?.given).toBe(false);
        expect(bakes.evicted).toBe(0);
        expect(bakes.bytes).toBe(bytes.walk + bytes.run);
        setBakeBudget({ model }, 0);
        age(model, bakes);
        setBakeBudget({ model }, 0);
        expect(bakes.find(-1, walk, null)?.clip).toBe(clips.get('walk'));
        expect(bakes.bytes).toBe(bytes.walk);
    });

    it('lets clips out of use go at once when the budget shrinks', async () => {
        const { model, bakes, bake } = await fresh();

        for (const name of NAMES) bakes.find(-1, animationIndex(model, name), bake);
        expect(bakes.bytes).toBe(bytes.walk + bytes.run + bytes.jump + bytes.idle);
        setBakeBudget({ model }, bytes.idle);
        // all four were looked at a moment ago
        expect(bakes.evicted).toBe(0);
        age(model, bakes);
        bakes.find(-1, animationIndex(model, 'idle'), bake);
        setBakeBudget({ model }, bytes.idle);
        expect(bakes.evicted).toBe(3);
        expect(bakes.bytes).toBe(bytes.idle);
    });

    it('throws for a budget that is no number of bytes', async () => {
        const { model, bakes } = await fresh();

        for (const wrong of [-1, Number.NaN, '4MB', undefined]) {
            const call = (): void => Reflect.apply(setBakeBudget, undefined, [{ model }, wrong]);

            expect(call).toThrow(MarrowError);
            expect(call).toThrow(/setBakeBudget got/);
        }
        expect(bakes.budget).toBe(BAKE_BUDGET);
    });

    it('counts the updates that play a clip as its use, and reports the budget in the tally', async () => {
        const { model, bakes } = await fresh();
        const createEngine = await loadPoseEngine(model);
        const engine = createEngine();

        // as a display object sets its engine up, which is where a clip is baked by default
        engine.state.scaleY = -1;
        engine.state.yDown = true;
        const tally = playBaked({ model, createEngine, bakeLater: (work) => void work.step() }, engine, null);
        const touch = vi.spyOn(bakes, 'touch');

        addBakedClips({ model }, [clips.get('walk') as BakedClip]);
        engine.setAnimation(0, animationIndex(model, 'walk'), true);
        for (let i = 0; i < 5; i++) engine.update(1 / 60);
        expect(tally.baked).toBe(4);
        expect(touch).toHaveBeenCalledTimes(4);
        expect(tally.budget).toBe(BAKE_BUDGET);
        expect(tally.evicted).toBe(0);
        expect(tally.bytes).toBe(bytes.walk);
    });
});

describe('perf.memory() of a display object that bakes', () => {
    it('reports the bytes of the baked clips and their budget', async () => {
        const asset = await fixtureAsset('4.2/spineboy-pro.skel');
        const spine = new MarrowSpine(asset, { autoUpdate: false, bake: 'auto' });
        const plain = new MarrowSpine(asset, { autoUpdate: false });

        await import('../../src/bake/playback');
        await new Promise((resolve) => setTimeout(resolve, 0));
        addBakedClips(asset, [await bakeAnimation(asset.model, 'walk')]);
        setBakeBudget(asset, 123456);
        const memory = await spine.perf.memory();

        expect(memory.baked).toBe(bakesOf(asset.model).bytes);
        expect(memory.baked).toBeGreaterThan(0);
        expect(memory.bakeBudget).toBe(123456);
        expect(memory.shared).toBeGreaterThan(memory.baked);
        expect(await plain.perf.memory()).toMatchObject({ baked: 0, bakeBudget: 0 });
        spine.destroy();
        plain.destroy();
    });
});
