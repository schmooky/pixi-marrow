import { Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createPoseEngine } from '../../src/pose/engine';
import { SkeletonView } from '../../src/render/skeleton-view';
import {
    type Drawn,
    expectKernel,
    kernelUVs,
    loadRig,
    meshes,
    play,
    type Rig,
    readDrawn,
    readFlags,
    step,
    vertexData,
} from './rig';

const NORMAL = 0;
const ADDITIVE = 1;
const MULTIPLY = 2;
const SCREEN = 3;

/** The Pixi blend mode a range of each slot blend mode must have. */
const PIXI_BLEND = ['inherit', 'inherit', 'multiply', 'screen'];

const blendOf = (rig: Rig, slot: number): number => rig.model.slots.blendModes[slot] ?? NORMAL;

/**
 * The ranges the visible slots must fall into, worked out here: a new range starts where the
 * blend state or the group of 8 pages changes. Additive counts as normal.
 */
function expectedRanges(rig: Rig, drawn: readonly Drawn[]): { blend: number; group: number; slots: number[] }[] {
    const ranges: { blend: number; group: number; slots: number[] }[] = [];

    for (const { slot, attachment } of drawn) {
        const blend = blendOf(rig, slot) === ADDITIVE ? NORMAL : blendOf(rig, slot);
        const group = Math.floor(kernelUVs(rig, slot, attachment).page / 8);
        const open = ranges.at(-1);

        if (open !== undefined && open.blend === blend && open.group === group) open.slots.push(slot);
        else ranges.push({ blend, group, slots: [slot] });
    }

    return ranges;
}

/** Checks the meshes of the view against {@link expectedRanges}: which slots, and which blend mode. */
function expectRanges(rig: Rig): { blend: number; group: number; slots: number[] }[] {
    const drawn = expectKernel(rig);
    const expected = expectedRanges(rig, drawn);
    const actual = meshes(rig.view);

    expect(rig.view.stats.drawCalls).toBe(expected.length);
    expect(actual.length).toBe(expected.length);
    expected.forEach((range, index) => {
        expect(drawn.filter((item) => item.range === index).map((item) => item.slot)).toEqual(range.slots);
        expect(actual[index]?.blendMode).toBe(PIXI_BLEND[range.blend]);
    });

    return expected;
}

/** Shows the first attachment the default skin has for a slot, at full alpha. */
function show(rig: Rig, slot: number): void {
    const { state } = rig.engine;
    const entry = rig.model.skins[rig.lookup.defaultSkin]?.attachments.find(
        (item) => item.slot === slot && (item.attachment.type === 'region' || item.attachment.type === 'mesh'),
    );

    if (entry === undefined) throw new Error(`slot ${slot} has nothing to show`);
    state.attachments[slot] = entry.attachment;
    state.colors[slot * 4 + 3] = 1;
}

