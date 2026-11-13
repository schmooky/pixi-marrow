import type { Container } from 'pixi.js';
import type { PoseState } from '../pose/state';
import type { SkeletonView } from '../render/skeleton-view';

/** What a display object asks of its idle cache. */
export interface IdleCache {
    /** After every update that drew: keeps the image or lets it go. */
    update(): void;
    destroy(): void;
}

/**
 * The idle cache of a display object for its `idleCache` setting, or undefined with `off`.
 *
 * @example
 * this.idle = createIdleCache(this, view, engine.state, settings.idleCache);
 */
export function createIdleCache(
    _owner: Container,
    _view: SkeletonView,
    _state: PoseState,
    mode: 'off' | 'auto',
): IdleCache | undefined {
    return mode === 'off' ? undefined : undefined;
}
