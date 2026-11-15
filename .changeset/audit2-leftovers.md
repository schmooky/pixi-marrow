---
'pixi-marrow': patch
---

The leftovers of the second audit.

- An asset has a name. `asset.name` is the `name` option of the load. Without that option, it is the file name of the skeleton URL without the extension. It is the empty string for a skeleton in memory. A display object without a `label` gets the label `MarrowSpine:<name>`.
- `MarrowAsset.fromData` makes an asset from data in memory. `MarrowAsset.from` is the older name and is deprecated. `MarrowAsset.fromCache` gets the asset of files that Pixi `Assets` loaded. `MarrowAsset.get` stays as its first name.
- More errors have a code of their own. A file or a page image that does not load throws `not-found`. A call before `registerMarrowAssets()` throws `not-registered`. An alias that Pixi `Assets` does not hold throws `not-loaded`. A wrong argument of an engine call, of `createProbe` and of `MarrowDebug` throws `invalid-option`. A destroyed view and a destroyed probe target throw `destroyed`.
- A baked clip of the JSON export fits the binary export of the same skeleton. The duration of the clip can differ from the animation by 0.0001 seconds.
- The pacing of `offscreen` and `lod` reads a box that can be 8 renders old. A skeleton with `skinning: 'gpu'` no longer places its vertices on the CPU in each frame. A move, a new scale and a new attachment still count at once.
- The mesh mode uploads the vertices that changed, not the whole buffer, on each pixi.js from 8.21. The upload occurs before the render. Thus `stats.uploadBytes` and `stats.frameBytes` count these bytes after the render.
- With `idleCache: 'auto'`, a skeleton whose animation ran while it was hidden no longer shows its old image for one frame.
- A second view of a model does not draft its first layout again.
- `pnpm build` loads its config as plain JavaScript. The build needs no Node that strips types.
