import { type Bounds, Geometry, type GeometryDescriptor } from 'pixi.js';

/**
 * A Pixi geometry that takes its bounds from a function, so Pixi never scans a vertex buffer for
 * them. The meshes of a skeleton share the box of its visible vertices this way.
 *
 * @example
 * const box = new Bounds(0, 0, 64, 64);
 * const geometry = new MeasuredGeometry({ attributes: { aPosition: positions }, indexBuffer }, () => box);
 * console.log(geometry.bounds === box); // true
 */
export class MeasuredGeometry extends Geometry {
    private readonly measure: () => Bounds;

    constructor(options: GeometryDescriptor, measure: () => Bounds) {
        super(options);
        this.measure = measure;
    }

    /** The box the function gives at the moment. */
    override get bounds(): Bounds {
        return this.measure();
    }
}
