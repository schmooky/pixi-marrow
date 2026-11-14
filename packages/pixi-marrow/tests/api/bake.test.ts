import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { BakeTally } from '../../src/bake/playback';
import type { PoseSource } from '../../src/core';
import { type MarrowAsset, MarrowError, MarrowSpine, type Track } from '../../src/index';
import { FRAME, fixtureAsset, VERSIONS } from './helpers';

/*
 * The `bake` setting of a display object: the code of baked playback loads on demand, the object
 * plays without it until it is there, and then plays baked where it can, with the events of an
 * object that does not bake.
 */

/** Waits until the chunk of baked playback is there and the objects that asked for it took it. */
async function codeLoaded(): Promise<void> {
    await import('../../src/bake/playback');
    await new Promise((resolve) => setTimeout(resolve, 0));
}

/** True for the source that baked playback gives an engine: it keeps a tally. */
const isTally = (source: PoseSource | null): source is PoseSource & BakeTally =>
    source !== null && 'baked' in source && typeof source.baked === 'number';

const tallyOf = (source: PoseSource | null): BakeTally | undefined => (isTally(source) ? source : undefined);

describe.each(VERSIONS)('baked playback of a Spine %s display object', (version) => {
    let asset: MarrowAsset;
    const made: MarrowSpine[] = [];
    const create = (options: ConstructorParameters<typeof MarrowSpine>[1] = {}): MarrowSpine => {
        const spine = new MarrowSpine(asset, { autoUpdate: false, ...options });

        made.push(spine);

        return spine;
    };

    beforeAll(async () => {
        asset = await fixtureAsset(`${version}/spineboy-pro.skel`);
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
    });

    it('loads its code on demand, then plays baked with the events of an object that does not', async () => {
        const baked = create({ bake: 'auto' });
        const plain = create();
        const seen = { baked: [] as string[], plain: [] as string[] };

        for (const [spine, list] of [
            [baked, seen.baked],
            [plain, seen.plain],
        ] as const) {
            for (const type of ['start', 'complete', 'end'] as const) {
                spine.on(type, (track: Track) => list.push(`${type} ${track.animation}`));
            }
            spine.on('event', (event) => list.push(`event ${event.name}`));
        }
        // the code is not there yet: the object plays as without baking
        expect(baked.engine.source).toBeNull();
        await codeLoaded();
        expect(tallyOf(baked.engine.source)).toBeDefined();
        expect(plain.engine.source).toBeNull();
        for (const spine of [baked, plain]) spine.play('walk', { loop: true });
        for (let i = 0; i < 90; i++) {
            baked.update(FRAME);
            plain.update(FRAME);
        }
        expect(seen.baked).toEqual(seen.plain);
        expect(seen.plain).toContain('complete walk');
        expect(tallyOf(baked.engine.source)?.baked).toBe(89);
        // the first walk loop of 60 frames ends on a sample: the pose is the frame
        const world = (spine: MarrowSpine) => Array.from(spine.engine.state.world, (value) => Math.fround(value));

        for (const spine of [baked, plain]) spine.play('run', { loop: false });
        for (let i = 0; i < 12; i++) {
            baked.update(FRAME);
            plain.update(FRAME);
        }
        expect(world(baked)).toEqual(world(plain));
        expect(baked.stats.renderMode).toBe(plain.stats.renderMode);
    });

    it('bakes the animations of a list, and throws for a name the skeleton lacks', async () => {
        const spine = create({ bake: ['run'] });

        await codeLoaded();
        spine.play('walk', { loop: true });
        for (let i = 0; i < 10; i++) spine.update(FRAME);
        expect(tallyOf(spine.engine.source)?.baked).toBe(0);
        spine.play('run', { loop: true });
        for (let i = 0; i < 10; i++) spine.update(FRAME);
        expect(tallyOf(spine.engine.source)?.baked).toBeGreaterThan(5);
        const wrong = (() => {
            try {
                create({ bake: ['run', 'wlak'] });
            } catch (error) {
                return error;
            }

            return undefined;
        })();

        expect(wrong).toBeInstanceOf(MarrowError);
        expect((wrong as MarrowError).code).toBe('unknown-name');
        expect((wrong as MarrowError).closest).toBe('walk');
        expect((wrong as MarrowError).validNames).toEqual(asset.model.animations.map(({ name }) => name));
    });

    it('says in the perf report what baked playback did', async () => {
        const baked = create({ bake: 'auto' });
        const plain = create();

        await codeLoaded();
        for (const spine of [baked, plain]) spine.play('run', { loop: true });
        for (let i = 0; i < 5; i++) for (const spine of [baked, plain]) spine.update(FRAME);
        const row = async (spine: MarrowSpine) => (await spine.perf.report()).find(({ feature }) => feature === 'bake');

        expect(await row(baked)).toMatchObject({ value: '4 of 5 updates baked' });
        expect((await row(baked))?.reason).toMatch(
            /^last update: "run" baked\. The baked clips of the asset take \d+\.\d KB$/,
        );
        expect(await row(plain)).toMatchObject({ value: 'off' });
    });

    it('bakes when bake is set by name, and not with a preset or the default', async () => {
        const named = create({ perf: 'balanced', bake: 'auto' });
        const balanced = create({ perf: 'balanced' });
        const fast = create({ perf: 'fast' });
        const exact = create();

        await codeLoaded();
        expect(tallyOf(named.engine.source)).toBeDefined();
        expect(balanced.engine.source).toBeNull();
        expect(fast.engine.source).toBeNull();
        expect(exact.engine.source).toBeNull();
    });

    it('leaves an object that was destroyed before its code came alone', async () => {
        const spine = create({ bake: 'auto' });

        made.splice(made.indexOf(spine), 1);
        spine.destroy();
        await codeLoaded();
        expect(() => spine.update(FRAME)).not.toThrow();
    });
});
