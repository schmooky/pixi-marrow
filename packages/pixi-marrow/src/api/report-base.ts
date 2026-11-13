import type { AtlasModel } from '../model/atlas';
import type { SkeletonInfo } from '../model/info';
import type { SkeletonModel } from '../model/model';
import type { AtlasOutlines } from '../model/outlines';
import type { PhysicsMode } from '../pose/engine';
import type { PoseState } from '../pose/state';
import type { AttachCodeState } from '../render/attach-code';
import type { Link } from '../render/attach-work';
import type { ViewReport } from '../render/inspect';
import type { ViewStats } from '../render/stats';
import type { OutlinesState } from './asset';

/** What a row of the perf report is about. */
export type PerfFeature =
    | 'renderMode'
    | 'motion'
    | 'links'
    | 'drawCalls'
    | 'blend'
    | 'pages'
    | 'clipping'
    | 'tightMesh'
    | 'occlusion'
    | 'outlines'
    | 'darkTint'
    | 'physics'
    | 'bake'
    | 'constraints'
    | 'bones'
    | 'slots'
    | 'vertices'
    | 'uploads'
    | 'layout';

/** One row of the perf report: what the runtime decided or counted for an instance, and why. */
export interface PerfEntry {
    /** What the row is about. */
    feature: PerfFeature;
    /** What the runtime decided or counted, in a few words. */
    value: string;
    /** Why, with the counters behind it. It is read from the instance when the report is asked for. */
    reason: string;
    /** The animation the row is about. A row about the whole instance has none. */
    animation?: string;
}

/** What the rows of a report are read from. */
export interface ReportSource {
    model: SkeletonModel;
    atlas: AtlasModel;
    info: SkeletonInfo;
    /** The outlines of the asset at the moment. */
    outlines: AtlasOutlines | undefined;
    /** Where the outlines of the asset stand. */
    outlinesState: OutlinesState;
    state: PoseState;
    stats: ViewStats;
    view: ViewReport;
    /** The containers that follow a bone or are attached to a slot. */
    links: readonly Link[];
    /** Where the code that draws attached containers stands. */
    attachCode: AttachCodeState;
    /** The physics mode that holds. */
    physics: PhysicsMode;
    /** Whether the next update resets the physics before that mode returns. */
    resetPending: boolean;
    /** What baked playback did so far, or null without it. */
    bake: BakeReading | null;
}

/** What the baked playback of an instance did so far, as the perf report reads it. */
export interface BakeReading {
    /** Updates that played a baked frame, and updates that the pose engine posed. */
    baked: number;
    unbaked: number;
    /** The animation of the last update and whether it was baked, or why not. */
    last: string;
    /** The bytes of the clips that every instance of the asset shares. */
    bytes: number;
}

/** How many names a reason spells out before it counts the rest. */
const LISTED = 6;

/**
 * A count with its noun: `1 slot`, `2 slots`.
 *
 * @example
 * plural(2, 'draw range'); // '2 draw ranges'
 */
export function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Slots by name for a reason: `slot "a"`, `slots "a", "b"`. Past six names the rest is counted.
 *
 * @example
 * slotNames(model, [3, 7]); // 'slots "glow", "fx"'
 */
export function slotNames(model: SkeletonModel, slots: readonly number[]): string {
    const names = slots.slice(0, LISTED).map((slot) => `"${model.slots.names[slot]}"`);
    const more = slots.length > LISTED ? ` and ${slots.length - LISTED} more` : '';

    return `${slots.length === 1 ? 'slot' : 'slots'} ${names.join(', ')}${more}`;
}
