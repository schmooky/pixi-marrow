import { Application, Container } from 'pixi.js';
// #region load
import { MarrowAsset, MarrowSpine } from 'pixi-marrow';

const NAMES = ['a', 'j', 'k', 'q', 'bee', 'coin', 'wild'] as const;

type SymbolId = (typeof NAMES)[number];

/** Loads the asset of one symbol of the set. */
const loadSymbol = (id: SymbolId): Promise<MarrowAsset> =>
    MarrowAsset.load({ skeleton: `rigs/animation_${id}.skel`, atlas: 'rigs/symbols.atlas' });
const assets = new Map<SymbolId, MarrowAsset>();

// every symbol names the same atlas, so its pages load once
await Promise.all(NAMES.map(async (id) => assets.set(id, await loadSymbol(id))));
// #endregion

const app = new Application();

await app.init({ resizeTo: window });

// #region copies
/** Makes a copy of a symbol that plays on its own. */
function makeSymbol(id: SymbolId): MarrowSpine {
    const asset = assets.get(id);

    if (asset === undefined) throw new Error(`no symbol ${id}`);

    return new MarrowSpine(asset);
}

const reels = app.stage.addChild(new Container());

// two copies of A share everything but their pose
reels.addChild(makeSymbol('a'), makeSymbol('a'), makeSymbol('coin'));

// #endregion

// #region assets
import { Assets } from 'pixi.js';
import { registerMarrowAssets } from 'pixi-marrow';

registerMarrowAssets();
await Assets.load(['rigs/animation_a.skel', 'rigs/symbols.atlas']);

const fromBundle = new MarrowSpine(MarrowAsset.get({ skeleton: 'rigs/animation_a.skel', atlas: 'rigs/symbols.atlas' }));
// #endregion

// #region pool
/** Copies of each symbol that wait off the reels, so a spin makes none. */
const pools = new Map<SymbolId, MarrowSpine[]>(NAMES.map((id) => [id, []]));

/** Takes a copy of a symbol from its pool, or makes one. */
function take(id: SymbolId): MarrowSpine {
    return pools.get(id)?.pop() ?? makeSymbol(id);
}

/** Gives a copy back when its cell shows another symbol. */
function give(id: SymbolId, symbol: MarrowSpine): void {
    symbol.removeFromParent();
    pools.get(id)?.push(symbol);
}
// #endregion

give('a', take('a'));
app.stage.addChild(fromBundle);
