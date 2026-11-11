import type { EventKey } from '../model/timelines';
import type { PoseEvent, PoseEventType, TrackEntry } from '../pose/engine';
import type { TrackHandle } from './track';

/**
 * Engine events with the handle each belongs to, waiting to be emitted. Three lists of one length.
 *
 * @example
 * const list = new EventList();
 * list.push('start', handle, undefined);
 * console.log(list.types[0], list.handles[0]?.animation);
 */
export class EventList {
    readonly types: PoseEventType[] = [];
    readonly handles: TrackHandle[] = [];
    /** For `event`: the key that fired. */
    readonly keys: (EventKey | undefined)[] = [];

    push(type: PoseEventType, handle: TrackHandle, key: EventKey | undefined): void {
        this.types.push(type);
        this.handles.push(handle);
        this.keys.push(key);
    }

    clear(): void {
        this.types.length = 0;
        this.handles.length = 0;
        this.keys.length = 0;
    }
}

/**
 * Keeps the handle of every entry of a pose engine, from the command that makes the entry to
 * its `dispose` event.
 *
 * A 4.3 engine hands an entry object out again after its `dispose`. So events are matched in
 * the order they happened, and the engine's events are taken in around every command.
 *
 * @example
 * const book = new TrackBook();
 * book.add(new TrackHandle(spine, engine.setAnimation(0, 2, false), 'run', 0.8));
 * book.absorb(engine.takeEvents(), pending);
 */
export class TrackBook {
    private readonly handles = new Map<TrackEntry, TrackHandle>();
    /** Per track: the handle of the entry the track got last. It is the current or the last queued one. */
    private readonly lasts: (TrackHandle | undefined)[] = [];

    /** How many tracks were used so far. */
    get size(): number {
        return this.lasts.length;
    }

    /**
     * The handle a queued animation would follow: the last one queued, else the current one.
     * Undefined when the track holds no entry.
     */
    last(track: number): TrackHandle | undefined {
        return this.lasts[track];
    }

    /**
     * Takes in the handle of an entry the engine made a moment ago. Call {@link absorb} before
     * the command that makes the entry, and again after this.
     */
    add(handle: TrackHandle): void {
        if (handle.entry === null) return;
        this.handles.set(handle.entry, handle);
        while (this.lasts.length <= handle.track) this.lasts.push(undefined);
        this.lasts[handle.track] = handle;
    }

    /**
     * Finds the handle of each engine event by its entry, in order, and appends both to `out`.
     * Events of the empty animation are left out. So are events of entries without a handle,
     * which were made on the engine directly.
     */
    absorb(events: readonly PoseEvent[], out: EventList): void {
        for (const event of events) {
            const handle = this.handles.get(event.entry);

            if (handle === undefined) continue;
            if (event.type === 'dispose') this.forget(event.entry, handle);
            else if (event.type === 'end' || (event.type === 'complete' && !handle.loop)) handle.settle();
            if (!handle.hidden) out.push(event.type, handle, event.key);
        }
    }

    /** Lets go of a disposed entry. From here on the engine may use the object for another entry. */
    private forget(entry: TrackEntry, handle: TrackHandle): void {
        this.handles.delete(entry);
        // no newer entry took its place: the track holds nothing now
        if (this.lasts[handle.track] === handle) this.lasts[handle.track] = undefined;
        handle.release();
    }
}
