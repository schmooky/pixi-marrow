---
'pixi-marrow': patch
---

Fixes from an audit of loading, assets and file readers.

- An asset counts its holders. Each `MarrowAsset.load` that returns it is one owner, and each live `MarrowSpine` holds it too. `asset.destroy()` lets one owner go. The asset unloads its textures only when no owner and no display object is left. Before, one `destroy` call took the textures from every display object, and the Pixi render crashed.
- `MarrowSpine.load` gives its hold on the asset to the display object. `hero.destroy()` then unloads the asset when no other holder is left. Before, the model and the textures stayed for the life of the page.
- Page images are held by absolute URL, in one map for `MarrowAsset.load` and for the `.atlas` parser of Pixi `Assets`. A relative and an absolute URL of one image give one texture. pixi-marrow never unloads an image that the game loaded through Pixi `Assets` itself.
- Unloading an atlas or a skeleton from Pixi `Assets` lets the assets made from it go. An asset with a display object on the stage keeps its pages until that object is destroyed. An asset of a skeleton that was loaded again no longer stays in memory.
- `MarrowAsset.load` sends every URL through the resolver of Pixi `Assets`. `basePath` and `defaultSearchParams` of `Assets.init` now apply to the skeleton, the atlas, the outlines file and the pages. Before, they applied to the pages only, and a page path could double.
- A JSON skeleton is told by its content, not by a `.json` suffix. URLs with a hash, a query or no extension work, and `blob:` URLs too. `importSkeleton` and `sniffSkeleton` take the bytes of a JSON file.
- When a server answers with an HTML page, the error says so and names the URL. Every load error names its URL. The parsers for Pixi `Assets` throw `MarrowError`.
- `outlines: 'auto'`: assets that draw from one page image share one scan of it. The scans read the pages one after the other through one WebGL context, and free it when no page waits. Before, 17 assets on one atlas opened 17 contexts. A scan works in slices of 4 ms. A page that fails warns once, with the cause.
- `MarrowAsset.get` and `MarrowSpine.from` take `outlines` as an object, or as the alias or URL of an outlines file that Pixi `Assets` loaded.
- `pixi-marrow outlines` has the option `--pages <dir>`. It reads the PNG sources of an atlas with WebP or AVIF pages from that folder, by base name. Without the option, the error for such an atlas names it.
- `model.hash` is the same for the `.json` and the `.skel` of one export: 16 hex digits. Clips baked from a `.skel` before this release need a new bake.
- The 4.3 binary reader checks every count against the file size, as the 4.2 reader does. All readers refuse more than 32,767 bones or slots.
- A dark color timeline on a slot without a dark color fails at the import, for all versions. Before, a 4.3 skeleton threw inside the ticker.
- A page image that the game loaded before in another alpha mode than its atlas page needs warns once, with the fix.
