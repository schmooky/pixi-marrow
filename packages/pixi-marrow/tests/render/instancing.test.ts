import { describe, expect, it } from 'vitest';
import { touchPose } from '../../src/pose/state';
import { NO_ENTRY } from '../../src/render/instance-pool';
import { listFixtures } from '../parity/fixtures';
import { loadFamily, populate } from './batch-check';
import { createStage } from './batch-stage';
import {
    instanceOf,
    loadInstanced,
    type ShadedVertex,
    shadeAlone,
    shadeInstanced,
    shownEntries,
} from './instance-check';
import { drawPose, meshes, play, type Rig, readDrawn, slotIndex, step, visibleSlots } from './rig';

/*
 * `instancing: 'auto'`: views of the mesh mode with `skinning: 'gpu'` that follow each other in
 * Pixi's render order draw in one instanced draw. The tests play the vertex shader of an
 * instanced view and of a view that draws alone in JavaScript, see `instance-check.ts`, and hold
 * them against each other. The render check draws both in a browser and compares the pixels.
 */

/** The options of a view that draws instanced. */
const GPU = { renderMode: 'mesh', skinning: 'gpu', instancing: 'auto' } as const;

/** The animations of a rig, up to a count. */
const animationsOf = (rig: Rig, count: number): string[] =>
    rig.model.animations.slice(0, count).map((animation) => animation.name);

/** Plays the same animation on two rigs of one fixture and steps both alike. */
function twins(rigs: Rig[], animation: string, dt: number): void {
    for (const rig of rigs) {
        if (dt === 0) play(rig, animation);
        step(rig, dt);
    }
}

/** The vertices of a draw, sorted by vertex number. */
const sorted = (vertices: Map<number, ShadedVertex>): [number, ShadedVertex][] =>
    [...vertices].sort(([a], [b]) => a - b);

/**
 * Holds what an instanced view draws against its twin that draws alone. Returns false for a view
 * that draws alone itself: a layout that needs more than one draw range, or a clip that cuts.
 */
function compare(rig: Rig, alone: Rig): boolean {
    if (rig.view.parts.paints.mesh?.why !== null) return false;
    expect(meshes(rig.view)).toHaveLength(0);
    expect(sorted(shadeInstanced(rig))).toEqual(sorted(shadeAlone(alone)));

    return true;
}