describe('draw ranges', () => {
    it('draws additive slots in the range of their neighbours', async () => {
        const rig = await loadRig('4.2/spineboy-pro.skel');
        const { blendModes, count } = rig.model.slots;
        const additive = Array.from({ length: count }, (_, slot) => slot).filter(
            (slot) => blendModes[slot] === ADDITIVE,
        );

        expect(additive.length).toBeGreaterThan(0);
        step(rig, 0);
        for (const slot of additive) show(rig, slot);
        rig.view.update(rig.engine.state);
        const drawn = expectKernel(rig);
        const { statics } = vertexData(rig.view);

        expect(rig.view.stats.drawCalls).toBe(1);
        expect(meshes(rig.view)[0]?.blendMode).toBe('inherit');
        expect(additive.every((slot) => drawn.some((item) => item.slot === slot))).toBe(true);
        // the shader gets the additive flag per vertex
        for (const { slot, first, count: vertices } of drawn) {
            const flag = blendModes[slot] === ADDITIVE ? 255 : 0;

            expect(readFlags(statics, first).additive).toBe(flag);
            expect(readFlags(statics, first + vertices - 1).additive).toBe(flag);
        }
    });

    it.each(['4.2/tank-pro.skel', '4.3/celestial-circus-pro.skel', '4.2/snowglobe-pro.skel'])(
        'starts a new range at every multiply slot of %s',
        async (id) => {
            const rig = await loadRig(id);
            let most = 0;

            for (const animation of rig.model.animations.slice(0, 3)) {
                play(rig, animation.name);
                for (let frame = 0; frame < 6; frame++) {
                    step(rig, animation.duration / 5.5);
                    const ranges = expectRanges(rig);

                    most = Math.max(most, ranges.length);
                    expect(ranges.some((range) => range.blend === MULTIPLY)).toBe(true);
                }
            }
            expect(most).toBeGreaterThan(1);
            expect(rig.view.stats.templateBuilds).toBe(1);
        },
    );

    it('splits at a screen slot, and joins the ranges again when it hides', async () => {
        let screen = -1;
        const rig = await loadRig('4.2/spineboy-pro.skel', (model) => {
            screen = model.slots.names.indexOf('torso');
            model.slots.blendModes[screen] = SCREEN;
        });
        const { state } = rig.engine;

        step(rig, 0);
        expect(expectRanges(rig).map((range) => range.blend)).toEqual([NORMAL, SCREEN, NORMAL]);
        expect(rig.view.container.children.length).toBe(3);
        const positions = vertexData(rig.view).positions;

        state.colors[screen * 4 + 3] = 0;
        rig.view.update(state);
        expect(expectRanges(rig).map((range) => range.blend)).toEqual([NORMAL]);
        // the two meshes wait, hidden, and come back without a new one
        expect(rig.view.container.children.length).toBe(3);
        state.colors[screen * 4 + 3] = 1;
        rig.view.update(state);
        expect(expectRanges(rig).map((range) => range.blend)).toEqual([NORMAL, SCREEN, NORMAL]);
        expect(rig.view.container.children.length).toBe(3);
        // a screen slot first in the draw order: the first mesh changes its blend mode
        const at = state.drawOrder.indexOf(screen);

        state.drawOrder.copyWithin(1, 0, at);
        state.drawOrder[0] = screen;
        rig.view.update(state);
        expect(expectRanges(rig).map((range) => range.blend)).toEqual([SCREEN, NORMAL]);
        expect(rig.view.stats.templateBuilds).toBe(1);
        expect(vertexData(rig.view).positions).toBe(positions);
    });

    it.each(['4.2/chibi-stickers.skel', '4.3/chibi-stickers.skel'])(
        'samples up to 8 pages in a range and splits at the ninth for %s',
        async (id) => {
            const rig = await loadRig(id);
            const groups = new Set<number>();

            expect(rig.atlas.pages.length).toBeGreaterThan(8);
            for (let skin = 0; skin < rig.model.skins.length; skin++) {
                rig.engine.setSkin(skin);
                rig.engine.setupPoseSlots();
                step(rig, 0);
                for (const range of expectRanges(rig)) groups.add(range.group);
            }
            expect([...groups].sort()).toEqual([0, 1]);
        },
    );

    it('binds the pages of each group of 8 to the shader of its range', async () => {
        const { model, atlas, lookup } = await loadRig('4.3/chibi-stickers.skel');
        const pages = atlas.pages.map(() => new Texture({ source: new TextureSource({ width: 2, height: 2 }) }));
        const engine = await createPoseEngine(model, { constraints: 'ignore' });
        const view = new SkeletonView(model, atlas, pages);
        const rig: Rig = { model, atlas, lookup, engine, view };
        const seen = new Set<number>();

        for (let skin = 0; skin < model.skins.length; skin++) {
            engine.setSkin(skin);
            engine.setupPoseSlots();
            step(rig, 0);
            const ranges = expectRanges(rig);

            meshes(view).forEach((mesh, index) => {
                const group = ranges[index]?.group ?? -1;
                const inGroup = pages.slice(group * 8, group * 8 + 8);

                seen.add(group);
                inGroup.forEach((page, unit) => {
                    expect(mesh.shader?.resources[`uTexture${unit}`]).toBe(page.source);
                    expect(mesh.shader?.resources[`uSampler${unit}`]).toBe(page.source.style);
                });
                expect(mesh.shader?.resources[`uTexture${inGroup.length}`]).toBeUndefined();
            });
        }
        expect([...seen].sort()).toEqual([0, 1]);
        // 11 pages: a program for 8 textures and one for 3
        expect(new Set(meshes(view).map((mesh) => mesh.shader?.glProgram)).size).toBeLessThanOrEqual(2);
    });

    it('one draw call for every fixture with normal and additive slots on up to 8 pages', async () => {
        for (const id of [
            '4.1/raptor-pro.skel',
            '4.2/dragon-ess.skel',
            '4.3/mix-and-match-pro.skel',
            '4.2/alien-pro.skel',
        ]) {
            const rig = await loadRig(id);

            expect(rig.model.slots.blendModes.every((blend) => blend <= ADDITIVE)).toBe(true);
            for (const animation of rig.model.animations.slice(0, 3)) {
                play(rig, animation.name);
                for (let frame = 0; frame < 4; frame++) {
                    step(rig, animation.duration / 3.5);
                    expect(readDrawn(rig).length === 0 ? 0 : 1).toBe(rig.view.stats.drawCalls);
                }
            }
        }
    });
});
