import type { PoseEngine } from '../pose/engine';
import type { MarrowAsset } from './asset';
import type { BakeMode } from './presets';

/**
 * The pose engine of a display object for its `bake` setting. With `off` it is the engine of the
 * asset as it is.
 *
 * @example
 * this.engine = bakingEngine(asset, asset.createEngine(), settings.bake);
 */
export function bakingEngine(_asset: MarrowAsset, engine: PoseEngine, _mode: BakeMode): PoseEngine {
    return engine;
}
