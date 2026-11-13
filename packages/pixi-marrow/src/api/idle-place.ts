import type { Bounds, Container, Matrix } from 'pixi.js';

/*
 * Where a skeleton lands in the pixels of a render target, for the idle cache of `idle-image.ts`.
 *
 * A placement is an affine map from the space of the display object to the pixels of the target,
 * as six numbers: `a`, `b`, `c`, `d`, `tx` and `ty` in the order of a Pixi `Matrix`. A point
 * (x, y) lands at (a x + c y + tx, b x + d y + ty).
 *
 * The image is drawn on the grid of those pixels. A sprite then covers whole pixels, and each
 * pixel samples the center of one texel, which is the value the live skeleton put there. So the
 * image is exact for its placement, and for every placement that moves it by whole pixels. Any
 * other placement would sample between texels.
 */

/** Six numbers of an affine map, as described at the top of this file. */
export type Placement = Float64Array;

/** How far the linear part of two placements may differ and still count as the same. */
const SAME_SCALE = 1e-7;
/** How far from a whole pixel a move may land and still count as one, in pixels. */
const WHOLE_PIXEL = 1e-4;

/**
 * A placement of zeros, to be filled by {@link placeOf}.
 *
 * @example
 * const now = createPlacement();
 */
export function createPlacement(): Placement {
    return new Float64Array(6);
}

/**
 * Writes where the space of a container lands in the pixels of the target that is rendered now.
 * Call it from an `onRender` callback, where Pixi has not computed the transforms of this frame
 * yet. The walk multiplies the local transforms of the container and its ancestors.
 *
 * The walk ends at the container without a parent, which is the root of the render: Pixi takes
 * the parent away from the container it renders. Its local transform is used as it stands,
 * because Pixi has put the transform of the render there.
 *
 * @param resolution The resolution of the target: pixels per unit.
 *
 * @example
 * sprite.onRender = (renderer) => placeOf(owner, renderer.renderTarget.renderTarget.resolution, now);
 */
export function placeOf(container: Container, resolution: number, out: Placement): void {
    let a = 1;
    let b = 0;
    let c = 0;
    let d = 1;
    let tx = 0;
    let ty = 0;

    // it runs in every render of a cached skeleton, so it keeps to plain numbers and allocates nothing
    for (let node: Container | null = container; node !== null; node = node.parent) {
        if (node.parent !== null) node.updateLocalTransform();
        const m: Matrix = node.localTransform;
        const na = m.a * a + m.c * b;
        const nb = m.b * a + m.d * b;
        const nc = m.a * c + m.c * d;
        const nd = m.b * c + m.d * d;
        const ntx = m.a * tx + m.c * ty + m.tx;

        ty = m.b * tx + m.d * ty + m.ty;
        tx = ntx;
        a = na;
        b = nb;
        c = nc;
        d = nd;
    }
    out[0] = a * resolution;
    out[1] = b * resolution;
    out[2] = c * resolution;
    out[3] = d * resolution;
    out[4] = tx * resolution;
    out[5] = ty * resolution;
}

/**
 * Whether a placement is another one moved by whole pixels: the same scale, rotation and skew,
 * and a move that lands on the pixel grid. An image drawn for one is exact for the other.
 *
 * @example
 * if (!wholeMove(now, image.place)) dropImage();
 */
export function wholeMove(now: Placement, then: Placement): boolean {
    for (let i = 0; i < 4; i++) {
        if (Math.abs(Number(now[i]) - Number(then[i])) > SAME_SCALE) return false;
    }
    const dx = Number(now[4]) - Number(then[4]);
    const dy = Number(now[5]) - Number(then[5]);

    return Math.abs(dx - Math.round(dx)) < WHOLE_PIXEL && Math.abs(dy - Math.round(dy)) < WHOLE_PIXEL;
}

/** The pixels an image covers on its target: the corner and the size, all whole. */
export interface PixelBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * The whole pixels that a box of the space of a display object covers under a placement, with
 * a margin. The width and height are 0 for an empty box.
 *
 * @param margin Pixels added on every side, for an edge that a rasterizer rounds outward.
 *
 * @example
 * const box = pixelBox(getLocalBounds(view.container, bounds), place, 1);
 * const texture = RenderTexture.create({ width: box.width, height: box.height });
 */
export function pixelBox(bounds: Bounds, place: Placement, margin: number): PixelBox {
    if (!(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY)) return { x: 0, y: 0, width: 0, height: 0 };
    const [a, b, c, d, tx, ty] = place;
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];

    for (const [x, y] of [
        [bounds.minX, bounds.minY],
        [bounds.maxX, bounds.minY],
        [bounds.maxX, bounds.maxY],
        [bounds.minX, bounds.maxY],
    ] as const) {
        const px = Number(a) * x + Number(c) * y + Number(tx);
        const py = Number(b) * x + Number(d) * y + Number(ty);

        [minX, maxX] = [Math.min(minX, px), Math.max(maxX, px)];
        [minY, maxY] = [Math.min(minY, py), Math.max(maxY, py)];
    }
    const x = Math.floor(minX) - margin;
    const y = Math.floor(minY) - margin;

    return { x, y, width: Math.ceil(maxX) + margin - x, height: Math.ceil(maxY) + margin - y };
}

/** Six numbers in the order of the arguments of `Matrix.set`. */
type MatrixArgs = [number, number, number, number, number, number];

/**
 * A placement moved to a corner: the map from the space of the display object to the pixels of
 * an image whose top left corner is at (x, y) of the target. The view is drawn into the image
 * with it.
 *
 * @example
 * renderer.render({ container, target: texture, transform: matrix.set(...spaceToImage(place, box.x, box.y)) });
 */
export function spaceToImage(place: Placement, x: number, y: number): MatrixArgs {
    return [
        Number(place[0]),
        Number(place[1]),
        Number(place[2]),
        Number(place[3]),
        Number(place[4]) - x,
        Number(place[5]) - y,
    ];
}

/**
 * The inverse of a placement, moved to a corner. It maps the pixels of an image whose top left
 * corner is at (x, y) back to the space of the display object. A sprite with this
 * transform shows the image where it was drawn. Throws for a placement that cannot be inverted.
 *
 * @example
 * sprite.setFromMatrix(target.set(...imageToSpace(place, box.x, box.y)));
 */
export function imageToSpace(place: Placement, x: number, y: number): MatrixArgs {
    const a = Number(place[0]);
    const b = Number(place[1]);
    const c = Number(place[2]);
    const d = Number(place[3]);
    const det = a * d - b * c;

    if (det === 0) throw new Error('A placement of scale 0 has no inverse.');
    const ia = d / det;
    const ib = -b / det;
    const ic = -c / det;
    const id = a / det;
    // the corner of the image in pixels, then back by the inverse
    const sx = x - Number(place[4]);
    const sy = y - Number(place[5]);

    return [ia, ib, ic, id, ia * sx + ic * sy, ib * sx + id * sy];
}
