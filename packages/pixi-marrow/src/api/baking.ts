import type { PoseEngine } from '../pose/engine';
import type { MarrowAsset } from './asset';
import { namedIndex } from './checks';
import type { BakeMode } from './presets';

/**
 * The pose engine of a display object for its `bake` setting. With `off` it is the engine of the
 * asset as it is. Otherwise the code of baked playback loads on demand and then plays the
 * updates it can from baked frames. The object plays as without baking until the code is there.
 *
 * A name of the list that is no animation of the skeleton throws a `MarrowError` that lists the
 * animations, before anything loads.
 *
 * @example
 * this.engine = bakingEngine(asset, asset.createEngine(), settings.bake);
 */
export function bakingEngine(asset: MarrowAsset, engine: PoseEngine, mode: BakeMode): PoseEngine {
    if (mode === 'off') return engine;
    const animations =
        mode === 'auto' ? null : mode.map((name) => namedIndex('animation', asset.model.animations, name));

    import('../bake/playback').then(
        ({ playBaked }) => playBaked(asset, engine, animations),
        // a chunk that did not load leaves the object as it is: it plays without baking
        () => undefined,
    );

    return engine;
}
