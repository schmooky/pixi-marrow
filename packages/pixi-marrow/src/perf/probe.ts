import type { UpdateProbe } from '../api/options';
import { MarrowError } from '../base/errors';
import type { ViewStats } from '../render/stats';

/** The milliseconds one part of the update took, over the updates a probe measured. */
export interface ProbeBucket {
    /** All measured updates added up. */
    total: number;
    /** `total` divided by the number of updates. 0 before the first update. */
    mean: number;
    /** The slowest single update. */
    worst: number;
}

/**
 * Counters of the view, added up over the measured updates. Divide one by `updates` for its mean
 * per update. A counter that grows while Pixi draws counts with the update after it.
 */
export interface ProbeCounters {
    /** Draw calls the view issues per frame, as they stood after each update. */
    drawCalls: number;
    /** Vertices sent to the GPU: the vertices in the buffers, for every update that uploaded positions. */
    vertices: number;
    /** Uploads of vertex data and of clip masks: positions, colors, texture coordinates, mask polygons and mask triangles. */
    uploads: number;
    /** How often the index buffers of the draw ranges were rewritten. */
    rangesRebuilt: number;
    /** Clipping attachments that were applied, as they stood after each update. */
    clips: number;
    /** Slots that were left out because a later opaque slot covered them, as they stood after each update. */
    coveredSlots: number;
    /** Updates in which the view found nothing to do: the pose was the one it drew last. */
    skippedUpdates: number;
    /** Visible slots whose vertices the view placed, over the updates that had work. */
    placedSlots: number;
}

/** What a probe measured since it was made or reset. Times are milliseconds of `performance.now()`. */
export interface ProbeReading {
    /** How many updates were measured. */
    updates: number;
    /** The whole update: the three parts below added up. */
    update: ProbeBucket;
    /** The pose engine: animations, constraints and world transforms. */
    pose: ProbeBucket;
    /** The view: vertices, colors, draw ranges and buffers. */
    geometry: ProbeBucket;
    /** Matching the events of the engine to their tracks and emitting them to listeners. */
    events: ProbeBucket;
    counters: ProbeCounters;
}

/** What a probe needs of the display object it measures. `MarrowSpine` has it. */
export interface ProbeTarget {
    updateProbe: UpdateProbe | null;
    readonly stats: ViewStats;
    readonly destroyed: boolean;
}

/** Where the totals and the worst updates sit in the array of times. */
const UPDATE = 0;
const POSE = 2;
const GEOMETRY = 4;
const EVENTS = 6;

/** The uploads a view has made so far. */
const uploadsOf = (stats: ViewStats): number =>
    stats.positionUploads + stats.colorUploads + stats.uvUploads + stats.maskUploads + stats.maskRebuilds;

/**
 * Measures every update of one display object while it is attached: the time of the pose
 * engine, of the view and of the events, and what the view did. `createProbe` makes and
 * attaches one.
 *
 * @example
 * const probe = createProbe(hero);
 * for (let frame = 0; frame < 600; frame++) hero.update(1 / 60);
 * const { updates, pose, geometry, counters } = probe.read();
 * console.log(pose.mean, geometry.worst, counters.drawCalls / updates);
 * probe.stop();
 */
export class PerfProbe implements UpdateProbe {
    /** The display object, or null once the probe was stopped. */
    private target: ProbeTarget | null;
    private updates = 0;
    /** Per bucket two numbers: the total and the worst update. */
    private readonly times = new Float64Array(8);
    private drawCalls = 0;
    private vertices = 0;
    private uploads = 0;
    private rangesRebuilt = 0;
    private clips = 0;
    private coveredSlots = 0;
    private skippedUpdates = 0;
    private placedSlots = 0;
    /** The counters of the view at the end of the update before. */
    private lastSkips = 0;
    private lastPositions = 0;
    private lastUploads = 0;
    private lastRebuilds = 0;

    constructor(target: ProbeTarget) {
        this.target = target;
        this.mark(target.stats);
    }

    /** True until {@link stop} was called. */
    get attached(): boolean {
        return this.target !== null;
    }

    /**
     * Takes the times of one update and reads the counters of the view. The display object
     * calls it at the end of every update. A probe that was stopped ignores it.
     */
    record(pose: number, geometry: number, events: number): void {
        const { target, times } = this;

        if (target === null) return;
        const { stats } = target;

