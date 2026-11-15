import { Container, Sprite } from 'pixi.js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { diagnose, watch } from '../../src/diagnose';
import type { MarrowSpine } from '../../src/index';
import { loadMeshCode } from '../../src/render/mesh-code';
import { FRAME } from '../api/helpers';
import { createStage, type Stage } from '../render/batch-stage';
import { cleanUp, hitsOf, idsOf, spine, stageOf } from './scene';

/*
 * The dynamic rules: `watch` notes the counters, the test plays some frames, and `report` names
 * what grew. The frames run through the render group system of Pixi, without a GPU, so the
 * counters of the batch are the ones a browser would count.
 */

const OWL = '4.2/owl-pro.skel';

beforeAll(async () => {
    await loadMeshCode();
});
afterEach(cleanUp);

/** A stage with one container named `reel` that holds batched owls, drawn twice. */
async function reel(count = 1): Promise<{ stage: Stage; holder: Container; heroes: MarrowSpine[] }> {
    const stage = createStage();
    const holder = new Container({ label: 'reel' });
    const heroes: MarrowSpine[] = [];

    stage.root.label = 'stage';
    stage.root.addChild(holder);
    for (let i = 0; i < count; i++) heroes.push(holder.addChild(await spine(OWL, { renderMode: 'batched' })));
    frame(stage, heroes);
    frame(stage, heroes);

    return { stage, holder, heroes };
}

/** One frame of a game: every skeleton updates, then Pixi renders. */
function frame(stage: Stage, heroes: readonly MarrowSpine[]): void {
    for (const hero of heroes) hero.update(FRAME);
    stage.render();
}

describe('the dynamic rules about what lies above a batched skeleton', () => {
    it('MARROW001 hits for a container that moves, names it, and groups the skeletons below it', async () => {
        const { stage, holder, heroes } = await reel(3);
        const watching = watch(stage.root);

        for (let i = 0; i < 4; i++) {
            holder.y += 12;
            frame(stage, heroes);
        }
        const [hit, ...more] = hitsOf(watching.report(), 'MARROW001');

        expect(more).toEqual([]);
        expect(hit).toMatchObject({ node: 'stage/reel/MarrowSpine[0]', cause: 'stage/reel', severity: 'warn' });
        expect(hit?.nodes).toHaveLength(3);
        expect(hit?.measured).toMatchObject({ transformReplaces: 4, skeletons: 3 });
        expect(hit?.measured.positionBytes).toBeGreaterThan(0);
        expect(hit?.fix).toContain('isRenderGroup');
    });

    it('MARROW001 says nothing for a scene at rest, and nothing for a parent that is a render group', async () => {
        const { stage, holder, heroes } = await reel();
        const watching = watch(stage.root);

        for (let i = 0; i < 4; i++) frame(stage, heroes);
        expect(hitsOf(watching.report(), 'MARROW001')).toEqual([]);

        holder.isRenderGroup = true;
        frame(stage, heroes);
        frame(stage, heroes);
        const grouped = watch(stage.root);

        for (let i = 0; i < 4; i++) {
            holder.y += 12;
            frame(stage, heroes);
        }
        expect(hitsOf(grouped.report(), 'MARROW001')).toEqual([]);
    });

    it('MARROW001 names the skeleton itself when it moves', async () => {
        const { stage, heroes } = await reel();
        const watching = watch(stage.root);

        for (let i = 0; i < 3; i++) {
            for (const hero of heroes) hero.x += 3;
            frame(stage, heroes);
        }
        const [hit] = hitsOf(diagnose(stage.root, { since: watching }), 'MARROW001');

        expect(hit?.cause).toBe('');
        expect(hit?.message).toMatch(/^The skeleton moved in 3 frames/);
    });

    it('MARROW002 hits for a container that fades, and not for one that stays', async () => {
        const { stage, holder, heroes } = await reel();
        const watching = watch(stage.root);

        for (let i = 0; i < 3; i++) frame(stage, heroes);
        expect(hitsOf(watching.report(), 'MARROW002')).toEqual([]);
        for (let i = 0; i < 3; i++) {
            holder.alpha -= 0.1;
            frame(stage, heroes);
        }
        const [hit] = hitsOf(watching.report(), 'MARROW002');

        expect(hit).toMatchObject({ cause: 'stage/reel', measured: { tintRewrites: 3 } });
        expect(hit?.measured.staticBytes).toBeGreaterThan(0);
    });

    it('MARROW014 hits when Pixi builds the instructions in every frame, and not when it builds them once', async () => {
        const { stage, heroes } = await reel(2);
        const sprite = new Sprite();
        const watching = watch(stage.root);

        stage.root.addChild(sprite);
        frame(stage, heroes);
        expect(hitsOf(watching.report(), 'MARROW014')).toEqual([]);
        for (let i = 0; i < 4; i++) {
            sprite.visible = !sprite.visible;
            frame(stage, heroes);
        }
        const hits = hitsOf(watching.report(), 'MARROW014');

        expect(hits).toHaveLength(1);
        expect(hits[0]?.measured.instructionBuilds).toBe(4);
        expect(hits[0]?.nodes).toHaveLength(2);
    });
});

