import { Container, Sprite } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { diagnoseTree, inspect, isMarrowSpine, serializeTree } from '../../src/diagnose';
import { MarrowError } from '../../src/index';
import { FRAME } from '../api/helpers';
import { cleanUp, skeletonNodes, spine, stageOf } from './scene';

const OWL = '4.2/owl-pro.skel';
const SACK = '4.2/sack-pro.skel';

afterEach(cleanUp);

describe('inspect', () => {
    it('reads a display object into plain data that survives JSON', async () => {
        const hero = await spine(SACK, { label: 'sack', perf: 'balanced', idleCache: 'auto' });

        hero.update(FRAME);
        const data = inspect(hero);

        expect(JSON.parse(JSON.stringify(data))).toEqual(data);
        expect(data).toMatchObject({ kind: 'pixi-marrow/skeleton', version: 1, label: 'sack', rules: [] });
        expect(data.asset).toMatchObject({ spine: '4.2', id: -1, instances: 1 });
        expect(data.asset.editorVersion).toMatch(/^4\.2\./);
        expect(data.counts).toMatchObject({ bones: hero.info.counts.bones, slots: hero.info.counts.slots });
        expect(data.counts.constraints.physics).toBe(data.physics.constraints);
        expect(data.render).toMatchObject({ mode: hero.stats.renderMode, option: 'auto', skinning: 'cpu' });
        expect(data.render.instancing).toMatchObject({ active: false });
        expect(data.perf).toMatchObject({ preset: 'balanced', given: ['idleCache'] });
        expect(data.perf.settings).toMatchObject({ offscreen: 'throttle', idleCache: 'auto' });
        expect(data.idle).toEqual({ setting: 'auto', showing: false });
        expect(data.physics.mode).toBe('update');
        expect(data.memory.instance).toBeGreaterThan(0);
    });

    it('reads the counters of the view as they are now', async () => {
        const hero = await spine(OWL);

        hero.update(FRAME);
        hero.update(FRAME);
        const { frame, totals, pacing } = inspect(hero);

        expect(frame).toMatchObject({ skipped: true, posed: false, uploadBytes: hero.stats.frameBytes });
        expect(totals).toMatchObject({ skips: hero.stats.skips, templateBuilds: 1, transformReplaces: 0 });
        expect(totals.uploadBytes).toEqual(hero.stats.uploadBytes);
        expect(totals.uploadBytes).not.toBe(hero.stats.uploadBytes);
        // no parent yet: Pixi does not draw it
        expect(pacing).toMatchObject({ autoUpdate: false, drawn: false, onScreen: null, size: null });
    });

    it('counts the containers of the game, and says what Pixi draws', async () => {
        const hero = await spine(OWL);
        const root = stageOf(hero);

        hero.attach(hero.info.slots[0] ?? '', new Container());
        hero.follow(hero.info.bones[0] ?? '', hero.addChild(new Container()));
        expect(inspect(hero).render).toMatchObject({ attached: 1, following: 1 });
        expect(inspect(hero).pacing.drawn).toBe(true);
        root.alpha = 0;
        expect(inspect(hero).pacing.drawn).toBe(false);
    });

    it('throws for an object that this copy of the package did not make', () => {
        const stranger = Object.assign(new Container(), { isMarrowSpine: true });

        expect(isMarrowSpine(stranger)).toBe(true);
        expect(isMarrowSpine(new Container())).toBe(false);
        expect(() => inspect(stranger as never)).toThrow(MarrowError);
    });
});

describe('serializeTree', () => {
    it('writes the tree as plain data, with a path per display object', async () => {
        const reels = new Container({ label: 'reels' });
        const root = stageOf(reels, new Sprite({ label: 'logo' }));

        for (let i = 0; i < 3; i++) reels.addChild(new Container({ label: 'reel' }));
        reels.children[2]?.addChild(await spine(OWL), await spine(OWL, { label: 'wild' }));
        const dump = serializeTree(root, {
            renderer: { type: 2, roundPixels: true, screen: { width: 800, height: 600 } },
        });

        expect(JSON.parse(JSON.stringify(dump))).toEqual(dump);
        expect(dump).toMatchObject({ kind: 'pixi-marrow/tree', version: 1 });
        expect(dump.pixi).toMatch(/^8\./);
        expect(dump.renderer).toEqual({
            type: 'webgpu',
            roundPixels: true,
            antialias: false,
            width: 800,
            height: 600,
            maxBatchTextures: 16,
        });
        expect(skeletonNodes(dump).map((node) => node.path)).toEqual([
            'stage/reels/reel[2]/MarrowSpine',
            'stage/reels/reel[2]/wild',
        ]);
        expect(dump.root.children[1]).toMatchObject({ type: 'Sprite', label: 'logo', draws: true, children: [] });
        expect(dump.root.children[0]).toMatchObject({
            type: 'Container',
            draws: false,
            alpha: 1,
            blendMode: 'inherit',
        });
    });

    it('gives each skeleton its asset, its instances, whether it is on the screen and the rules that hit', async () => {
        const [first, second, other] = [await spine(OWL), await spine(OWL), await spine(SACK)];
        const root = stageOf(first, second, other);

        other.position.set(-9000, 0);
        const dump = serializeTree(root, { renderer: { screen: { width: 800, height: 600 } } });
        const [a, b, c] = skeletonNodes(dump).map((node) => node.marrow);

        expect(a?.asset).toMatchObject({ id: 0, instances: 2 });
        expect(b?.asset).toMatchObject({ id: 0, instances: 2 });
        expect(c?.asset).toMatchObject({ id: 1, instances: 1 });
        expect(a?.pacing.onScreen).toBe(true);
        expect(c?.pacing.onScreen).toBe(false);
        expect(a?.rules).toEqual(['MARROW020']);
        expect(c?.rules).toEqual(expect.arrayContaining(['MARROW015', 'MARROW020', 'MARROW022']));
        // the children of a skeleton belong to the runtime
        expect(skeletonNodes(dump).every((node) => node.children.length === 0)).toBe(true);
    });

    it('reads the flags that decide how Pixi draws a container', async () => {
        const layer = new Container({ label: 'layer', isRenderGroup: true, sortableChildren: true });
        const root = stageOf(layer);

        layer.addChild(await spine(OWL));
        layer.tint = 0xff0000;
        layer.zIndex = 4;
        layer.position.set(10, 20);
        layer.scale.set(2, 3);
        layer.rotation = 0.5;
        layer.mask = new Sprite();
        expect(serializeTree(root).root.children[0]).toMatchObject({
            renderGroup: true,
            sortableChildren: true,
            tint: 0xff0000,
            zIndex: 4,
            x: 10,
            y: 20,
            scaleX: 2,
            scaleY: 3,
            rotation: 0.5,
            mask: true,
            filters: 0,
            cacheAsTexture: false,
        });
    });

    it('gives a dump that diagnoseTree reads after a trip through JSON, with the hits of the live tree', async () => {
        const root = stageOf(await spine(OWL), new Sprite(), await spine(OWL));
        const pasted = JSON.parse(JSON.stringify(serializeTree(root)));
        const { hits, skeletons } = diagnoseTree(pasted);

        expect(skeletons).toBe(2);
        expect(hits.map((hit) => hit.id)).toEqual(['MARROW004', 'MARROW020']);
    });
});
