---
'pixi-marrow': minor
---

pixi-marrow needs pixi.js 8.23.0 or later. The peer range is `^8.23.0`. It was `^8.21.0`.

pixi.js 8.23 is the latest release. On 8.21 and 8.22, a WebGL buffer kept one stretch until Pixi bound it, and a data texture uploaded whole. The runtime had a second upload path for those versions, with its own tests and its own CI job. The library is a pre-release, so that path is not worth its cost.

- The upload path for pixi.js 8.21 and 8.22 is gone. Nothing changes on pixi.js 8.23.
- The rule `MARROW026` is retired, because no game can run the older versions. Its id stays reserved. The rules are `MARROW001` to `MARROW025`.
- The root import and the mesh mode are smaller.
