import { Container, Sprite } from 'pixi.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { viewOf } from '../../src/api/view-of';
import { diagnose, diagnoseTree, type SkeletonInspection, serializeTree, type TreeDump } from '../../src/diagnose';
import { loadMeshCode } from '../../src/render/mesh-code';
import { cleanUp, hitsOf, idsOf, skeletonNodes, spine, stageOf } from './scene';

/*
 * The static rules, each on a small Pixi tree that triggers it and on one that does not. A rule
 * whose cause needs a GPU is tried on the dump of a live tree, with the one field changed that
 * the GPU would set: the rules read the dump, and `diagnose` is `diagnoseTree` of that dump.
 */

const COIN = '4.2/coin-pro.skel';
const OWL = '4.2/owl-pro.skel';
const SACK = '4.2/sack-pro.skel';

beforeAll(async () => {
    await loadMeshCode();
});
afterEach(cleanUp);

/** The inspection of the first skeleton of a dump. */
function marrowOf(dump: TreeDump): SkeletonInspection {
    const marrow = skeletonNodes(dump)[0]?.marrow;

    if (marrow === undefined) throw new Error('the dump has no skeleton');

    return marrow;
}

/** The dump of a tree with one owl, with the inspection of the owl changed by `change`. */
async function owlDump(change: (marrow: SkeletonInspection) => void, renderMode: 'batched' | 'mesh' = 'batched') {
    const dump = serializeTree(stageOf(await spine(OWL, { renderMode })));
    change(marrowOf(dump));

    return dump;
}

describe('the static rules about the display objects above a skeleton', () => {
    it('MARROW003 hits for an alpha above a skeleton with the idle cache, and names the container', async () => {
        const fading = new Container({ label: 'fading' });
        const root = stageOf(fading);

        fading.addChild(await spine(OWL, { idleCache: 'auto' }));
        expect(hitsOf(diagnose(root), 'MARROW003')).toEqual([]);
        fading.alpha = 0.5;
        const [hit] = hitsOf(diagnose(root), 'MARROW003');

        expect(hit).toMatchObject({ node: 'stage/fading/MarrowSpine', cause: 'stage/fading', severity: 'info' });
        expect(hit?.docs).toBe('https://pixi-marrow.schmooky.dev/performance/rules/#marrow003');
    });

    it('MARROW003 says nothing for a skeleton without outlines and without the idle cache', async () => {
        const hero = await spine(OWL);

        hero.alpha = 0.5;
        expect(hitsOf(diagnose(stageOf(hero)), 'MARROW003')).toEqual([]);
    });

    it('MARROW006 hits for a blend mode above the skeleton, and for slots that multiply', async () => {
        const glow = new Container({ label: 'glow' });
        const root = stageOf(glow);

        glow.addChild(await spine(OWL));
        expect(hitsOf(diagnose(root), 'MARROW006')).toEqual([]);
        glow.blendMode = 'add';
        expect(hitsOf(diagnose(root), 'MARROW006')[0]).toMatchObject({ cause: 'stage/glow' });

        const tank = hitsOf(diagnose(stageOf(await spine('4.2/tank-pro.skel'))), 'MARROW006');

        expect(tank[0]?.cause).toBe('');
        expect(tank[0]?.measured.blendSlots).toBeGreaterThan(0);
    });

    it('MARROW017 hits for a mask and for a filter above the skeleton', async () => {
        const masked = new Container({ label: 'masked' });
        const root = stageOf(masked);

        masked.addChild(await spine(OWL));
        expect(hitsOf(diagnose(root), 'MARROW017')).toEqual([]);
        masked.mask = new Sprite();
        expect(hitsOf(diagnose(root), 'MARROW017')[0]).toMatchObject({ cause: 'stage/masked', measured: { mask: 1 } });

        const dump = serializeTree(root);

        const [above] = dump.root.children;

        Object.assign(above ?? {}, { mask: false, filters: 1 });
        expect(hitsOf(diagnoseTree(dump), 'MARROW017')[0]?.message).toContain('a filter');
    });

    it('MARROW018 hits for a container that is cached as a texture', async () => {
        const cached = new Container({ label: 'cached' });
        const root = stageOf(cached);

        cached.addChild(await spine(OWL));
        expect(hitsOf(diagnose(root), 'MARROW018')).toEqual([]);
        cached.cacheAsTexture(true);
        expect(hitsOf(diagnose(root), 'MARROW018')[0]).toMatchObject({ cause: 'stage/cached', severity: 'warn' });
    });
});

