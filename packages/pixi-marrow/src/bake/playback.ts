import type { SkeletonModel } from '../model/model';
import type { PhysicsMode, PoseEngine, PoseEngineFactory, PoseSource, TrackEntry } from '../pose/engine';
import type { PoseState } from '../pose/state';
import { type BakedClip, SAMPLE_SLACK } from './clip';
import { showsClipAttachments, writeFrame } from './frame';
import { bakeWith } from './record';
import { type Baker, bakesOf, type ModelBakes, type PreparedClip } from './store';

/** What baked playback needs of an asset: its model and the factory of its engines. A `MarrowAsset` is one. */
export interface BakeHost {
    readonly model: SkeletonModel;
    readonly createEngine: PoseEngineFactory;
}

/** How a baked display object fared so far, for the perf report. */
export interface BakeTally {
    /** Updates that played a baked frame. */
    readonly baked: number;
    /** Updates that the engine posed. */
    readonly unbaked: number;
    /** The animation of the last update and whether it was baked, or why not. */
    readonly last: string;
    /** The bytes of the clips of the model, which every instance shares. */
    readonly bytes: number;
}

/** Why an update was posed by the engine, or that the next one plays baked. Index into {@link REASONS}. */
const NOTHING = 0;
const NO_SOLO = 1;
const NOT_LISTED = 2;
const BLOCKED = 3;
const ELSEWHERE = 4;
const NOT_SETUP = 5;
const OTHER_ATTACHMENT = 6;
const PRIMED = 7;
const WRITTEN = 8;
const TRACKS = 9;
const BAKED = 10;

const REASONS: readonly string[] = [
    'nothing played yet',
    'posed: no entry plays alone on track 0',
    'posed: it is not in the list of bake',
    'posed',
    'posed: its clip was baked at another placement of the skeleton',
    'posed: a value it does not key differs from the setup pose',
    'posed: a slot it deforms shows another attachment',
    'posed, and the next update plays baked',
    'posed: the pose was written, or the skin or the physics mode changed',
    'posed: the tracks changed',
    'baked',
];

/** True when a state places its skeleton where the clip was baked. */
const placed = (state: PoseState, clip: BakedClip): boolean =>
    state.x === clip.placement[0] &&
    state.y === clip.placement[1] &&
    state.scaleX === clip.placement[2] &&
    state.scaleY === clip.placement[3];

/** The time of an animation an entry is applied at, see {@link timeOf}. */
const TIME = new Float64Array(1);

/**
 * Writes the time of the animation an entry is applied at to {@link TIME}: the official
 * `getAnimationTime`, counted from the end for a reversed entry. The engine says it after an
 * advance. Before one, this works it out the same way.
 *
 * A fractional field of an entry read here would cost an allocation where engines of two
 * versions play: the entries of the two have other shapes. So the playback reads the time from
 * the engine where it can.
 */
function timeOf(entry: TrackEntry, duration: number): void {
    const start = entry.animationStart;
    let time = start;

    if (!entry.loop) time = Math.min(entry.trackTime + start, entry.animationEnd);
    else if (entry.animationEnd - start !== 0) time = (entry.trackTime % (entry.animationEnd - start)) + start;
    TIME[0] = entry.reverse ? duration - time : time;
}

/** The frame a prepared clip shows at the time in {@link TIME}: `frameAt`, written out. Returns a whole number only. */
function frameOf(prepared: PreparedClip): number {
    const time = Number(TIME[0]);
    const { last } = prepared;

    if (time >= prepared.duration) return last;
    const frame = Math.floor(time * prepared.fps + SAMPLE_SLACK);

    return frame < 0 ? 0 : frame < last ? frame : last;
}

/**
 * The source that plays the updates of one engine from baked frames where it can. An update
 * plays baked when the update before it was posed by the engine, or baked, for the same entry,
 * and nothing wrote the pose since. That entry plays alone on track 0, see `PoseEngine.solo`.
 * The animation has a clip for the active skin, at the placement of the skeleton. When the
 * engine posed that update, the animated pose held the setup values that the animation does
 * not key, and the slots that follow a deform showed the attachment of the clip.
 *
 * Such an update asks the engine to advance, which fires every event and moves every time on as
 * an update does, and writes the frame of the clip at the new time. Any other update is posed
 * by the engine, as it is without baking.
 */