        this.updates++;
        this.add(UPDATE, pose + geometry + events);
        this.add(POSE, pose);
        this.add(GEOMETRY, geometry);
        this.add(EVENTS, events);
        // the total of the whole update is the three totals added up, to the last bit
        times[UPDATE] = Number(times[POSE]) + Number(times[GEOMETRY]) + Number(times[EVENTS]);
        this.drawCalls += stats.drawCalls;
        this.clips += stats.clips;
        this.coveredSlots += stats.coveredSlots;
        if (stats.positionUploads !== this.lastPositions) this.vertices += stats.vertices;
        this.uploads += uploadsOf(stats) - this.lastUploads;
        this.rangesRebuilt += stats.indexRebuilds - this.lastRebuilds;
        // an update that skipped placed nothing: the count of the view is that of the update before
        if (stats.skips !== this.lastSkips) this.skippedUpdates++;
        else this.placedSlots += stats.placedSlots;
        this.mark(stats);
    }

    /**
     * What was measured since the probe was made or reset, as plain data.
     *
     * @example
     * const reading = probe.read();
     * console.log(reading.update.mean, reading.counters.uploads / reading.updates);
     */
    read(): ProbeReading {
        return {
            updates: this.updates,
            update: this.bucket(UPDATE),
            pose: this.bucket(POSE),
            geometry: this.bucket(GEOMETRY),
            events: this.bucket(EVENTS),
            counters: {
                drawCalls: this.drawCalls,
                vertices: this.vertices,
                uploads: this.uploads,
                rangesRebuilt: this.rangesRebuilt,
                clips: this.clips,
                coveredSlots: this.coveredSlots,
                skippedUpdates: this.skippedUpdates,
                placedSlots: this.placedSlots,
            },
        };
    }

    /** Forgets what was measured. The probe stays attached and measures on. */
    reset(): void {
        this.updates = 0;
        this.times.fill(0);
        this.drawCalls = 0;
        this.vertices = 0;
        this.uploads = 0;
        this.rangesRebuilt = 0;
        this.clips = 0;
        this.coveredSlots = 0;
        this.skippedUpdates = 0;
        this.placedSlots = 0;
        if (this.target !== null) this.mark(this.target.stats);
    }

    /**
     * Detaches the probe: the display object updates as it does without one. What was measured
     * stays readable. A probe that was stopped cannot be attached again.
     */
    stop(): void {
        const { target } = this;

        if (target === null) return;
        if (target.updateProbe === this) target.updateProbe = null;
        this.target = null;
    }

    /** Adds one update to a bucket and keeps the worst one. */
    private add(bucket: number, milliseconds: number): void {
        const { times } = this;

        times[bucket] = Number(times[bucket]) + milliseconds;
        if (milliseconds > Number(times[bucket + 1])) times[bucket + 1] = milliseconds;
    }

    private bucket(at: number): ProbeBucket {
        const total = Number(this.times[at]);

        return { total, mean: this.updates === 0 ? 0 : total / this.updates, worst: Number(this.times[at + 1]) };
    }

    /** Remembers the counters of the view that only grow, to count what the next update adds. */
    private mark(stats: ViewStats): void {
        this.lastSkips = stats.skips;
        this.lastPositions = stats.positionUploads;
        this.lastUploads = uploadsOf(stats);
        this.lastRebuilds = stats.indexRebuilds;
    }
}

/**
 * Attaches a probe to a display object. From then on every update of that object is measured:
 * the time of the pose engine, of the view and of the events, and what the view did. Other
 * objects are not touched, and an object without a probe pays nothing for this module.
 *
 * Throws a `MarrowError` for an object that was destroyed, and for one that has a probe.
 *
 * @example
 * const probe = createProbe(hero);
 *
 * setTimeout(() => {
 *     console.table(probe.read());
 *     probe.stop();
 * }, 5000);
 */
export function createProbe(spine: ProbeTarget): PerfProbe {
    if (spine.destroyed) {
        throw new MarrowError('invalid-data', 'The display object was destroyed and updates no more.', {
            fix: 'Create the probe for a display object that is in use.',
        });
    }
    if (spine.updateProbe !== null) {
        throw new MarrowError('invalid-data', 'The display object has a probe that measures its updates.', {
            fix: 'Call stop() on that probe first, or read that one.',
        });
    }
    const probe = new PerfProbe(spine);

    spine.updateProbe = probe;

    return probe;
}
