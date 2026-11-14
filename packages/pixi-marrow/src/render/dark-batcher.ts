import type { BatcherOptions, ExtensionMetadata } from 'pixi.js';
import { ExtensionType } from 'pixi.js';
import { DARK_BATCHER } from './batch-element';
import { MarrowBatcher } from './batcher';

/**
 * Batches skeletons with dark colors: a vertex carries 4 more bytes, and the shader tints with
 * two colors.
 *
 * @example
 * extensions.add(MarrowDarkBatcher);
 */
export class MarrowDarkBatcher extends MarrowBatcher {
    /** How Pixi registers the class. */
    static override extension: ExtensionMetadata = { type: [ExtensionType.Batcher], name: DARK_BATCHER };

    constructor(options?: BatcherOptions) {
        super(options, true);
    }
}
