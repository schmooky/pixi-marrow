import { type Container, Mesh } from 'pixi.js';
import { expect } from 'vitest';
import type { ClippingAttachmentData } from '../../src/model/attachments';
import type { SkeletonView } from '../../src/render/skeleton-view';
import { clipPolygon, type OfficialClipper, type OfficialClips, walkOfficial } from './clip-official';
import { expectKernel, meshes, type Rig } from './rig';

/*
 * Checks what the view clips against the official clipper. The view is read from the outside:
 * which container a mesh is in, and the polygon and triangles in the buffers of its mask.
 */

/** A stretch of clipped ranges that draws: a container of the view, its mask and its meshes. */
export interface ClipGroup {
    container: Container;
    mask: Mesh;
    /** Whether Pixi draws the container outside of the mask. */
    inverse: boolean;
    meshes: Mesh[];
}

/** The clip groups of the view that draw at the moment, in draw order. */
export function clipGroups(view: SkeletonView): ClipGroup[] {
    const groups: ClipGroup[] = [];

    for (const child of view.container.children) {
        if (child instanceof Mesh || !child.visible) continue;
        const { mask } = child;

        if (!(mask instanceof Mesh)) throw new Error('a container of the view has no mesh as its mask');
        groups.push({
            container: child,
            mask,
            inverse: child._maskOptions?.inverse === true,
            meshes: child.children.filter(
                (mesh): mesh is Mesh => mesh instanceof Mesh && mesh.visible && mesh !== mask,
            ),
        });
    }

    return groups;
}

/** The polygon a mask holds, x and y per vertex, and the triangles it draws. */
export function maskShape(mask: Mesh): { positions: Float32Array; triangles: number[] } {
    const positions = mask.geometry.getBuffer('aPosition').data;
    const { data } = mask.geometry.indexBuffer;

    if (!(positions instanceof Float32Array)) throw new Error('the mask has no positions');
    // Pixi draws the whole index buffer for a count of 0. The view keeps it zero then
    if (mask.geometry.indexCount === 0) expect(Array.from(data).every((index) => index === 0)).toBe(true);

    return { positions, triangles: Array.from(data.subarray(0, mask.geometry.indexCount)) };
}

/** A clipping attachment as an importer would store it, without weights. */
export function clipAttachment(
    name: string,
    endSlot: number,
    vertices: readonly number[],
    flags: { inverse?: boolean; convex?: boolean } = {},
): ClippingAttachmentData {
    return {
        type: 'clipping',
        name,
        endSlot,
        convex: flags.convex ?? false,
        inverse: flags.inverse ?? false,
        vertices: Float32Array.from(vertices),
        bones: null,
        worldVerticesLength: vertices.length,
    };
}

/** Whether a point is inside one of the triangles of a mask, edges included. */
function inTriangles(positions: ArrayLike<number>, triangles: readonly number[], x: number, y: number): boolean {
    const side = (a: number, b: number): number => {
        const ax = positions[a * 2] ?? 0;
        const ay = positions[a * 2 + 1] ?? 0;

        return ((positions[b * 2] ?? 0) - ax) * (y - ay) - ((positions[b * 2 + 1] ?? 0) - ay) * (x - ax);
    };

    for (let t = 0; t < triangles.length; t += 3) {
        const [a = 0, b = 0, c = 0] = triangles.slice(t, t + 3);
        const [ab, bc, ca] = [side(a, b), side(b, c), side(c, a)];

        if ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)) return true;
    }

    return false;
}

/** How many sample points a mask was compared at, by what the clip does there. */
export interface MaskSamples {
    /** Points the clip keeps. */
    kept: number;
    /** Points the clip removes. */
    removed: number;
    /** Points next to an edge, where a small triangle is cut. They are not compared. */
    edge: number;
}

/** The triangles of a mask, and whether what is outside of them is kept. */
export interface MaskArea {
    /** x, y per vertex. */
    positions: ArrayLike<number>;
    /** Three vertex numbers per triangle. */
    triangles: readonly number[];
    inverse: boolean;
}

/**
 * Compares the area a mask keeps with the area the official clipper keeps, at a grid of points
 * around the polygon. At each point a small triangle goes through the official clipper. The
 * mask must keep the point exactly when the triangle comes back whole.
 */
