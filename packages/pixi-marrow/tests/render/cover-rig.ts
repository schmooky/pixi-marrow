import type { AtlasOutlines } from '../../src/model/outlines';
import type { SkeletonViewOptions } from '../../src/render/skeleton-view';
import type { RigFiles } from '../parity/official';
import { cutView, setOpaque } from './cuts';
import { createRig, type Rig, step } from './rig';

/*
 * Small skeletons for the test of covered slots: a few slots in a given draw order, each on a
 * bone of its own that sits where the test puts it. The regions are squares, so a slot at
 * (0, 0) lies around the origin, and the opaque rectangle of a region is the square without a
 * rim of 5 percent.
 */

/** One slot of a cover rig. It shows the region of its `shows` name, as a region attachment unless said otherwise. */
export interface CoverSlot {
    name: string;
    /** The region: `big` (200 pixels), `mid` (100), `small` (20), or `seq` for a sequence of two regions. */
    shows: 'big' | 'mid' | 'small' | 'seq';
    /** Where the bone of the slot is. Default 0, 0. */
    at?: [number, number];
    /** The scale of the bone. Default 1. */
    scale?: number;
    blend?: 'additive' | 'multiply' | 'screen';
    /** The slot color as hex with alpha. */
    color?: string;
    /** A dark color as hex, which makes the skeleton use two color tint. */
    dark?: string;
    /** `mesh` shows the region as a mesh of four vertices. `clip` shows a clipping triangle that ends at the slot named in `end`. */
    as?: 'mesh' | 'clip';
    end?: string;
    /** The color of the attachment as hex with alpha. */
    tint?: string;
}

const SIZES = { big: 200, mid: 100, small: 20, seq: 100 };

const ATLAS = [
    'cover.png',
    'size: 512, 512',
    'filter: Linear, Linear',
    'big',
    'bounds: 0, 0, 200, 200',
    'mid',
    'bounds: 210, 0, 100, 100',
    'small',
    'bounds: 320, 0, 20, 20',
    'seq_0',
    'bounds: 0, 210, 100, 100',
    'seq_1',
    'bounds: 110, 210, 100, 100',
    '',
].join('\n');

/** The rim of a region that is not opaque, as a share of its side. */
const RIM = 0.05;

function attachment(slot: CoverSlot): object {
    const size = SIZES[slot.shows];
    const half = size / 2;
    const color = slot.tint === undefined ? {} : { color: slot.tint };

    if (slot.as === 'clip') {
        return { type: 'clipping', end: slot.end, vertexCount: 3, vertices: [-400, -300, 400, -300, 0, 500] };
    }
    if (slot.as === 'mesh') {
        return {
            type: 'mesh',
            path: slot.shows,
            uvs: [0, 0, 1, 0, 1, 1, 0, 1],
            triangles: [0, 1, 2, 0, 2, 3],
            vertices: [-half, -half, half, -half, half, half, -half, half],
            hull: 4,
            ...color,
        };
    }
    if (slot.shows === 'seq') {
        return { path: 'seq_', sequence: { count: 2, start: 0, digits: 1 }, width: size, height: size, ...color };
    }

    return { path: slot.shows, width: size, height: size, ...color };
}

/** The files of a skeleton with the given slots, in draw order. */
export function coverFiles(slots: readonly CoverSlot[]): RigFiles {
    const skeleton = {
        skeleton: { spine: '4.2.0' },
        bones: [
            { name: 'root' },
            ...slots.map((slot) => ({
                name: `bone-${slot.name}`,
                parent: 'root',
                x: slot.at?.[0] ?? 0,
                y: slot.at?.[1] ?? 0,
                scaleX: slot.scale ?? 1,
                scaleY: slot.scale ?? 1,
            })),
        ],
        slots: slots.map((slot) => ({
            name: slot.name,
            bone: `bone-${slot.name}`,
            attachment: slot.name,
            ...(slot.blend === undefined ? {} : { blend: slot.blend }),
            ...(slot.color === undefined ? {} : { color: slot.color }),
            ...(slot.dark === undefined ? {} : { dark: slot.dark }),
        })),
        skins: [
            {
                name: 'default',
                attachments: Object.fromEntries(slots.map((slot) => [slot.name, { [slot.name]: attachment(slot) }])),
            },
        ],
        animations: {},
    };

    return { skeleton: JSON.stringify(skeleton), atlas: ATLAS };
}

/** Gives every region of the cover atlas its opaque rectangle: the square without its rim. */
export function opaqueSquares(outlines: AtlasOutlines): void {
    for (const name of ['big', 'mid', 'small', 'seq_0', 'seq_1'])
        setOpaque(outlines, name, [RIM, RIM, 1 - RIM, 1 - RIM]);
}

/**
 * A cover rig with page textures that allow cuts and an opaque rectangle for every region.
 * `fill` can change the outlines.
 */
export function coverRig(
    slots: readonly CoverSlot[],
    options: Omit<SkeletonViewOptions, 'outlines'> = {},
    fill: (outlines: AtlasOutlines) => void = () => undefined,
): Promise<Rig> {
    return createRig(
        coverFiles(slots),
        undefined,
        cutView((outlines) => {
            opaqueSquares(outlines);
            fill(outlines);
        }, options),
    );
}

/** The slot index for a name. */
export const slotOf = (rig: Rig, name: string): number => rig.model.slots.names.indexOf(name);

/** Moves the bone of a slot of a cover rig, in the pose. The next update of the engine keeps it. */
export function moveSlot(rig: Rig, name: string, x: number, y: number): void {
    const bone = rig.model.slots.bones[slotOf(rig, name)] ?? 0;

    rig.engine.state.local[bone * 7] = x;
    rig.engine.state.local[bone * 7 + 1] = y;
}

/**
 * Advances a rig frame by frame until its view skips `covered` slots, and returns how many
 * frames that took. A view searches for covered slots now and then, so a slot that goes behind
 * an opaque one is found some frames later. Throws when `limit` frames do not get there.
 */
export function framesUntilCovered(
    rig: Rig,
    covered: number,
    advance: () => void = () => step(rig, 0),
    limit = 200,
): number {
    for (let frame = 1; frame <= limit; frame++) {
        advance();
        if (rig.view.stats.coveredSlots === covered) return frame;
    }
    throw new Error(`the view skips ${rig.view.stats.coveredSlots} slots after ${limit} frames, not ${covered}`);
}
