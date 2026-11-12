import type { CoverSearch } from './cover-search';
import type { fillCut, regionCut, sharedTriangleBytes } from './cut-work';

/*
 * The code that cuts overdraw, and when it is there. The cuts need outlines, which an asset
 * gets some time after its load or not at all, so their code is a chunk of its own: what the
 * outline of a region allows an attachment, the polygon and the opaque rectangle of an entry of
 * the vertex layout, and the search for covered slots. An asset loads the chunk with its
 * outlines. A view that has outlines before the chunk is there asks for it, keeps its quads and
 * draws every slot until it arrives.
 */

/** What cuts overdraw. See `cut-work.ts`. */
export interface CutCode {
    /** What the outline of its region allows a region attachment. */
    readonly regionCut: typeof regionCut;
    /** Writes the polygon and the opaque rectangle of an entry of a vertex layout. */
    readonly fillCut: typeof fillCut;
    /** The bytes of the triangle arrays that the views of an atlas share for its outlines. */
    readonly triangleBytes: typeof sharedTriangleBytes;
    /** Creates the search for the covered slots of one view, on the marks of that view. */
    createSearch(skipped: Uint8Array): CoverSearch;
}

/**
 * Where the code that cuts overdraw stands: nobody asked for it, it is on its way, it is there,
 * or the chunk did not load.
 */
export type CutCodeState = 'idle' | 'loading' | 'loaded' | 'failed';

let loaded: CutCode | undefined;
let loading: Promise<void> | undefined;
let state: CutCodeState = 'idle';

/**
 * The code that cuts overdraw, or undefined while it is not loaded.
 *
 * @example
 * const cut = cutCode()?.regionCut(cuts, atlas, attachment, regions, true) ?? NO_CUT;
 */
export function cutCode(): CutCode | undefined {
    return loaded;
}

/**
 * Where the code that cuts overdraw stands at the moment.
 *
 * @example
 * if (cutCodeState() === 'failed') console.log('every region keeps its quad');
 */
export function cutCodeState(): CutCodeState {
    return state;
}

/**
 * Loads the code that cuts overdraw. Resolves when it is there, and at once when it was loaded
 * before. It never rejects: a view keeps its quads and draws every slot while the code is
 * missing, and {@link cutCodeState} says that the chunk did not load. A call after that tries
 * again.
 *
 * @example
 * await loadCutCode();
 * console.log(cutCodeState()); // 'loaded', or 'failed'
 */
export function loadCutCode(): Promise<void> {
    if (loading !== undefined) return loading;
    state = 'loading';
    loading = import('./cut-work').then(
        ({ cutWork }) => {
            loaded = cutWork;
            state = 'loaded';
        },
        () => {
            loading = undefined;
            state = 'failed';
        },
    );

    return loading;
}

/**
 * Asks for the code that cuts overdraw when it is not there, without waiting for it. A view
 * that got outlines calls it: a load that failed is then tried again.
 *
 * @example
 * if (outlines !== undefined) wantCutCode();
 */
export function wantCutCode(): void {
    if (loaded === undefined) void loadCutCode();
}