export function expectArea(area: MaskArea, polygon: ArrayLike<number>, clipper: OfficialClipper): MaskSamples {
    const xs = Array.from(polygon).filter((_, i) => i % 2 === 0);
    const ys = Array.from(polygon).filter((_, i) => i % 2 === 1);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const extent = Math.max(maxX - minX, maxY - minY, 1e-6);
    const size = extent * 1e-4;
    const steps = 28;
    const samples: MaskSamples = { kept: 0, removed: 0, edge: 0 };
    const wrong: string[] = [];

    for (let i = 0; i < steps * steps; i++) {
        // a grid a quarter larger than the polygon, each point moved off the grid lines
        const x = minX - extent * 0.25 + (((i % steps) + 0.37 + 0.2 * Math.sin(i)) / steps) * extent * 1.5;
        const y = minY - extent * 0.25 + ((Math.floor(i / steps) + 0.61 + 0.2 * Math.cos(i)) / steps) * extent * 1.5;
        const corners = [x, y, x + size, y, x, y + size];
        const share = clipper.kept(corners);
        const inside = [0, 2, 4].map((c) =>
            inTriangles(area.positions, area.triangles, corners[c] ?? 0, corners[c + 1] ?? 0),
        );
        const ours = inside[0] !== area.inverse;

        if ((share > 0.001 && share < 0.999) || inside.some((corner) => corner !== inside[0])) samples.edge++;
        else {
            if (share >= 0.999) samples.kept++;
            else samples.removed++;
            if (ours !== share >= 0.999) wrong.push(`${x},${y}: official keeps ${share}, the mask ${ours}`);
        }
    }
    expect(wrong, 'points where the mask and the official clipper differ').toEqual([]);

    return samples;
}

/** {@link expectArea} for the mask of a clip group of the view. */
const expectMask = (group: ClipGroup, polygon: ArrayLike<number>, clipper: OfficialClipper): MaskSamples =>
    expectArea({ ...maskShape(group.mask), inverse: group.inverse }, polygon, clipper);

/**
 * Checks the clips of the view against the official clipper for the current pose: which slots
 * each clip cuts, that those slots are drawn through a mask of their own, that the mask keeps the
 * area the official clipper keeps, and what the stats say. Returns what the official loop did.
 */
export function expectClips(rig: Rig): OfficialClips & { samples: MaskSamples[] } {
    const { view } = rig;
    const drawn = expectKernel(rig);
    const all = meshes(view);
    const groups = clipGroups(view);
    const official = walkOfficial(rig);
    const groupOf = new Map<number, Container>();

    expect(official.cuts.length, 'visible slots in the official loop').toBe(drawn.length);
    drawn.forEach(({ slot, range }, i) => {
        const cut = official.cuts[i] ?? -1;
        const parent = all[range]?.parent;
        const name = rig.model.slots.names[slot];

        if (cut === -1) expect(parent, `slot ${name} is not clipped`).toBe(view.container);
        else {
            expect(parent, `slot ${name} is clipped`).not.toBe(view.container);
            if (parent != null && !groupOf.has(cut)) groupOf.set(cut, parent);
            expect(parent, `slot ${name} is clipped by slot ${rig.model.slots.names[cut]}`).toBe(groupOf.get(cut));
        }
    });
    // one container per clip that cuts a visible slot, in draw order, and no other
    expect(groups.map((group) => group.container)).toEqual([...groupOf.values()]);
    expect(view.stats.clips).toBe(official.started.length);
    expect(view.stats.maskDraws).toBe(groups.length * 2);
    expect(view.stats.drawCalls).toBe(all.length + groups.length * 2);
    const samples: MaskSamples[] = [];

    walkOfficial(rig, (slot, attachment, clipper) => {
        const group = groups.find((candidate) => candidate.container === groupOf.get(slot));

        if (group === undefined) return;
        expect(group.inverse, `inverse of ${attachment.name}`).toBe(rig.model.version === '4.3' && attachment.inverse);
        samples.push(expectMask(group, clipPolygon(rig, slot, attachment), clipper));
    });
    expect(samples.length).toBe(groups.length);

    return { ...official, samples };
}