describe('the static rules about the draw order', () => {
    it('MARROW004 hits for a sprite between two batched skeletons, and not for one after them', async () => {
        const [first, second] = [await spine(OWL), await spine(OWL)];
        const sprite = new Sprite({ label: 'coin-glow' });
        const root = stageOf(first, second, sprite);

        expect(hitsOf(diagnose(root), 'MARROW004')).toEqual([]);
        root.addChildAt(sprite, 1);
        const [hit] = hitsOf(diagnose(root), 'MARROW004');

        expect(hit).toMatchObject({ node: 'stage/MarrowSpine[1]', cause: 'stage/coin-glow', measured: { between: 1 } });
        expect(hit?.cost).toEqual(['draw-calls']);
    });

    it('MARROW004 hits for a sprite with an alpha of 0, which Pixi still collects, and not for a hidden one', async () => {
        const sprite = new Sprite({ label: 'ghost' });
        const root = stageOf(await spine(OWL), sprite, await spine(OWL));

        sprite.alpha = 0;
        expect(hitsOf(diagnose(root), 'MARROW004')[0]).toMatchObject({ cause: 'stage/ghost' });
        sprite.visible = false;
        expect(hitsOf(diagnose(root), 'MARROW004')).toEqual([]);
    });

    it('MARROW004 names a skeleton in the mesh mode between two batched ones', async () => {
        const root = stageOf(
            await spine(OWL),
            await spine(OWL, { renderMode: 'mesh', label: 'boss' }),
            await spine(OWL),
        );

        expect(hitsOf(diagnose(root), 'MARROW004')[0]).toMatchObject({ cause: 'stage/boss' });
    });

    it('MARROW004 says nothing across a render group: the batch ends there anyway', async () => {
        const layer = new Container({ label: 'layer', isRenderGroup: true });
        const root = stageOf(await spine(OWL), new Sprite(), layer);

        layer.addChild(await spine(OWL));
        expect(hitsOf(diagnose(root), 'MARROW004')).toEqual([]);
    });

    it('MARROW005 hits when the zIndex of a sorted container puts a sprite between two skeletons', async () => {
        const [first, second] = [await spine(OWL), await spine(OWL)];
        const sprite = new Sprite({ label: 'badge' });
        const root = stageOf(first, second, sprite);

        root.sortableChildren = true;
        first.zIndex = 0;
        second.zIndex = 2;
        sprite.zIndex = 3;
        expect(idsOf(diagnose(root))).not.toContain('MARROW005');
        sprite.zIndex = 1;
        expect(hitsOf(diagnose(root), 'MARROW005')[0]).toMatchObject({ cause: 'stage/badge' });
        expect(hitsOf(diagnose(root), 'MARROW004')).toEqual([]);
    });

    it('MARROW013 hits for a skeleton with dark colors after one without, and not the other way round', async () => {
        const plain = await spine(OWL, { label: 'owl' });
        const dark = await spine(COIN, { label: 'coin' });
        const root = stageOf(dark, plain);

        expect(hitsOf(diagnose(root), 'MARROW013')).toEqual([]);
        root.addChildAt(plain, 0);
        expect(hitsOf(diagnose(root), 'MARROW013')[0]).toMatchObject({ node: 'stage/coin', cause: 'stage/owl' });
    });

    it('MARROW007 hits when batched neighbours use more pages together than a batch samples', async () => {
        const root = stageOf(await spine(OWL), await spine(COIN));
        const two = { limits: { maxBatchableTextures: 2 } };
        const one = { limits: { maxBatchableTextures: 1 } };

        expect(hitsOf(diagnose(root, { renderer: two }), 'MARROW007')).toEqual([]);
        expect(hitsOf(diagnose(root, { renderer: one }), 'MARROW007')[0]).toMatchObject({
            node: 'stage/MarrowSpine[1]',
            measured: { pages: 2, limit: 1 },
        });
    });
});

