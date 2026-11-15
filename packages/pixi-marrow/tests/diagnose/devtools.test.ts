import { Container, Sprite } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatHit, installDevtools, type MarrowDevtools, RULES, RULES_DOCS } from '../../src/diagnose';
import { MarrowError } from '../../src/index';
import { cleanUp, spine, stageOf } from './scene';

const OWL = '4.2/owl-pro.skel';
const hookOf = (): unknown => Reflect.get(globalThis, '__PIXI_MARROW__');
let installed: MarrowDevtools | undefined;

/** Installs the hook, and removes it after the test. */
function install(options?: Parameters<typeof installDevtools>[0]): MarrowDevtools {
    installed = installDevtools(options);

    return installed;
}

afterEach(() => {
    installed?.uninstall();
    installed = undefined;
    Reflect.deleteProperty(globalThis, '__PIXI_APP__');
    vi.restoreAllMocks();
    cleanUp();
});

describe('installDevtools', () => {
    it('puts nothing on globalThis until it is called, and takes the hook away again', async () => {
        expect(hookOf()).toBeUndefined();
        const hook = install({ root: stageOf(await spine(OWL)) });

        expect(hookOf()).toBe(hook);
        expect(hook).toMatchObject({ version: 1, docs: RULES_DOCS, rules: RULES });
        hook.uninstall();
        expect(hookOf()).toBeUndefined();
    });

    it('finds the skeletons by a walk from the root, with the stage of __PIXI_APP__ as the default', async () => {
        const stage = stageOf(await spine(OWL), new Sprite(), await spine(OWL, { label: 'wild' }));

        Reflect.set(globalThis, '__PIXI_APP__', { stage, renderer: { type: 1, roundPixels: true } });
        const hook = install();

        expect(hook.instances()).toEqual(['stage/MarrowSpine', 'stage/wild']);
        expect(hook.inspect().map((data) => data.label)).toEqual(['MarrowSpine', 'wild']);
        expect(hook.tree().renderer).toMatchObject({ type: 'webgl', roundPixels: true });
        expect(hook.diagnose().hits.map((hit) => hit.id)).toContain('MARROW004');
        expect(hook.diagnoseTree(hook.tree()).skeletons).toBe(2);
    });

    it('takes a root per call, and a skeleton as the root of inspect', async () => {
        const hero = await spine(OWL, { label: 'owl' });
        const hook = install({ root: stageOf(hero) });
        const other = stageOf(await spine(OWL), await spine(OWL));

        expect(hook.instances(other)).toHaveLength(2);
        expect(hook.inspect(hero)).toHaveLength(1);
        expect(hook.inspect(hero)[0]?.label).toBe('owl');
    });

    it('throws a MarrowError when it has no root to walk', () => {
        const hook = install();
        let thrown: unknown;

        try {
            hook.diagnose();
        } catch (error) {
            thrown = error;
        }
        expect(thrown).toBeInstanceOf(MarrowError);
        expect(thrown).toMatchObject({ code: 'invalid-option', docs: RULES_DOCS });
    });

    it('prints nothing by default, and with warn each hit once per rule and skeleton', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const root = stageOf(await spine(OWL), new Sprite({ label: 'badge' }), await spine(OWL));

        install({ root }).diagnose();
        expect(warn).not.toHaveBeenCalled();
        const hook = install({ root, warn: true });

        hook.diagnose();
        hook.diagnose();
        const lines = warn.mock.calls.map(([line]) => String(line));

        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe(
            '[pixi-marrow:MARROW004] "stage/MarrowSpine[1]" "stage/badge" (Sprite) draws between this skeleton and "stage/MarrowSpine[0]", so the batch ends and this skeleton starts a new draw call. Fix: Put the skeletons into one container and the other objects into a container above or below it. https://pixi-marrow.schmooky.dev/performance/rules/#marrow004',
        );
        expect(lines[1]).toMatch(/^\[pixi-marrow:MARROW020\] "stage\/MarrowSpine\[0\]" and 1 more /);
        expect(formatHit(hook.diagnose().hits[0] ?? never())).toBe(lines[0]);
    });

    it('warns from a ticker: it watches the root and reports every so many ticks', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const hero = await spine(OWL);
        const listeners = new Set<() => void>();
        const ticker = { add: (fn: () => void) => listeners.add(fn), remove: (fn: () => void) => listeners.delete(fn) };
        const hook = install({ root: stageOf(hero), warn: true, ticker, every: 3 });
        const tick = (): void => {
            for (const fn of listeners) fn();
        };

        hero.visible = false;
        tick();
        tick();
        expect(warn).not.toHaveBeenCalled();
        hero.update(1 / 60);
        tick();
        expect(warn.mock.calls.map(([line]) => String(line).slice(0, 24))).toEqual(['[pixi-marrow:MARROW015] ']);
        hook.uninstall();
        expect(listeners.size).toBe(0);
    });

    it('wraps a watch so that its report warns too', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const root = new Container({ label: 'stage' });
        const hook = install({ root, warn: true });
        const watching = hook.watch();

        root.addChild(await spine(OWL));
        watching.sample();
        expect(watching.report().skeletons).toBe(1);
        expect(warn).toHaveBeenCalledTimes(1);
        watching.stop();
    });
});

function never(): never {
    throw new Error('the diagnosis has no hit');
}
