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

/** Tells a display object that a render reached it, as Pixi does through the child that watches. */
function rendered(spine: MarrowSpine): void {
    const watch = spine.children.find((child) => child.label === 'marrow-pacing');

    if (watch?.onRender == null) throw new Error('no child watches the renders');
    watch.onRender(SCREEN);
}

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

    it('counts a skeleton that no render reaches for a while as off the screen', () => {
        const pacer = new Pacer(resolvePerf(undefined, { offscreen: 'pause' }));
        const steps = Array.from({ length: 5 }, () => pacer.take(1 / 20, false));

        expect(steps.map((seconds) => seconds > 0)).toEqual([true, true, false, false, false]);
    });

    it('keeps a skeleton on the screen that updates several times a render', () => {
        const pacer = new Pacer(resolvePerf(undefined, { offscreen: 'pause' }));
        let posed = 0;

        for (let render = 0; render < 20; render++) {
            for (let i = 0; i < 3; i++) posed += Math.max(pacer.take(1 / 180, false), 0);
            pacer.seen(at(100, 100, 50), SCREEN);
        }
        expect(posed).toBeCloseTo(20 / 60, 10);
    });

    it('counts a skeleton that shows nothing as on the screen, so that it shows again', () => {
        const pacer = new Pacer(resolvePerf(undefined, { offscreen: 'pause', lod: 'auto' }));

        pacer.seen(at(100, 100, 200), SCREEN);
        pacer.seen(at(0, 0, 0), SCREEN);
        expect(pacer.take(1 / 60, false)).toBe(1 / 60);
        // the size it had stays: an empty box does not leave physics out
        expect(pacer.small).toBe(false);
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
        // physics comes back above 120 pixels, so a skeleton at the limit does not flip each frame
        pacer.seen(at(10, 10, 110), SCREEN);
        expect(pacer.small).toBe(true);
        pacer.seen(at(10, 10, 200, 50), SCREEN);
        expect(pacer.small).toBe(false);
        pacer.seen(at(10, 10, 110), SCREEN);
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

    it('leaves physics and deform out while drawn small, and brings them back after', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/cloud-pot.skel'), { autoUpdate: false, lod: 'auto' });
        const modes: string[] = [];

        vi.spyOn(spine.engine, 'update').mockImplementation(() => {
            modes.push(`${spine.engine.physics} ${spine.engine.deform ? 'deform' : 'flat'}`);
        });
        rendered(spine);
        // a render of the real object: its bounds decide
        spine.update(1 / 60);
        vi.spyOn(spine, 'getBounds').mockReturnValue({ x: 0, y: 0, width: 40, height: 40 } as never);
        rendered(spine);
        spine.update(1 / 60);
        spine.update(1 / 60);
        vi.spyOn(spine, 'getBounds').mockReturnValue({ x: 0, y: 0, width: 400, height: 400 } as never);
        rendered(spine);
        spine.update(1 / 60);
        spine.update(1 / 60);
        expect(modes).toEqual(['update deform', 'none flat', 'none flat', 'reset deform', 'update deform']);
        expect(spine.physics).toBe('update');
        expect(spine.pacingStatus().reduced).toBe(false);
        spine.destroy();
    });

    it('leaves a deform switch the game set alone without lod', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/cloud-pot.skel'), { autoUpdate: false });

        spine.engine.deform = false;
        for (let i = 0; i < 3; i++) spine.update(1 / 60);
        expect(spine.engine.deform).toBe(false);
        spine.destroy();
    });

    it('keeps physics off that the game turned off, when lod gives it back', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/cloud-pot.skel'), { autoUpdate: false, lod: 'auto' });

        const modes: string[] = [];

        spine.physics = 'none';
        vi.spyOn(spine.engine, 'update').mockImplementation(() => {
            modes.push(spine.engine.physics);
        });
        vi.spyOn(spine, 'getBounds').mockReturnValue({ x: 0, y: 0, width: 40, height: 40 } as never);
        rendered(spine);
        spine.update(1 / 60);
        vi.spyOn(spine, 'getBounds').mockReturnValue({ x: 0, y: 0, width: 400, height: 400 } as never);
        rendered(spine);
        spine.update(1 / 60);
        // no reset runs the physics the game turned off
        expect(modes).toEqual(['none', 'none']);
        expect(spine.engine.deform).toBe(true);
        spine.destroy();
    });
});

describe('pacing and the game', () => {
    it('leaves onRender of the display object to the game', async () => {
        const spine = new MarrowSpine(await fixtureAsset('4.2/spineboy-pro.skel'), {
            autoUpdate: false,
            offscreen: 'pause',
        });
        const update = vi.spyOn(spine.engine, 'update');
        const own = vi.fn();

        spine.onRender = own;
        for (let i = 0; i < 10; i++) {
            spine.update(1 / 60);
            rendered(spine);
        }
        expect(update).toHaveBeenCalledTimes(10);
        expect(spine.onRender).toBe(own);
        spine.destroy();
    });

    it('poses the time it gathered before a command changes the tracks, with its events', async () => {
        async function heard(options: { updateRate?: number }): Promise<string[]> {
            const spine = new MarrowSpine(await fixtureAsset('4.2/spineboy-pro.skel'), {
                autoUpdate: false,
                ...options,
            });
            const names: string[] = [];

            spine.on('event', (event) => names.push(`${event.name}@${event.time}`));
            spine.play('walk');
            // the walk until a moment after a footstep, then another animation without a mix
            for (let i = 0; i < 32; i++) spine.update(1 / 60);
            spine.play('idle');
            for (let i = 0; i < 30; i++) spine.update(1 / 60);
            spine.destroy();

            return names;
        }
        const exact = await heard({});

        expect(exact.length).toBeGreaterThan(0);
        expect(await heard({ updateRate: 10 })).toEqual(exact);
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
