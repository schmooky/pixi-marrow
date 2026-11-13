import type { SkeletonView } from '../render/skeleton-view';

/** The view of each display object, for the optional entry points that read what it draws. */
const VIEWS = new WeakMap<object, SkeletonView>();

/** Notes the view of a display object. Its constructor calls it once. */
export function registerView(owner: object, view: SkeletonView): void {
    VIEWS.set(owner, view);
}

/**
 * The view of a display object, or undefined for another object. The debug overlays read the
 * triangles it draws from it.
 *
 * @example
 * const view = viewOf(hero);
 */
export function viewOf(owner: object): SkeletonView | undefined {
    return VIEWS.get(owner);
}
