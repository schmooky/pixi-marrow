import type { Container, Renderer, TextureSource } from 'pixi.js';

/*
 * What the pose does not say about a draw. A cut of overdraw is exact for a skeleton that Pixi
 * draws as the pose describes it. These two questions find the cases where it does not.
 */

/**
 * Whether Pixi draws the meshes of a container as their vertices say. That is the case when
 * every alpha from the container up to the root of the scene is exactly 1, and every blend mode
 * is inherited or normal.
 *
 * A skipped slot rests on both. Pixi multiplies the alpha of a display object and of its
 * ancestors into every vertex, so an opaque slot of a skeleton faded to 0.5 shows what is
 * behind it. A blend mode set on an ancestor is inherited by the meshes, and a slot that adds
 * or multiplies hides nothing.
 *
 * The walk reads the values that are set, not the ones Pixi computed in its last frame, so the
 * answer is right before Pixi has seen a change. While Pixi renders a container on its own,
 * that container has no parent, and the walk ends there as the multiplication does.
 *
 * @example
 * hero.alpha = 0.5;
 * console.log(drawsPlain(view.container)); // false
 */
export function drawsPlain(container: Container): boolean {
    for (let node: Container | null | undefined = container; node != null; node = node.parent) {
        const blend = node.blendMode;

        if (node.alpha !== 1 || (blend !== 'inherit' && blend !== 'normal')) return false;
    }

    return true;
}

/** What a renderer does that moves edges inside a pixel: it rounds positions, or its target is multisampled. */
export type EdgeBend = 'roundPixels' | 'multisample';

/** A view that is told how Pixi is about to draw it, right before each draw. */
export interface DrawGate {
    /**
     * Checks what the pose does not say, at the time of the draw.
     *
     * @param bends What the renderer does that moves edges, true when it does something, false when not.
     */
    beforeDraw(bends: EdgeBend | boolean): void;
    /**
     * Tells the view that a renderer is about to draw it whose batches sample fewer textures
     * than a run of the skeleton needs. The view draws with meshes from then on.
     */
    refuseBatch(): void;
}

/**
 * Whether a renderer is about to draw in a way that moves edges inside a pixel, and what it does.
 * It rounds vertex positions to whole pixels, or the target it draws to is multisampled. The
 * result is false for a draw that does neither.
 *
 * Rounding moves every vertex on its own. The corners of a polygon then map the texture in
 * another way than the corners of the quad would. A multisampled target shades a pixel once and
 * keeps the result for the samples a triangle covers. The edge of a polygon and the edge of an
 * opaque rectangle then show in pixels where a quad would not. Both cuts are off for such a draw.
 *
 * @example
 * const probe = new RenderContainer({ render: (renderer) => view.beforeDraw(bendsEdges(renderer)) });
 */
export function bendsEdges(renderer: Renderer): EdgeBend | false {
    if (renderer.roundPixels) return 'roundPixels';
    const target: TextureSource | undefined = renderer.renderTarget.renderTarget.colorTextures[0];

    return target?.antialias === true ? 'multisample' : false;
}