describe('the static rules about one skeleton', () => {
    it('MARROW007 hits for a skeleton in the mesh mode with more than 8 pages', async () => {
        const few = diagnose(stageOf(await spine(OWL, { renderMode: 'mesh' })));
        const many = diagnose(stageOf(await spine('4.2/chibi-stickers.skel', { renderMode: 'mesh' })));

        expect(hitsOf(few, 'MARROW007')).toEqual([]);
        expect(hitsOf(many, 'MARROW007')[0]?.measured).toMatchObject({ pages: 10, limit: 8 });
    });

    it('MARROW008 hits once a renderer refused to batch the skeleton', async () => {
        const hero = await spine(OWL);
        const root = stageOf(hero);

        expect(hitsOf(diagnose(root), 'MARROW008')).toEqual([]);
        viewOf(hero)?.refuseBatch();
        expect(hitsOf(diagnose(root), 'MARROW008')).toHaveLength(1);
    });

    it('MARROW009 hits for four instances in the mesh mode, once for the asset, and not for three', async () => {
        const root = stageOf();

        for (let i = 0; i < 3; i++) root.addChild(await spine(OWL, { renderMode: 'mesh' }));
        expect(hitsOf(diagnose(root), 'MARROW009')).toEqual([]);
        root.addChild(await spine(OWL, { renderMode: 'mesh' }));
        const hits = hitsOf(diagnose(root), 'MARROW009');

        expect(hits).toHaveLength(1);
        expect(hits[0]?.nodes).toHaveLength(4);
        expect(hits[0]?.measured).toMatchObject({ instances: 4, skeletons: 4 });
    });

    it('MARROW010 hits for a clip in the batched mode, MARROW011 for mask draws in the mesh mode', async () => {
        expect(idsOf(diagnose(stageOf(await spine(OWL))))).not.toContain('MARROW010');
        expect(hitsOf(diagnose(stageOf(await spine(COIN, { renderMode: 'batched' }))), 'MARROW010')).toHaveLength(1);

        const masks = await owlDump((marrow) => {
            marrow.render.clips = 1;
            marrow.render.maskDraws = 2;
        }, 'mesh');
        const none = await owlDump((marrow) => {
            marrow.render.clips = 1;
        }, 'mesh');

        expect(hitsOf(diagnoseTree(masks), 'MARROW011')[0]?.measured).toMatchObject({ maskDraws: 2 });
        expect(idsOf(diagnoseTree(none))).not.toContain('MARROW011');
    });

    it('MARROW012 hits for a container attached to a slot, and not for one that follows a bone', async () => {
        const hero = await spine(OWL);
        const root = stageOf(hero);
        const { bones, slots } = hero.info;

        hero.follow(bones[1] ?? '', hero.addChild(new Container()));
        expect(hitsOf(diagnose(root), 'MARROW012')).toEqual([]);
        hero.attach(slots[0] ?? '', new Container());
        expect(hitsOf(diagnose(root), 'MARROW012')[0]?.measured).toMatchObject({ attached: 1 });
    });

    it('MARROW015 hits for a skeleton off the screen that updates, with a renderer that has a screen', async () => {
        const hero = await spine(OWL);
        const root = stageOf(hero);
        const renderer = { screen: { width: 800, height: 600 } };

        hero.position.set(400, 300);
        expect(hitsOf(diagnose(root, { renderer }), 'MARROW015')).toEqual([]);
        hero.position.set(-5000, 300);
        expect(hitsOf(diagnose(root, { renderer }), 'MARROW015')).toHaveLength(1);
        // without a screen size the rule cannot tell
        expect(hitsOf(diagnose(root), 'MARROW015')).toEqual([]);
    });

    it('MARROW015 says nothing off the screen when offscreen is pause', async () => {
        const hero = await spine(OWL, { offscreen: 'pause' });

        hero.position.set(-5000, 0);
        expect(
            hitsOf(diagnose(stageOf(hero), { renderer: { screen: { width: 800, height: 600 } } }), 'MARROW015'),
        ).toEqual([]);
    });

    it('MARROW016 hits for a renderer that rounds pixels or multisamples, for a skeleton with outlines', async () => {
        const given = (marrow: SkeletonInspection): void => {
            marrow.cuts.outlines = 'given';
        };
        const round = await owlDump(given);
        const blocked = await owlDump((marrow) => {
            given(marrow);
            marrow.cuts.blockedBy = ['multisample'];
        });
        const plain = await owlDump(given);

        round.renderer = {
            type: 'webgl',
            roundPixels: true,
            antialias: false,
            width: 0,
            height: 0,
            maxBatchTextures: 16,
        };
        expect(hitsOf(diagnoseTree(round), 'MARROW016')[0]?.message).toContain('roundPixels');
        expect(hitsOf(diagnoseTree(blocked), 'MARROW016')[0]?.message).toContain('multisample');
        expect(hitsOf(diagnoseTree(plain), 'MARROW016')).toEqual([]);
        // without outlines there is nothing to turn off
        marrowOf(round).cuts.outlines = 'off';
        expect(hitsOf(diagnoseTree(round), 'MARROW016')).toEqual([]);
    });

    it('MARROW020 hits for an asset without outlines, MARROW021 for a page texture that blocks cuts', async () => {
        const off = diagnose(stageOf(await spine(OWL), await spine(OWL)));

        expect(hitsOf(off, 'MARROW020')).toHaveLength(1);
        expect(hitsOf(off, 'MARROW020')[0]?.nodes).toHaveLength(2);
        expect(hitsOf(off, 'MARROW021')).toEqual([]);

        const blocked = await owlDump((marrow) => {
            marrow.cuts.outlines = 'given';
            marrow.cuts.pageBlocks = ['owl.png: mipmaps'];
        });
        const clean = await owlDump((marrow) => {
            marrow.cuts.outlines = 'given';
            marrow.cuts.pageBlocks = [];
        });

        expect(idsOf(diagnoseTree(blocked))).not.toContain('MARROW020');
        expect(hitsOf(diagnoseTree(blocked), 'MARROW021')[0]?.message).toContain('owl.png: mipmaps');
        expect(hitsOf(diagnoseTree(clean), 'MARROW021')).toEqual([]);
    });

    it('MARROW022 hits for physics in the mode update, and not in the mode none', async () => {
        const hero = await spine(SACK);
        const root = stageOf(hero, await spine(OWL));
        const [hit] = hitsOf(diagnose(root), 'MARROW022');

        expect(hit?.node).toBe('stage/MarrowSpine[0]');
        expect(hit?.measured.constraints).toBeGreaterThan(0);
        hero.physics = 'none';
        expect(hitsOf(diagnose(root), 'MARROW022')).toEqual([]);
    });
});

