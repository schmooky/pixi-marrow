import { Container } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { ruleDocs } from '../../src/base/errors';
import type { MarrowSpine, PerfEntry } from '../../src/index';
import { cleanUp, spine } from '../diagnose/scene';
import { createStage, type Stage } from '../render/batch-stage';
import { FRAME } from './helpers';

/*
 * The row `motion` of the perf report says "uploaded nothing" only when that is true. A pose at
 * rest below a container that moves or fades still writes every vertex of a batched skeleton.
 */

const OWL = '4.2/owl-pro.skel';

afterEach(cleanUp);

async function motion(hero: MarrowSpine): Promise<PerfEntry> {
    const row = (await hero.perf.report()).find((entry) => entry.feature === 'motion');

    if (row === undefined) throw new Error('the report has no row motion');

    return row;
}

/** A batched owl below a container on a stage, drawn twice. */
async function scene(): Promise<{ stage: Stage; holder: Container; hero: MarrowSpine; frame: () => void }> {
    const stage = createStage();
    const holder = new Container();
    const hero = await spine(OWL, { renderMode: 'batched' });
    const frame = (): void => {
        hero.update(FRAME);
        stage.render();
    };

    stage.root.addChild(holder);
    holder.addChild(hero);
    frame();
    frame();

    return { stage, holder, hero, frame };
}

describe('the row motion of the perf report', () => {
    it('says at rest and uploaded nothing for a frame without bytes', async () => {
        const { hero, frame } = await scene();

        frame();
        const row = await motion(hero);

        expect(hero.stats.frameBytes).toBe(0);
        expect(row.value).toBe('at rest');
        expect(row.reason).toContain('placed no vertex and uploaded nothing');
        expect(row.rule).toBeUndefined();
        expect(row.data).toMatchObject({ skipped: true, frameBytes: 0, transformReplaces: 0, tintRewrites: 0 });
    });

    it('names MARROW001 when a container above the skeleton moved, with the bytes of the frame', async () => {
        const { hero, holder, frame } = await scene();

        for (let i = 0; i < 2; i++) {
            holder.x += 4;
            frame();
        }
        const row = await motion(hero);

        expect(hero.stats.frameBytes).toBeGreaterThan(0);
        expect(row.value).toBe('pose at rest, the batch still writes');
        expect(row.reason).not.toContain('uploaded nothing');
        expect(row.reason).toContain('2 frames placed every vertex again (MARROW001)');
        expect(row.reason).toContain(`handed ${hero.stats.frameBytes} bytes to the GPU`);
        expect(row).toMatchObject({ rule: 'MARROW001', docs: ruleDocs('MARROW001') });
        expect(row.data).toMatchObject({ skipped: true, transformReplaces: 2, frameBytes: hero.stats.frameBytes });

        // the next report counts from this one: nothing moved since
        frame();
        expect((await motion(hero)).value).toBe('at rest');
    });

    it('names MARROW002 when the alpha above the skeleton changed', async () => {
        const { hero, holder, frame } = await scene();

        holder.alpha = 0.5;
        frame();
        const row = await motion(hero);

        expect(row).toMatchObject({ rule: 'MARROW002', docs: ruleDocs('MARROW002') });
        expect(row.reason).toContain('1 frame wrote the static data of every vertex again (MARROW002)');
    });

    it('names MARROW014 when the batch wrote the skeleton for a build of the instructions', async () => {
        const { stage, hero, frame } = await scene();

        stage.root.addChild(new Container());
        frame();
        const row = await motion(hero);

        expect(hero.stats.frameBytes).toBeGreaterThan(0);
        expect(row).toMatchObject({ rule: 'MARROW014', value: 'pose at rest, the batch still writes' });
    });

    it('adds the cause to a row of a skeleton that moves, and no rule to one that only plays', async () => {
        const { hero, holder, frame } = await scene();

        const [longest] = [...hero.info.animations].sort((a, b) => b.duration - a.duration);

        hero.play(longest?.name ?? '', { loop: true });
        frame();
        frame();
        const playing = await motion(hero);

        expect(playing.rule).toBeUndefined();
        expect(playing.value).toMatch(/ bones, /);
        holder.y += 1;
        frame();
        const moved = await motion(hero);

        expect(moved.rule).toBe('MARROW001');
        expect(moved.reason).toMatch(/Also, a display object above the skeleton moved/);
    });
});
