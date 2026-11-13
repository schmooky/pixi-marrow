import { SilkGraphics } from 'pixi-silk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { viewOf } from '../../src/api/view-of';
import { DEBUG_LAYERS, MarrowDebug } from '../../src/debug';
import { drawnTriangles } from '../../src/debug/drawn';
import { MarrowError, MarrowSpine } from '../../src/index';
import { FRAME, fixtureAsset } from '../api/helpers';

/*
 * The overlay object: which layers draw, when it draws again, what it leaves behind. That the
 * shapes are the official ones is shapes.test.ts.
 */

/** The SilkGraphics children of an overlay: the heat, the lines and the dots, in that order. */
function layersOf(debug: MarrowDebug): SilkGraphics[] {
    return debug.children.filter((child): child is SilkGraphics => child instanceof SilkGraphics);
}

const primitives = (debug: MarrowDebug): number[] => layersOf(debug).map((g) => g.primitiveCount);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('a debug overlay', () => {
    it('draws the default layers on top of the skeleton, and more when a layer is turned on', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/spineboy-pro.skel'), { autoUpdate: false });
        const debug = new MarrowDebug(spine);

        spine.update(FRAME);
        debug.refresh();
        expect(spine.children.at(-1)).toBe(debug);
        const [heat = 0, lines = 0, dots = 0] = primitives(debug);

        expect(heat).toBe(0);
        expect(lines).toBeGreaterThan(0);
        expect(dots).toBeGreaterThan(0);
        debug.layers.meshTriangles = true;
        debug.refresh();
        expect(primitives(debug)[1]).toBeGreaterThan(lines);
        // nothing at all
        for (const layer of Object.keys(DEBUG_LAYERS) as (keyof typeof DEBUG_LAYERS)[]) debug.layers[layer] = false;
        debug.refresh();
        expect(primitives(debug)).toEqual([0, 0, 0]);
        spine.destroy();
    });

    it('draws again only when the pose, a layer or the width changed', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/spineboy-pro.skel'), { autoUpdate: false });
        const debug = new MarrowDebug(spine);
        const clears = vi.spyOn(SilkGraphics.prototype, 'clear');

        spine.update(FRAME);
        debug.refresh();
        const once = clears.mock.calls.length;

        expect(once).toBeGreaterThan(0);
        // a skeleton at rest: one check, no drawing
        debug.refresh();
        debug.refresh();
        expect(clears.mock.calls.length).toBe(once);
        spine.play('walk', { loop: true });
        spine.update(FRAME);
        debug.refresh();
        expect(clears.mock.calls.length).toBe(once * 2);
        debug.lineWidth = 2;
        debug.refresh();
        expect(clears.mock.calls.length).toBe(once * 3);
        spine.destroy();
    });

    it('fills every triangle the skeleton draws in the overdraw layer', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/tank-pro.skel'), { autoUpdate: false });
        const debug = new MarrowDebug(spine, { layers: { overdraw: true, regions: false, meshHulls: false } });

        spine.update(FRAME);
        debug.refresh();
        const view = viewOf(spine);

        if (view === undefined) throw new Error('no view');
        const triangles = drawnTriangles(view).length / 6;

        expect(triangles).toBeGreaterThan(0);
        expect(primitives(debug)[0]).toBe(triangles);
        expect(layersOf(debug)[0]?.blendMode).toBe('add');
        spine.destroy();
    });

    it('labels the events that fire, and lets the labels go after a second', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/spineboy-pro.skel'), { autoUpdate: false });
        const debug = new MarrowDebug(spine, { layers: { events: true } });
        const labels = debug.children.at(-1);
        let now = 1000;

        vi.spyOn(performance, 'now').mockImplementation(() => now);
        spine.play('walk', { loop: true });
        for (let i = 0; i < 40; i++) {
            spine.update(1 / 30);
            debug.refresh();
        }
        // the walk of spineboy fires footstep events
        expect(labels?.children.length).toBeGreaterThan(0);
        now += 1500;
        debug.refresh();
        expect(labels?.children.length).toBe(0);
        spine.destroy();
    });

    it('throws for a layer it does not have', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/coin-pro.skel'), { autoUpdate: false });
        const make = () => new MarrowDebug(spine, { layers: { bonez: true } as never });

        expect(make).toThrow(MarrowError);
        expect(make).toThrow(/no layer "bonez"/);
        spine.destroy();
    });

    it('lets go of the skeleton when it is destroyed', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/coin-pro.skel'), { autoUpdate: false });
        const before = spine.listenerCount('event');
        const debug = new MarrowDebug(spine);

        expect(spine.listenerCount('event')).toBe(before + 1);
        debug.destroy();
        expect(spine.listenerCount('event')).toBe(before);
        expect(spine.children).not.toContain(debug);
        spine.destroy();
    });
});
