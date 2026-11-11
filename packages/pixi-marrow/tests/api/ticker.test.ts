import type { Ticker } from 'pixi.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type MarrowAsset, MarrowSpine } from '../../src/index';
import { fixtureAsset, holdTicker } from './helpers';

describe('MarrowSpine.autoUpdate', () => {
    let asset: MarrowAsset;
    let ticker: Ticker;
    let listeners: number;
    let now: number;
    const made: MarrowSpine[] = [];

    function create(options?: { autoUpdate?: boolean }): MarrowSpine {
        const spine = new MarrowSpine(asset, options);

        made.push(spine);

        return spine;
    }

    /** Advances Pixi's shared ticker by hand, as an animation frame would. */
    function tick(milliseconds: number): void {
        now += milliseconds;
        ticker.update(now);
    }

    beforeAll(async () => {
        asset = await fixtureAsset('4.2/spineboy-pro.skel');
        ticker = holdTicker();
    });

    beforeEach(() => {
        listeners = ticker.count;
        // a first update, so that the next one measures from a known time
        now = ticker.lastTime + 1000;
        ticker.update(now);
    });

    afterEach(() => {
        for (const spine of made.splice(0)) spine.destroy();
        ticker.speed = 1;
        vi.restoreAllMocks();
    });

    it('is on by default: the shared ticker updates the object with the seconds that passed', () => {
        const spine = create();
        const update = vi.spyOn(spine, 'update');
        const walk = spine.play('walk', { loop: true });

        expect(spine.autoUpdate).toBe(true);
        expect(ticker.count).toBe(listeners + 1);
        tick(16);
        tick(40);

        expect(update.mock.calls).toEqual([[0.016], [0.04]]);
        expect(walk.time).toBeCloseTo(0.056, 10);
        expect(spine.engine.state.time).toBeCloseTo(0.056, 10);
    });

    it('follows the speed of the ticker and its longest frame', () => {
        const spine = create();
        const update = vi.spyOn(spine, 'update');

        ticker.speed = 2;
        tick(16);
        ticker.speed = 1;
        // Pixi caps a frame at 100 ms, so a tab that was hidden does not jump ahead
        tick(5000);

        expect(update.mock.calls).toEqual([[0.032], [0.1]]);
    });

    it('emits the events from the ticker', () => {
        const spine = create();
        const started = vi.fn();

        spine.on('start', started);
        const walk = spine.play('walk');
        tick(16);

        expect(started).toHaveBeenCalledExactlyOnceWith(walk);
    });

    it('stays off when the option is false: the caller updates', () => {
        const spine = create({ autoUpdate: false });
        const update = vi.spyOn(spine, 'update');
        const walk = spine.play('walk');

        tick(16);
        expect(spine.autoUpdate).toBe(false);
        expect(ticker.count).toBe(listeners);
        expect(update).not.toHaveBeenCalled();
        spine.update(0.25);

        expect(walk.time).toBe(0.25);
    });

    it('can be turned off and on', () => {
        const spine = create();
        const update = vi.spyOn(spine, 'update');

        spine.autoUpdate = false;
        tick(16);
        expect(ticker.count).toBe(listeners);
        expect(update).not.toHaveBeenCalled();

        spine.autoUpdate = true;
        spine.autoUpdate = true;
        tick(16);
        expect(spine.autoUpdate).toBe(true);
        expect(ticker.count).toBe(listeners + 1);
        expect(update).toHaveBeenCalledExactlyOnceWith(0.016);
    });

    it('updates each instance on its own', () => {
        const first = create();
        const second = create();
        const firstUpdate = vi.spyOn(first, 'update');
        const secondUpdate = vi.spyOn(second, 'update');

        second.autoUpdate = false;
        tick(16);

        expect(firstUpdate).toHaveBeenCalledOnce();
        expect(secondUpdate).not.toHaveBeenCalled();
    });

    it('takes its callback off the ticker when it is destroyed', () => {
        const spine = new MarrowSpine(asset);
        const update = vi.spyOn(spine, 'update');

        expect(ticker.count).toBe(listeners + 1);
        spine.destroy();
        tick(16);

        expect(ticker.count).toBe(listeners);
        expect(spine.autoUpdate).toBe(false);
        expect(update).not.toHaveBeenCalled();
    });
});
