---
'pixi-marrow': minor
---

Load skeletons through Pixi `Assets`. `registerMarrowAssets()` adds parsers for `.skel` files, Spine `.json` files and `.atlas` files, so aliases, manifests and bundles load them, as AssetPack writes them. `MarrowSpine.from({ skeleton, atlas })` and `MarrowAsset.get` take the aliases and return at once. An atlas named like `hero@0.5x.webp.atlas` counts as resolution 0.5 in WebP for `texturePreference`. The `data` of an atlas takes `images` and `imageMetadata`, as in the official runtime. Unloading an atlas destroys the assets made from it.
