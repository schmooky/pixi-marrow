import type { EventData } from '../model/model';
import type { EventKey } from '../model/timelines';
import type { MarrowEvent, MarrowNames } from './options';
import type { Track } from './track';
import { EventList } from './track-book';

/**
 * The events a `MarrowSpine` emits, each with the arguments its listeners get. They are
 * emitted at the end of `update`, in the order the official runtime calls its listener.
 *
 * The empty animation that `stop` mixes through emits nothing. What a listener causes is emitted
 * by the next update.
 */
export interface MarrowSpineEvents<N extends MarrowNames = MarrowNames> {
    /** An animation became the current one of its track. */
    start: [track: Track<N>];
    /** Another animation replaced this one as the current one. It may still mix out. */
    interrupt: [track: Track<N>];
    /** The animation will not be applied again. */
    end: [track: Track<N>];
    /** The track let go of the animation. A queued animation that never started gets this alone. */
    dispose: [track: Track<N>];
    /** The animation played to its end. A looping animation completes once per loop. */
    complete: [track: Track<N>];
    /** An animation fired an event key. */
    event: [event: MarrowEvent<N>, track: Track<N>];
}

/** What the events are emitted on: the display object. */
export interface EventSink {
    readonly destroyed: boolean;
    emit(event: string, ...args: unknown[]): boolean;
    listenerCount(event: string): number;
}

/** An event key as the plain data a listener gets. */
function eventOf(events: readonly EventData[], key: EventKey): MarrowEvent {
    return {
        name: events[key.event]?.name ?? '',
        int: key.int,
        float: key.float,
        string: key.string,
        volume: key.volume,
        balance: key.balance,
        time: key.time,
    };
}

function emitOne(sink: EventSink, events: readonly EventData[], list: EventList, at: number): void {
    const type = list.types[at];
    const handle = list.handles[at];
    const key = list.keys[at];

    if (type === undefined || handle === undefined) return;
    if (type !== 'event') sink.emit(type, handle);
    else if (key !== undefined && sink.listenerCount('event') > 0) sink.emit('event', eventOf(events, key), handle);
}

/**
 * Holds the events of a pose engine between the update that caused them and the listeners.
 *
 * @example
 * const pump = new EventPump();
 * book.absorb(engine.takeEvents(), pump.pending);
 * pump.flush(spine, model.events);
 */
export class EventPump {
    /** The engine events since the last flush, each with its handle. */
    pending: EventList = new EventList();
    /** The second list: events that listeners cause wait in `pending` for the next flush. */
    private spare = new EventList();
    private emitting = false;

    /**
     * Emits what waits, in order. It stops when a listener destroys the display object.
     *
     * @param events The events of the model, for the names.
     */
    flush(sink: EventSink, events: readonly EventData[]): void {
        const list = this.pending;

        // a listener that calls update: the events of that update wait for the next one
        if (list.types.length === 0 || this.emitting) return;
        // what listeners cause is emitted by the next update, so a listener cannot loop forever
        this.pending = this.spare;
        this.spare = list;
        this.emitting = true;
        try {
            for (let i = 0; i < list.types.length && !sink.destroyed; i++) emitOne(sink, events, list, i);
        } finally {
            this.emitting = false;
            list.clear();
        }
    }
}