class BakedPlayback implements PoseSource, BakeTally {
    baked = 0;
    unbaked = 0;
    /** What the last update did: one of the reasons above. */
    private reason = NOTHING;
    /** The animation and the skin of the last update. */
    private lastAnimation = -1;
    private lastSkin = -1;
    private readonly engine: PoseEngine;
    private readonly bakes: ModelBakes;
    /** The animations that may play baked, or null for every one. */
    private readonly allowed: ReadonlySet<number> | null;
    private readonly baker: Baker;
    /** The entry the next update may bake, and its animation: an engine can hand an entry out again. */
    private primed: TrackEntry | null = null;
    private animation = -1;
    private prepared: PreparedClip | null = null;
    /** The version of the pose and the physics mode after the last update. */
    private seen = -1;
    private mode: PhysicsMode = 'update';

    constructor(host: BakeHost, engine: PoseEngine, allowed: readonly number[] | null) {
        const { model, createEngine } = host;
        const { state } = engine;

        this.engine = engine;
        this.bakes = bakesOf(model);
        this.allowed = allowed === null ? null : new Set(allowed);
        // a clip is baked where the first instance that plays it stands, and shared
        this.baker = (animation, skins) =>
            bakeWith(createEngine, model, animation, {
                skins,
                placement: [state.x, state.y, state.scaleX, state.scaleY],
            });
    }

    get bytes(): number {
        return this.bakes.bytes;
    }

    /** What the last update did, as text. */
    get last(): string {
        const { model } = this.engine.state;
        const name = model.animations[this.lastAnimation]?.name;
        const blocked = this.reason === BLOCKED ? this.bakes.reason(this.lastSkin, this.lastAnimation) : undefined;
        const what = REASONS[this.reason] ?? '';

        if (name === undefined) return what;

        return `"${name}" ${what}${blocked === undefined ? (this.reason === BLOCKED ? ': it has no clip' : '') : `: ${blocked}`}`;
    }

    update(dt: number): boolean {
        const { engine, prepared } = this;
        const { state } = engine;

        if (this.primed === null || prepared === null) return false;
        if (state.version !== this.seen || engine.physics !== this.mode || state.skin !== prepared.skin) {
            return this.drop(WRITTEN);
        }
        const entry = engine.solo();

        if (entry !== this.primed || entry.animation !== this.animation) return this.drop(TRACKS);
        if (!placed(state, prepared.clip)) return this.drop(ELSEWHERE);
        engine.advance(dt, TIME);
        writeFrame(state, prepared, frameOf(prepared), engine.deform);
        this.seen = state.version;
        this.reason = BAKED;
        this.baked++;

        return true;
    }

    posed(): void {
        const { engine } = this;
        const { state } = engine;
        const entry = engine.solo();

        this.seen = state.version;
        this.mode = engine.physics;
        this.primed = null;
        this.prepared = null;
        this.unbaked++;
        this.lastSkin = state.skin;
        this.lastAnimation = entry?.animation ?? -1;
        this.reason = entry === null ? NO_SOLO : this.prime(entry, state);
    }

    /** Primes the next update for an entry, or says why it cannot play baked. */
    private prime(entry: TrackEntry, state: PoseState): number {
        if (this.allowed !== null && !this.allowed.has(entry.animation)) return NOT_LISTED;
        const prepared = this.bakes.find(state.skin, entry.animation, this.baker);

        if (prepared === null) return BLOCKED;
        if (!placed(state, prepared.clip)) return ELSEWHERE;
        if (!this.engine.holdsSetup(entry.animation, prepared.needs)) return NOT_SETUP;
        timeOf(entry, prepared.duration);
        if (!showsClipAttachments(state, prepared, frameOf(prepared))) return OTHER_ATTACHMENT;
        this.primed = entry;
        this.animation = entry.animation;
        this.prepared = prepared;

        return PRIMED;
    }

    /** Leaves baked playback for this update: the engine poses it. */
    private drop(reason: number): false {
        this.reason = reason;
        this.primed = null;
        this.prepared = null;

        return false;
    }
}

/**
 * Plays the updates of an engine from baked frames where it can, and returns the tally of what
 * it did. `animations` lists the animations that may play baked, by model index, or is null for
 * every one. A clip that is not there yet is baked the first time it can play, at 60 frames
 * per second, and every instance of the model shares it. One that `addBakedClips` handed over
 * plays instead.
 *
 * @example
 * const tally = playBaked(asset, engine, null);
 * engine.setAnimation(0, 0, true);
 * engine.update(1 / 60); // posed by the engine
 * engine.update(1 / 60); // baked
 * console.log(tally.baked); // 1
 */
export function playBaked(host: BakeHost, engine: PoseEngine, animations: readonly number[] | null): BakeTally {
    const playback = new BakedPlayback(host, engine, animations);

    engine.source = playback;

    return playback;
}
