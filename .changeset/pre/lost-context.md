---
'pixi-marrow': patch
---

Fixed: a skeleton that was first drawn while the WebGL context was lost stayed invisible after the context came back. On pixi.js 8.16 it threw inside the render. A skeleton now draws nothing while the context of its renderer is lost, and draws again with the context that comes back. Skeletons that were drawn before the loss came back before this change and still do, at rest too.

The pixel check now loses and restores the context of a running game in both render modes, see `scripts/render/restore-check.mjs`.
