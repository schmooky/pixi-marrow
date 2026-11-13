import type { Container } from 'pixi.js';
import type { PoseState } from '../pose/state';
import type { SkeletonView } from '../render/skeleton-view';

/*
 * The idle cache of a display object: a skeleton at rest drawn as one image, see `idle-image.ts`.
 * A game that leaves `idleCache` off never needs that code, so it is a chunk of its own. It loads
 * with the first display object that has the setting `auto`, and the cache starts with the
 * first update after it arrived. A skeleton draws live until then, and for good when the chunk
 * did not load.
 */

/** What a display object asks of its idle cache. */
export interface IdleCache {
    /** After every update that drew: keeps the image or lets it go. */
    update(): void;
    destroy(): void;
}

/** What the chunk of the idle cache creates the cache of one display object with. */
export interface IdleCode {
    create(owner: Container, view: SkeletonView, state: PoseState): IdleCache;
}

let code: IdleCode | undefined;
let loading: Promise<void> | undefined;

/**
 * Loads the code of the idle cache. Resolves when it is there. It never rejects: a skeleton
 * draws live while the code is missing, and the next display object asks for it again.
 *
 * @example
 * await loadIdleCode();
 */
export function loadIdleCode(): Promise<void> {
    loading ??= import('./idle-image').then(
        (chunk) => {
            code = chunk.idleCode;
        },
        () => {
            loading = undefined;
        },
    );

    return loading;
}

/**
 * The idle cache of a display object for its `idleCache` setting, or undefined with `off`.
 *
 * @example
 * this.idle = createIdleCache(this, view, engine.state, settings.idleCache);
 */
export function createIdleCache(
    owner: Container,
    view: SkeletonView,
    state: PoseState,
    mode: 'off' | 'auto',
): IdleCache | undefined {
    if (mode === 'off') return undefined;
    let cache: IdleCache | undefined;

    void loadIdleCode();

    return {
        update(): void {
            cache ??= code?.create(owner, view, state);
            cache?.update();
        },
        destroy(): void {
            cache?.destroy();
        },
    };
}
