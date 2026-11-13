---
'pixi-marrow': minor
---

Several skins at once, a slot handle, the setup pose and point conversion on the display object.

- `hero.skins = ['skin-base', 'hair/pink']` makes a list of skins active as one, as `Skin.addSkin` does in the official runtime. The later skin wins where two store an attachment under one slot and name. Instances of an asset share the combined skin.
- `hero.slot(name)` gives a handle with `attachment`, `tint`, `alpha` and `darkTint`. A write stays until an animation keys the slot or the setup pose of the slots is set.
- `hero.setupPose()` resets the bones and the slots, `'bones'` or `'slots'` one half.
- `bone.localToWorld(point)` and `bone.worldToLocal(point)` take points between a bone and the skeleton.
- The pose engines of `pixi-marrow/core` gain `setSkins`, `skins`, `setAttachment`, `setColor` and `setDarkColor`. A parity family checks all of them against the official cores of 4.1, 4.2 and 4.3.
