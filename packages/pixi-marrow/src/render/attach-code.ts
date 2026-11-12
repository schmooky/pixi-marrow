import type { ViewInserts } from './attach-work';
import type { SkeletonView } from './skeleton-view';

/*
 * The code that draws containers of the user between the slots of a skeleton, and when it is
 * there. A game that attaches nothing does not need it, so it is a chunk of its own that loads
 * with the first `attach`: the tails a batch draws behind a container, the order of the children
 * and where a container belongs in the draw order. A container that is attached before the
 * chunk is there is hidden until it arrives.
 */

/** What draws attached containers. See `attach-work.ts`. */
export interface AttachCode {
    /** Creates what keeps the attached containers of one view in the draw order. */
    createInserts(view: SkeletonView): ViewInserts;
}

/**
 * Where the code for attached containers stands: nobody asked for it, it is on its way, it is
 * there, or the chunk did not load.
 */
export type AttachCodeState = 'idle' | 'loading' | 'loaded' | 'failed';

let loaded: AttachCode | undefined;
let loading: Promise<void> | undefined;
let state: AttachCodeState = 'idle';

/**
 * The code for attached containers, or undefined while it is not loaded.
 *
 * @example
 * const inserts = attachCode()?.createInserts(view);
 */
export function attachCode(): AttachCode | undefined {
    return loaded;
}

/**
 * Where the code for attached containers stands at the moment.
 *
 * @example
 * if (attachCodeState() === 'failed') console.log('attached containers stay hidden');
 */
export function attachCodeState(): AttachCodeState {
    return state;
}

/**
 * Loads the code for attached containers. Resolves when it is there, and at once when it was
 * loaded before. It never rejects: an attached container stays hidden while the code is missing,
 * and {@link attachCodeState} says that the chunk did not load. A call after that tries again.
 *
 * @example
 * await loadAttachCode();
 * hero.attach('placeholder', label);
 */
export function loadAttachCode(): Promise<void> {
    if (loading !== undefined) return loading;
    state = 'loading';
    loading = import('./attach-work').then(
        ({ attachWork }) => {
            loaded = attachWork;
            state = 'loaded';
        },
        () => {
            loading = undefined;
            state = 'failed';
        },
    );

    return loading;
}
