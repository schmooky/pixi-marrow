import type { Renderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { Pacer } from '../../src/api/pacing';
import { PERF_PRESETS, resolvePerf } from '../../src/api/presets';
import { MarrowError, MarrowSpine } from '../../src/index';
import { fixtureAsset } from './helpers';

/*
 * The `perf` presets and the pacing of updates: `updateRate`, `offscreen` and `lod`.
 */

const SCREEN = { screen: { x: 0, y: 0, width: 800, height: 600 } } as unknown as Renderer;

/** Something rendered with the box it covers on the screen. */
const at = (x: number, y: number, width: number, height = width) => ({ getBounds: () => ({ x, y, width, height }) });

function thrownBy(run: () => unknown): MarrowError {
    try {
        run();
    } catch (error) {
        if (error instanceof MarrowError) return error;
        throw error;
    }
    throw new Error('nothing was thrown');
}

describe('the perf presets', () => {
    it('start from exact, and a preset, a perf object and an option by name win in that order', () => {
        expect(resolvePerf(undefined)).toMatchObject(PERF_PRESETS.exact);
        expect(resolvePerf('fast')).toMatchObject(PERF_PRESETS.fast);
        const mixed = resolvePerf({ preset: 'balanced', offscreen: 'pause' }, { offscreen: 'update', lod: 'auto' });

        expect(mixed).toMatchObject({ ...PERF_PRESETS.balanced, offscreen: 'update', lod: 'auto' });
        expect([...mixed.given].sort()).toEqual(['lod', 'offscreen']);
        expect(resolvePerf('fast').given.size).toBe(0);
        // an option left undefined takes the preset
        expect(resolvePerf('balanced', { tightMesh: undefined }).tightMesh).toBe('on');
    });

    it('throw for a preset or a value that does not exist, with the closest name', () => {
        expect(thrownBy(() => resolvePerf('fats' as 'fast')).closest).toBe('fast');
        expect(thrownBy(() => resolvePerf(undefined, { offscreen: 'paused' as 'pause' })).closest).toBe('pause');
        expect(thrownBy(() => resolvePerf(undefined, { updateRate: 0 })).message).toMatch(/not a rate/);
        expect(thrownBy(() => resolvePerf(undefined, { bake: [3] as unknown as string[] })).message).toMatch(/names/);
        expect(resolvePerf(undefined, { bake: ['idle', 'run'] }).bake).toEqual(['idle', 'run']);
    });
});

describe('the pacing of updates', () => {
    it('updates every frame by default, with the seconds it was given', () => {
        const pacer = new Pacer(resolvePerf(undefined));

        expect(pacer.watching).toBe(false);
        expect([pacer.take(1 / 60, true), pacer.take(0, true), pacer.take(0.5, false)]).toEqual([1 / 60, 0, 0.5]);
    });

    it('gathers the time of the updates in between at a lower rate', () => {
        const pacer = new Pacer(resolvePerf(undefined, { updateRate: 20 }));
        const steps = Array.from({ length: 6 }, () => pacer.take(1 / 60, false));

        // every third update of a 60 Hz display poses, with the time of three
        expect(steps.map((seconds) => (seconds < 0 ? -1 : Math.round(seconds * 60)))).toEqual([-1, -1, 3, -1, -1, 3]);
    });

    it('applies the rate of the fast preset to batched skeletons only', () => {
        const batched = new Pacer(resolvePerf('fast'));
        const meshes = new Pacer(resolvePerf('fast'));

        expect(batched.take(1 / 60, true)).toBe(-1);
        expect(meshes.take(1 / 60, false)).toBe(1 / 60);
    });

    it('pauses a skeleton off the screen and loses the time, and resumes it on the screen', () => {
        const pacer = new Pacer(resolvePerf(undefined, { offscreen: 'pause' }));

        pacer.take(1 / 60, false);
        pacer.seen(at(900, 0, 50), SCREEN);
        expect(pacer.take(1 / 60, false)).toBe(-1);
        expect(pacer.take(1 / 60, false)).toBe(-1);
        pacer.seen(at(100, 100, 50), SCREEN);
        expect(pacer.take(1 / 60, false)).toBe(1 / 60);
    });

    it('counts a skeleton that no render reaches as off the screen', () => {
        const pacer = new Pacer(resolvePerf(undefined, { offscreen: 'pause' }));
        const steps = Array.from({ length: 5 }, () => pacer.take(1 / 60, false));

        expect(steps.map((seconds) => seconds > 0)).toEqual([true, true, false, false, false]);
    });

    it('throttles a skeleton off the screen to four updates a second with the time that passed', () => {
        const pacer = new Pacer(resolvePerf('balanced'));

        pacer.seen(at(-500, -500, 100), SCREEN);
        const steps = Array.from({ length: 30 }, () => pacer.take(1 / 60, false)).filter((seconds) => seconds >= 0);

        expect(steps.map((seconds) => Math.round(seconds * 60))).toEqual([15, 15]);
    });

    it('says when lod leaves physics out: drawn smaller than 96 pixels', () => {
        const pacer = new Pacer(resolvePerf(undefined, { lod: 'auto' }));

        expect(pacer.small).toBe(false);
        pacer.seen(at(10, 10, 60), SCREEN);
        expect(pacer.small).toBe(true);
        pacer.seen(at(10, 10, 200, 50), SCREEN);
        expect(pacer.small).toBe(false);
        expect(new Pacer(resolvePerf(undefined)).small).toBe(false);
    });
});

describe('a display object with pacing', () => {
    it('poses at its update rate with the time that passed', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/spineboy-pro.skel'), {
            autoUpdate: false,
            updateRate: 20,
        });
        const update = vi.spyOn(spine.engine, 'update');

        for (let i = 0; i < 6; i++) spine.update(1 / 60);
        expect(update.mock.calls.map(([seconds]) => Math.round(seconds * 60))).toEqual([3, 3]);
        spine.destroy();
    });

    it('leaves physics out while drawn small, and resets it after', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/cloud-pot.skel'), { autoUpdate: false, lod: 'auto' });
        const modes: string[] = [];

        vi.spyOn(spine.engine, 'update').mockImplementation(() => {
            modes.push(spine.engine.physics);
        });
        spine.onRender?.call(spine, SCREEN);
        // a render of the real object: its bounds decide
        spine.update(1 / 60);
        vi.spyOn(spine, 'getBounds').mockReturnValue({ x: 0, y: 0, width: 40, height: 40 } as never);
        spine.onRender?.call(spine, SCREEN);
        spine.update(1 / 60);
        vi.spyOn(spine, 'getBounds').mockReturnValue({ x: 0, y: 0, width: 400, height: 400 } as never);
        spine.onRender?.call(spine, SCREEN);
        spine.update(1 / 60);
        spine.update(1 / 60);
        expect(modes).toEqual(['update', 'none', 'reset', 'update']);
        expect(spine.physics).toBe('update');
        spine.destroy();
    });
});

describe('the perf report of the settings', () => {
    it('names the preset, the settings and the pacing in effect', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/coin-pro.skel'), {
            autoUpdate: false,
            perf: 'balanced',
            updateRate: 20,
        });
        const rows = await spine.perf.report();
        const perf = rows.find((row) => row.feature === 'perf');
        const pacing = rows.find((row) => row.feature === 'pacing');

        expect(rows[0]?.feature).toBe('perf');
        expect(perf?.value).toBe('balanced');
        expect(perf?.reason).toMatch(/offscreen throttle, updateRate 20 a second/);
        expect(perf?.reason).toMatch(/Given by name: updateRate$/);
        expect(pacing?.value).toBe('20 a second');
        expect(spine.perfSettings.preset).toBe('balanced');
        spine.destroy();
    });
});
