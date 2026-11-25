import { Container, type Renderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { Pacer } from '../../src/api/pacing';
import { resolvePerf } from '../../src/api/presets';
import { MarrowSpine } from '../../src/index';
import { fixtureAsset } from './helpers';

/*
 * An update of 0 seconds applies a pose at once under any rate, and a skeleton that no update
 * drew is not paused by the box of its setup pose. Found with the `fast` preset: `update(0)`
 * did nothing, and a symbol whose setup pose lies elsewhere than its animation stayed paused.
 */

const SCREEN = { screen: { x: 0, y: 0, width: 800, height: 600 } } as unknown as Renderer;

/** Something shown and rendered with the box it covers on the screen. */
const at = (x: number, y: number, size: number) => ({
    visible: true,
    renderable: true,
    alpha: 1,
    parent: null,
    renderGroup: {},
    getBounds: () => ({ x, y, width: size, height: size }),
});

/** Tells a display object that a render reached it, as Pixi does through the child that watches. */
function rendered(spine: MarrowSpine): void {
    const watch = spine.children.find((child) => child.label === 'marrow-pacing');

    if (watch?.onRender == null) throw new Error('no child watches the renders');
    watch.onRender(SCREEN);
}

/** The box of a display object in its own space, rounded to pixels. */
function box(spine: MarrowSpine): number[] {
    const { x, y, width, height } = spine.getLocalBounds();

    return [x, y, width, height].map((value) => Math.round(value));
}

describe('an update of 0 seconds', () => {
    it('is due at once with the gathered time, and leaves the phase of the rate as it is', () => {
        const pacer = new Pacer(resolvePerf(undefined, { updateRate: 20 }));
        const steps = [1 / 60, 0, 1 / 60, 1 / 60, 0, 0].map((seconds) => pacer.take(seconds, false));

        // the third update of 1/60 is due as without the update of 0 between
        expect(steps.map((seconds) => (seconds < 0 ? -1 : Math.round(seconds * 60)))).toEqual([-1, 1, -1, 2, 0, 0]);
    });

    it('poses and draws a skeleton of the fast preset at once', async () => {
        const asset = await fixtureAsset('bzzz/animation_bee_big.skel');
        const spine = new MarrowSpine(asset, { autoUpdate: false, perf: 'fast' });
        const setup = box(spine);

        expect(spine.stats.renderMode).toBe('batched');
        expect(spine.pacingStatus().rate).toBe(30);
        // the animation moves the bee away from its setup pose
        spine.play('bottom', { loop: true });
        spine.update(1 / 60);
        expect(box(spine)).toEqual(setup);
        spine.update(0);
        const played = box(spine);

        expect(played).not.toEqual(setup);
        spine.stop();
        spine.setupPose();
        spine.update(0);
        expect(box(spine)).toEqual(setup);
        spine.destroy();
    });

    it('applies a bone set by hand at once', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/spineboy-pro.skel'), {
            autoUpdate: false,
            perf: 'fast',
        });
        const before = box(spine);

        spine.bone('root').x += 100;
        spine.update(0);
        expect(box(spine)[0]).toBe((before[0] ?? 0) + 100);
        spine.destroy();
    });

    it('poses and draws a paused skeleton too, and keeps it paused', async () => {
        const stage = new Container({ isRenderGroup: true });
        const spine = new MarrowSpine(await fixtureAsset('4.2/spineboy-pro.skel'), {
            autoUpdate: false,
            offscreen: 'pause',
        });

        stage.addChild(spine);
        spine.update(1 / 60);
        spine.position.set(-5000, 0);
        rendered(spine);
        expect(spine.pacingStatus().hidden).toBe(true);
        const update = vi.spyOn(spine.engine, 'update');

        spine.play('walk', { loop: true });
        spine.update(1 / 60);
        expect(update).not.toHaveBeenCalled();
        spine.update(0);
        expect(update).toHaveBeenCalledTimes(1);
        expect(spine.pacingStatus().hidden).toBe(true);
        spine.destroy();
    });
});

describe('a skeleton that no update drew', () => {
    it('counts as on the screen wherever the box of its setup pose is', () => {
        const pacer = new Pacer(resolvePerf(undefined, { offscreen: 'pause' }));

        pacer.seen(at(5000, 5000, 10), SCREEN);
        expect(pacer.paused).toBe(false);
        expect(pacer.take(1 / 60, false)).toBe(1 / 60);
        pacer.drew();
        pacer.seen(at(5000, 5000, 10), SCREEN);
        expect(pacer.paused).toBe(true);
    });

    it('still counts as off the screen when it is hidden', () => {
        const pacer = new Pacer(resolvePerf(undefined, { offscreen: 'pause' }));

        pacer.seen({ ...at(100, 100, 50), visible: false }, SCREEN);
        expect(pacer.paused).toBe(true);
    });

    it('is drawn once, then paused by the box of the drawn pose', async () => {
        const stage = new Container({ isRenderGroup: true });
        const spine = new MarrowSpine(await fixtureAsset('4.2/spineboy-pro.skel'), {
            autoUpdate: false,
            perf: 'fast',
        });
        const update = vi.spyOn(spine.engine, 'update');

        stage.addChild(spine);
        // the setup pose lies off the screen, and the game moves the skeleton on it in a later frame
        spine.position.set(-5000, 0);
        rendered(spine);
        expect(spine.pacingStatus().hidden).toBe(false);
        spine.play('walk', { loop: true });
        for (let frame = 0; frame < 2; frame++) spine.update(1 / 60);
        expect(update).toHaveBeenCalledTimes(1);
        rendered(spine);
        expect(spine.pacingStatus().hidden).toBe(true);
        spine.position.set(400, 300);
        rendered(spine);
        expect(spine.pacingStatus().hidden).toBe(false);
        spine.destroy();
    });
});
