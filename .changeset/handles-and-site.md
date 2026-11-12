---
'pixi-marrow': minor
---

Bone handles and containers in a skeleton. `hero.bone(name)` reads and writes the pose of a bone and reads its place in the skeleton. `hero.follow(bone, container)` moves a Pixi container with a bone. `hero.attach(slot, container)` draws a container at the place of a slot in the draw order and moves it with the bone of the slot, as `addSlotObject` of the official runtime does. `unfollow` and `detach` end it. The perf report has a row `links`.

Fixed: in a game whose bundle is tree-shaken and imports no Pixi `Mesh` of its own, the mesh mode threw when its code loaded after the renderer was created. It now gives the renderer the mesh pipe it lacks.

Fixed: the engine for Spine 4.1 and 4.2 lost a write to a bone from outside when `setSkin` was called with the skin that was set already, before the next update.