describe('the dynamic rules about work that nobody sees', () => {
    it('MARROW015 hits for a hidden skeleton that the game updates itself', async () => {
        const hero = await spine(OWL);
        const root = stageOf(hero);
        const seen = watch(root);

        for (let i = 0; i < 3; i++) hero.update(FRAME);
        expect(hitsOf(seen.report(), 'MARROW015')).toEqual([]);

        hero.visible = false;
        const hidden = watch(root);

        expect(hitsOf(hidden.report(), 'MARROW015')).toEqual([]);
        for (let i = 0; i < 3; i++) hero.update(FRAME);
        expect(hitsOf(hidden.report(), 'MARROW015')[0]?.measured).toMatchObject({ updates: 3 });
    });

    it('MARROW019 hits when the image of the idle cache goes away twice between samples', async () => {
        const hero = await spine(OWL, { idleCache: 'auto' });
        const image = hero.addChild(new Container({ label: 'marrow-idle' }));
        const watching = watch(stageOf(hero));
        const show = (visible: boolean): void => {
            image.visible = visible;
            watching.sample();
        };

        show(false);
        show(true);
        expect(hitsOf(watching.report(), 'MARROW019')).toEqual([]);
        for (const visible of [true, false, true, false]) show(visible);
        expect(hitsOf(watching.report(), 'MARROW019')[0]?.measured).toMatchObject({ drops: 2 });
    });

    it('MARROW023 hits when the game sets another skin again and again', async () => {
        const hero = await spine('4.2/mix-and-match-pro.skel');
        const watching = watch(stageOf(hero));
        const { skins } = hero.info;

        hero.update(FRAME);
        expect(hitsOf(watching.report(), 'MARROW023')).toEqual([]);
        for (let i = 1; i <= 4; i++) {
            hero.skins = [skins[i] ?? ''];
            hero.update(FRAME);
        }
        expect(hitsOf(watching.report(), 'MARROW023')[0]?.measured.templateBuilds).toBe(4);
    });

    /** Changes the animation of track 0 six times, each before the mix of a quarter second ends. */
    async function churn(id: string): Promise<string[]> {
        const hero = await spine(id);
        const watching = watch(stageOf(hero));

        hero.defaultMix = 0.25;
        for (let change = 0; change < 6; change++) {
            hero.play(change % 2 === 0 ? 'walk' : 'run', { loop: true });
            for (let i = 0; i < 10; i++) hero.update(FRAME);
        }
        const result = watching.report();

        watching.stop();

        return idsOf(result);
    }

    it('MARROW025 hits for a 4.3 track that changes faster than its mix, and not for 4.2', async () => {
        expect(await churn('4.3/spineboy-pro.skel')).toContain('MARROW025');
        expect(await churn('4.2/spineboy-pro.skel')).not.toContain('MARROW025');
    });

    it('MARROW025 says nothing for a 4.3 track whose mix ends before the next change', async () => {
        const hero = await spine('4.3/spineboy-pro.skel');
        const watching = watch(stageOf(hero));

        hero.defaultMix = 0.1;
        for (let change = 0; change < 6; change++) {
            hero.play(change % 2 === 0 ? 'walk' : 'run', { loop: true });
            for (let i = 0; i < 20; i++) hero.update(FRAME);
        }
        expect(idsOf(watching.report())).not.toContain('MARROW025');
        watching.stop();
        expect(hero.listenerCount('start')).toBe(0);
    });
});

describe('a watch', () => {
    it('starts the next report from the last one, and forgets a skeleton that left the tree', async () => {
        const { stage, holder, heroes } = await reel();
        const watching = watch(stage.root);

        for (let i = 0; i < 3; i++) {
            holder.x += 1;
            frame(stage, heroes);
        }
        expect(idsOf(watching.report())).toContain('MARROW001');
        for (let i = 0; i < 3; i++) frame(stage, heroes);
        expect(idsOf(watching.report())).not.toContain('MARROW001');
        holder.removeChildren();
        expect(watching.report().skeletons).toBe(0);
    });
});
