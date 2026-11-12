import type { MeshPaint, MeshPaintOptions } from './mesh-paint';

/*
 * The code of the mesh mode, and when it is there. Most skeletons draw in a batch, so the mesh
 * mode is a chunk of its own that loads on demand: the draw ranges with their meshes, the
 * shaders, and the stencil mask of a clip. An asset loads the chunk when its skeleton is one
 * that `auto` draws with meshes, and when it is asked to. A view that needs the mesh mode
 * before the chunk is there asks for it and draws in a batch until it arrives.
 */

/** What draws in the mesh mode. See `mesh-paint.ts`. */
export interface MeshCode {
    /** Creates the buffers and the draw ranges of one view. */
    createPaint(options: MeshPaintOptions): MeshPaint;
}

/**
 * Where the code of the mesh mode stands: nobody asked for it, it is on its way, it is there,
 * or the chunk did not load.
 */
export type MeshCodeState = 'idle' | 'loading' | 'loaded' | 'failed';

let loaded: MeshCode | undefined;
let loading: Promise<void> | undefined;
let state: MeshCodeState = 'idle';

/**
 * The code of the mesh mode, or undefined while it is not loaded.
 *
 * @example
 * const paint = meshCode()?.createPaint({ container, template, pages, dark, blendModes, measure });
 */
export function meshCode(): MeshCode | undefined {
    return loaded;
}

/**
 * Where the code of the mesh mode stands at the moment.
 *
 * @example
 * if (meshCodeState() === 'idle') void loadMeshCode();
 */
export function meshCodeState(): MeshCodeState {
    return state;
}

/**
 * Loads the code of the mesh mode. Resolves when it is there, and at once when it was loaded
 * before. It never rejects: a view draws in a batch while the code is missing, and
 * {@link meshCodeState} says that the chunk did not load. A call after that tries again.
 *
 * @example
 * await loadMeshCode();
 * console.log(meshCodeState()); // 'loaded', or 'failed'
 */
export function loadMeshCode(): Promise<void> {
    if (loading !== undefined) return loading;
    state = 'loading';
    loading = import('./mesh-paint').then(
        ({ meshMode }) => {
            loaded = meshMode;
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
 * Asks for the code of the mesh mode when it is not there, without waiting for it. A command
 * that needs the mesh mode calls it: a load that failed is then tried again.
 *
 * @example
 * view.renderMode = 'mesh';
 * wantMeshCode();
 */
export function wantMeshCode(): void {
    if (loaded === undefined) void loadMeshCode();
}
