import { describe, expect, it } from 'vitest';
import { collectShapes, type RegionOffsets } from '../../src/debug/shapes';
import { meshSource } from '../../src/pose/shared/lookup';
import { createPoseState, type PoseState, WORLD_STRIDE } from '../../src/pose/state';
import { fixtureFiles } from '../api/helpers';
import { type GeometryRig, loadGeometryRig } from '../parity/geometry-check';
import type { OfficialShown } from '../parity/geometry-official';

/*
 * The shapes the debug overlays draw, against the official runtime of each version. The official
 * skeleton plays an animation. Its bones and what its slots show go into a pose state, and the
 * shapes of that pose must be the numbers the official `computeWorldVertices` writes, to the bit.
 */

const RIGS = ['spineboy-pro', 'tank-pro', 'coin-pro', 'stretchyman-pro'];
const FRAMES = 6;

/** Our pose state with the official bones and the attachments, deforms and sequence indices of the official slots. */
function stateOf(rig: GeometryRig, shown: readonly OfficialShown[], world: (out: Float64Array) => void): PoseState {
    const state = createPoseState(rig.model);

    world(state.world);
    state.active.fill(1);
    // the order of the slots in the file, as the official skeleton in its setup pose has it
    state.drawOrder.forEach((_, i) => {
        state.drawOrder[i] = i;
    });
    for (const each of shown) {
        state.attachments[each.slot] = rig.lookup.resolve(each.ref) ?? null;
        state.sequenceIndices[each.slot] = each.sequenceIndex;
        state.deform[each.slot] = Float64Array.from(each.deform);
        state.deformLengths[each.slot] = each.deform.length;
    }

    return state;
}

/** What the official `computeWorldVertices` writes for one attachment, as plain numbers. */
function officialWorld(shown: OfficialShown): number[] {
    const out: number[] = [];

    shown.computeWorld(0, shown.worldVerticesLength, out, 0, 2);

    return out;
}

describe.each(['4.1', '4.2', '4.3'])('the debug shapes of Spine %s', (version) => {
    it.each(RIGS)('equal the official world vertices on %s', async (name) => {
        const rig = await loadGeometryRig(fixtureFiles(`${version}/${name}.json`));
        const cache: RegionOffsets = new Map();
        const { animations, skins } = rig.official;
        let compared = 0;

        for (const animation of animations.slice(0, 3)) {
            const playback = rig.official.play(animation.name, skins.at(-1));
            const dt = (animation.duration > 0 ? animation.duration : 1) / FRAMES;

            for (let frame = 0; frame < FRAMES; frame++) {
                playback.step(frame === 0 ? 0 : dt);
                const shown = playback.shown().sort((a, b) => a.slot - b.slot);
                const state = stateOf(rig, shown, (out) => playback.readBones(out));
                const shapes = collectShapes(state, rig.lookup, rig.atlas, cache);
                const of = (type: OfficialShown['type']) => shown.filter((each) => each.type === type);

                expect(shapes.regions.map((quad) => [...quad])).toEqual(of('region').map(officialWorld));
                expect(shapes.boxes.map((box) => [...box])).toEqual(of('boundingbox').map(officialWorld));
                expect(shapes.clips.map((clip) => [...clip])).toEqual(of('clipping').map(officialWorld));
                expect(shapes.paths.map((path) => [...path.points])).toEqual(of('path').map(officialWorld));
                // the hull is the start of the world vertices of a mesh, the triangles index them
                const meshes = of('mesh');
                const triangles: number[] = [];

                expect(shapes.hulls).toHaveLength(meshes.filter((mesh) => sourceOf(rig, mesh).hullLength > 0).length);
                meshes.forEach((mesh) => {
                    const world = officialWorld(mesh);
                    const source = sourceOf(rig, mesh);

                    for (const vertex of source.triangles)
                        triangles.push(world[vertex * 2] ?? 0, world[vertex * 2 + 1] ?? 0);
                });
                expect(shapes.triangles).toEqual(triangles);
                // every bone, from its position along its x axis for its length
                expect(shapes.bones).toHaveLength(rig.model.bones.count * 4);
                for (let bone = 0; bone < rig.model.bones.count; bone++) {
                    const m = bone * WORLD_STRIDE;
                    const length = rig.model.bones.lengths[bone] ?? 0;
                    const [a = 0, , c = 0, , x = 0, y = 0] = state.world.subarray(m, m + 6);

                    expect(shapes.bones.slice(bone * 4, bone * 4 + 4)).toEqual([x, y, x + length * a, y + length * c]);
                }
                compared += shown.length;
            }
        }
        expect(compared).toBeGreaterThan(0);
    });
});

function sourceOf(rig: GeometryRig, shown: OfficialShown) {
    const attachment = rig.lookup.resolve(shown.ref);

    if (attachment?.type !== 'mesh') throw new Error(`${shown.ref.name} is no mesh`);

    return meshSource(rig.lookup, attachment);
}
