---
'pixi-marrow': patch
---

A playing pose engine no longer allocates in an update that reports no event. Before, a walking spineboy allocated about 1,400 bytes in each update. An update that reports events allocates the list that `takeEvents` returns and one object for each event. A test now measures the heap of live engines of both kinds while their timelines play.

The 4.3 pose engine now rests in the same states as the 4.2 engine. These states are ended entries on two or more tracks, an ended entry below full alpha, and an ended entry on an upper track only. In these states an update runs no timeline, and `state.version` stays the same.

`configure` follows the same rules in both pose engines. The engine checks all fields before it writes one, so a call that throws changes nothing. A field of a different Spine version throws `unsupported-feature`. A name that no version has throws `unknown-name` with the closest field name. A value of the wrong type throws `invalid-data`. A field with the value `undefined` stays as it is.

The 4.3 engine prepares an animation when a call plays it for the first time. The first engine of a model with 1,500 animations took 70 ms and 38 MB. It now takes 17 ms and 1 MB. An animation that the engine cannot play now throws on its first play, not when you create the engine.

A timeline with more than 32 keys is searched by halves. The search finds the same key as the official search. In the 4.2 engine, an animation with 6,000 keys on each of 30 bones took 265 microseconds for each update. It now takes 22.

A slot without a deform shares one empty array with all other slots. One spineboy instance takes about 10 kB less memory. `engine.bytes` counts the data of the typed arrays. The JSDoc now gives the cost of the objects that it does not count.

The 4.3 engine keeps each entry that a track mixes from while the track changes its animation faster than the mix. The official 4.3.13 runtime does the same, and the pose must be equal to the official pose. A test now records this behavior.

The JSDoc of `takeEvents` and `createPoseEngine` now tells you to call `takeEvents` after each update. An engine keeps its events until that call.