describe('the static rules about the scene', () => {
    it('MARROW024 hits on WebGPU for more mesh draws than share the uniform buffer of Pixi', async () => {
        const many = await owlDump((marrow) => {
            marrow.render.drawCalls = 1800;
        }, 'mesh');
        const webgpu = {
            type: 'webgpu',
            roundPixels: false,
            antialias: false,
            width: 0,
            height: 0,
            maxBatchTextures: 16,
        };

        expect(hitsOf(diagnoseTree(many), 'MARROW024')).toEqual([]);
        many.renderer = webgpu;
        expect(hitsOf(diagnoseTree(many), 'MARROW024')[0]).toMatchObject({ node: 'stage', measured: { limit: 1791 } });
        marrowOf(many).render.drawCalls = 4;
        expect(hitsOf(diagnoseTree(many), 'MARROW024')).toEqual([]);
    });

    it('MARROW026 hits for many batched skeletons on WebGL with pixi.js before 8.23', async () => {
        const owls = await Promise.all(Array.from({ length: 8 }, () => spine(OWL)));
        const many = serializeTree(stageOf(...owls));
        const one = await owlDump(() => undefined);

        many.pixi = '8.23.0';
        expect(hitsOf(diagnoseTree(many), 'MARROW026')).toEqual([]);
        many.pixi = '8.21.0';
        one.pixi = '8.21.0';
        expect(hitsOf(diagnoseTree(many), 'MARROW026')[0]?.measured).toMatchObject({ skeletons: 8 });
        expect(hitsOf(diagnoseTree(one), 'MARROW026')).toEqual([]);
    });
});

describe('what a diagnosis leaves out', () => {
    it('says nothing about a skeleton that Pixi does not draw, and still counts it', async () => {
        const hidden = new Container({ label: 'hidden' });
        const root = stageOf(hidden);

        hidden.addChild(await spine(COIN), new Sprite(), await spine(COIN));
        hidden.visible = false;
        const result = diagnose(root);

        expect(result.skeletons).toBe(2);
        expect(result.scene.drawn).toBe(0);
        expect(result.hits).toEqual([]);
    });

    it('lists warnings before notes, and totals the scene', async () => {
        const root = stageOf(
            await spine(OWL),
            new Sprite(),
            await spine(OWL),
            await spine(OWL, { renderMode: 'mesh' }),
        );
        const { hits, scene, skeletons } = diagnose(root);
        const levels = hits.map((hit) => hit.severity);

        expect(levels).toEqual([...levels].sort((a, b) => Number(b === 'warn') - Number(a === 'warn')));
        expect(skeletons).toBe(3);
        expect(scene).toMatchObject({ drawn: 3, batched: 2, mesh: 1, assets: 1 });
        expect(scene.vertices).toBeGreaterThan(0);
    });
});