describe('instancing', () => {
    // every official export, in both formats: the instanced draw shows what the view alone shows
    it.each(listFixtures().map((fixture) => fixture.id))(
        'draws what %s shows as the view alone does, to the bit',
        async (id) => {
            const rig = await loadInstanced(id);
            const alone = await loadInstanced(id, true);
            let compared = 0;

            for (const twin of [rig, alone]) {
                // a rig of several skins shows little with the default skin alone
                if (twin.model.skins.length > 1) {
                    twin.engine.setSkin(twin.model.skins.length - 1);
                    twin.engine.setupPoseSlots();
                }
            }
            for (const animation of animationsOf(rig, 3)) {
                for (let frame = 0; frame < 4; frame++) {
                    twins([rig, alone], animation, frame === 0 ? 0 : 0.1);
                    if (compare(rig, alone)) compared++;
                }
            }
            // the layouts that can never draw instanced are a few of the fixtures
            if (rig.view.parts.paints.mesh?.why === null) expect(compared).toBeGreaterThan(0);
        },
        60_000,
    );

    it('copies the vertices the CPU places and the regions of a sequence into the slot', async () => {
        const rig = await loadInstanced('4.3/dragon-ess.skel');
        const alone = await loadInstanced('4.3/dragon-ess.skel', true);
        let sequences = 0;

        twins([rig, alone], 'flying', 0);
        for (let frame = 0; frame < 12; frame++) {
            twins([rig, alone], 'flying', 0.05);
            expect(sorted(shadeInstanced(rig))).toEqual(sorted(shadeAlone(alone)));
            sequences += readDrawn(alone).filter((item) => item.attachment.sequence !== null).length;
        }
        expect(sequences).toBeGreaterThan(0);
        expect(instanceOf(rig).layout?.shape.cpuTexels).toBeGreaterThan(0);
    });

    it('shows the entry of every visible slot, and none for a hidden, transparent or covered one', async () => {
        const rig = await loadInstanced('4.2/spineboy-pro.skel');
        const { state } = rig.engine;
        const eye = slotIndex(rig, 'eye');
        const torso = slotIndex(rig, 'torso');

        step(rig, 0);
        const shown = shownEntries(rig);
        const visible = new Set(visibleSlots(rig).map((item) => item.slot));

        for (let slot = 0; slot < rig.model.slots.count; slot++) {
            expect(shown[slot] !== NO_ENTRY, `slot ${rig.model.slots.names[slot]}`).toBe(visible.has(slot));
        }
        state.attachments[eye] = null;
        state.colors[torso * 4 + 3] = 0;
        drawPose(rig.view, state);
        expect(shownEntries(rig)[eye]).toBe(NO_ENTRY);
        expect(shownEntries(rig)[torso]).toBe(NO_ENTRY);
    });

    it('draws alone while a clip cuts a visible slot, and instanced again once it is gone', async () => {
        const rig = await loadInstanced('4.2/spineboy-pro.skel');
        const alone = await loadInstanced('4.2/spineboy-pro.skel', true);
        const { state } = rig.engine;
        const clip = rig.model.slots.names.indexOf('clipping');
        const clipping = rig.lookup.find(state.skin, clip, 'clipping');

        if (clipping === undefined) throw new Error('spineboy has a clipping attachment');
        twins([rig, alone], 'portal', 0);
        for (const shows of [true, false, true, false]) {
            for (const twin of [rig, alone]) {
                twin.engine.state.attachments[clip] = shows ? clipping : null;
                touchPose(twin.engine.state);
                twin.view.update(twin.engine.state);
            }
            const paint = rig.view.parts.paints.mesh;

            expect(paint?.why).toBe(shows ? 'clip' : null);
            expect(meshes(rig.view).length > 0).toBe(shows);
            expect(paint?.instanced?.body.visible ?? false).toBe(!shows);
            if (!shows) expect(sorted(shadeInstanced(rig))).toEqual(sorted(shadeAlone(alone)));
        }
    });

    it('draws a run in one instanced draw, and splits it where a Pixi object or another draw order comes between', async () => {
        const stage = createStage();
        const family = await loadFamily('4.3/raptor-pro.skel');
        const rigs = await populate(stage, family, 3, GPU);

        for (const rig of rigs) {
            play(rig, 'walk');
            step(rig, 0);
        }
        stage.render();
        expect(stage.counts.draws).toMatchObject([{ kind: 'instanced', instances: 3 }]);
        const builds = stage.counts.builds;
        const [, middle] = rigs;

        if (middle === undefined) throw new Error('three rigs');
        // another draw order: the run draws in three parts, and Pixi builds nothing
        middle.engine.state.drawOrder.reverse();
        drawPose(middle.view, middle.engine.state);
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.instances)).toEqual([1, 1, 1]);
        expect(stage.counts.builds).toBe(builds);
        middle.engine.state.drawOrder.reverse();
        drawPose(middle.view, middle.engine.state);
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.instances)).toEqual([3]);
        // a member at alpha 0 is left out, and the others still draw together
        middle.view.container.alpha = 0;
        stage.render();
        expect(stage.counts.draws.map((draw) => draw.instances)).toEqual([2]);
        middle.view.container.alpha = 1;
        // a skeleton that draws alone, between the second and the third: the run ends at its meshes
        const [between] = await populate(stage, family, 1, { ...GPU, instancing: 'off' });

        if (between === undefined) throw new Error('one rig');
        stage.root.addChildAt(between.view.container, 2);
        stage.render();
        expect(stage.counts.draws.map((draw) => `${draw.kind} ${draw.instances}`)).toEqual([
            'instanced 2',
            'mesh 1',
            'instanced 1',
        ]);
    });
});
