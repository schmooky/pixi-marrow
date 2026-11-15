---
'pixi-marrow': patch
---

Fixes from an audit of pacing, lod, skins and baking.

- `MarrowAsset.get` and `MarrowSpine.from` read no page images unless `outlines` is `'auto'`, as `MarrowAsset.load` does. The Pixi `Assets` path scanned every page before, about 32 MB for a page of 2048 by 2048.
- A display object that sets `tightMesh` or `occlusion` by name on an asset without outlines warns once per asset, because those options do nothing then.
- `offscreen: 'pause'` and `'throttle'` count a skeleton as off the screen when it or a parent has `visible` or `renderable` false. Pixi still calls `onRender` for such a skeleton, so a hidden popup kept its skeletons updating.
- `lod: 'auto'`: a skeleton that shrinks while an animation with deforms mixes out, then grows again, shows the deform of a skeleton without lod. It showed the deform from before the mix.
- Setting `skin` or `skins` to the skins that are active changes nothing. It put the slots into their setup pose before, which reset tints and attachments set through slot handles. `skin` reads null while several skins are active, and null written back keeps them.
- A freed combined skin gives its index to the next one, so the count of skins stays bounded for a game that tries many lists.
- Baked playback shows the nearest frame. A tick of a 60 Hz screen lands on a sample, give or take its jitter. Playback of the frame at or before the time repeated a frame and skipped the next in most updates.
- `bake: 'auto'` bakes a clip in idle time, a frame of the animation or more per slice. The object plays live until the clip is there. The bake ran inside the update that first played the animation, a hitch on a phone. The clips are the same.
- `addBakedClips` refuses a clip whose duration is not that of the animation, which catches a stale clip of a JSON export without the editor hash. It also refuses a draw order that holds a slot twice.
