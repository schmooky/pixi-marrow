import type { EventKey } from '../model/timelines';
import type { PoseEvent, PoseEventType, TrackEntry } from '../pose/engine';
import type { TrackEnd, TrackHandle } from './track';

/** What says whether somebody listens for an event: the display object. */
export interface EventSink {
    readonly destroyed: boolean;
    emit(event: string, ...args: unknown[]): boolean;
    listenerCount(event: string): number;
}

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

    /** How many entries have a handle: the playing, the queued and the ones that mix out. */
    get live(): number {
        return this.handles.size;
    }

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
     *
     * @param cause Why the entries end that the command before this call ended: `stopped` or
     * `destroyed`. Without it an entry that was interrupted ends as `interrupted`.
     * @param sink Who listens, in an update that emits at once. An event nobody listens for is
     * then left out. Without it every event waits for the next update.
     */
    absorb(events: readonly PoseEvent[], out: EventList, cause?: TrackEnd, sink?: EventSink): void {
        // by index: a loop over the values of an array makes an iterator, in every update
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            const handle = event === undefined ? undefined : this.handles.get(event.entry);

            if (event === undefined || handle === undefined) continue;
            const { type } = event;

            if (type === 'dispose') this.forget(event.entry, handle, cause);
            else note(handle, type, cause);
            if (!handle.hidden && (sink === undefined || sink.listenerCount(type) > 0)) {
                out.push(type, handle, event.key);
            }
        }
    }

    /** Lets go of a disposed entry. From here on the engine may use the object for another entry. */
    private forget(entry: TrackEntry, handle: TrackHandle, cause: TrackEnd | undefined): void {
        this.handles.delete(entry);
        // no newer entry took its place: the track holds nothing now
        if (this.lasts[handle.track] === handle) this.lasts[handle.track] = undefined;
        handle.release(handle.cause ?? cause ?? 'interrupted');
    }
}

/** Notes what an event says of the end of an entry: why it will end, or that it has. */
function note(handle: TrackHandle, type: PoseEventType, cause: TrackEnd | undefined): void {
    if (type === 'interrupt') handle.cause ??= cause ?? 'interrupted';
    else if (type === 'end') handle.settle(handle.cause ?? cause ?? 'complete');
    else if (type === 'complete' && !handle.loop) handle.settle('complete');
}
