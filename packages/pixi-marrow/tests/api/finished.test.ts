import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type MarrowAsset, MarrowSpine } from '../../src/index';
import { FRAME, fixtureAsset, VERSIONS } from './helpers';

/** True when a promise has resolved by now. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
    const pending = Symbol('pending');

    return (await Promise.race([promise, Promise.resolve(pending)])) !== pending;
}

describe.each(VERSIONS)('Track.finished of a Spine %s skeleton', (version) => {
    let asset: MarrowAsset;
    const made: MarrowSpine[] = [];

    function create(): MarrowSpine {
        const spine = new MarrowSpine(asset, { autoUpdate: false });

        made.push(spine);

        return spine;
    }

    function steps(spine: MarrowSpine, count: number): void {
        for (let i = 0; i < count; i++) spine.update(FRAME);
    }

    beforeAll(async () => {
        asset = await fixtureAsset(`${version}/spineboy-pro.skel`);
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
        vi.restoreAllMocks();
    });

    it('resolves when an animation that plays once reaches its end', async () => {
        const spine = create();
        const shoot = spine.play('shoot');

        steps(spine, 30);
        expect(await settled(shoot.finished)).toBe(false);
        steps(spine, 10);
        expect(await settled(shoot.finished)).toBe(true);
        await expect(shoot.finished).resolves.toBeUndefined();
    });

    it('is one promise, also when it is first read after the end', async () => {
        const spine = create();
        const early = spine.play('shoot');
        const late = spine.play('shoot', { track: 1 });
        const promise = early.finished;

        steps(spine, 45);

        expect(early.finished).toBe(promise);
        expect(late.finished).toBe(late.finished);
        expect(await settled(late.finished)).toBe(true);
    });

    it('does not resolve when a looping animation completes a loop', async () => {
        const spine = create();
        const completed = vi.fn();
        const run = spine.play('run', { loop: true });

        spine.on('complete', completed);
        steps(spine, 100);

        expect(completed).toHaveBeenCalledTimes(2);
        expect(await settled(run.finished)).toBe(false);
    });

    it('resolves at the next completed loop once the loop is turned off', async () => {
        const spine = create();
        const run = spine.play('run', { loop: true });

        steps(spine, 50);
        run.loop = false;
        expect(await settled(run.finished)).toBe(false);
        steps(spine, 50);

        expect(await settled(run.finished)).toBe(true);
    });

    it('resolves for an interrupted animation when it has mixed out', async () => {
        const spine = create();

        spine.defaultMix = 0.2;
        const walk = spine.play('walk');
        steps(spine, 6);
        spine.play('run', { loop: true });
        steps(spine, 6);
        expect(await settled(walk.finished)).toBe(false);
        steps(spine, 10);

        expect(await settled(walk.finished)).toBe(true);
    });

    it('resolves for an interrupted animation without a mix within two updates', async () => {
        const spine = create();
        const walk = spine.play('walk');

        steps(spine, 6);
        spine.play('run', { loop: true });
        expect(await settled(walk.finished)).toBe(false);
        steps(spine, 2);

        expect(await settled(walk.finished)).toBe(true);
    });

    it('resolves at once for a stopped animation', async () => {
        const spine = create();
        const walk = spine.play('walk', { loop: true });
        const shoot = spine.play('shoot', { track: 1 });
        const aim = spine.queue('aim', { track: 1 });

        steps(spine, 6);
        spine.stop({ track: 1 });

        expect(await settled(shoot.finished)).toBe(true);
        expect(await settled(aim.finished)).toBe(true);
        expect(await settled(walk.finished)).toBe(false);
        spine.stop();
        expect(await settled(walk.finished)).toBe(true);
    });

    it('resolves for an animation stopped with a mix when the mix is over', async () => {
        const spine = create();
        const walk = spine.play('walk', { loop: true });

        steps(spine, 6);
        walk.stop({ mix: 0.2 });
        steps(spine, 6);
        expect(await settled(walk.finished)).toBe(false);
        steps(spine, 10);

        expect(await settled(walk.finished)).toBe(true);
    });

    it('resolves for a queued animation that is dropped before it starts', async () => {
        const spine = create();

        spine.play('walk', { loop: true });
        const run = spine.queue('run');
        steps(spine, 3);
        expect(await settled(run.finished)).toBe(false);
        spine.play('idle');

        expect(await settled(run.finished)).toBe(true);
    });

    it('resolves for every track when the display object is destroyed', async () => {
        const spine = create();
        const walk = spine.play('walk', { loop: true });
        const run = spine.queue('run', { loop: true });
        const disposed = vi.fn();

        spine.on('dispose', disposed);
        steps(spine, 3);
        spine.destroy();

        expect(await settled(walk.finished)).toBe(true);
        expect(await settled(run.finished)).toBe(true);
        expect(disposed).not.toHaveBeenCalled();
    });
});
