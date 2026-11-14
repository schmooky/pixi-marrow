---
'pixi-marrow': minor
---

The idle cache: with `idleCache: 'auto'`, a skeleton at rest is drawn as one image. No preset sets it. Each image is a texture of its own, so many images take memory and split batches, and on a low-end phone small resting symbols drew slower with it. Set it by name where a skeleton is expensive to draw live.

- After 30 updates in which its pose, its layout and its render mode did not change, and two renders at the same place, the skeleton is drawn once into a render texture. The view is hidden and a sprite with that image shows in its place, as one quad in Pixi's batch.
- The image lies on the pixel grid of the target, so it shows the pixels of the live skeleton. The pixel check holds it to the live skeleton and to the official runtime in both render modes, on WebGL2 and WebGPU.
- Any change of the pose, the layout or the render mode drops the image in the same frame, and the skeleton draws live. So does a render that puts it elsewhere than whole pixels away, or with an alpha or a blend mode above it. An attached container, another renderer, a multisampled target and a WebGL context that came back drop it too.
- A skeleton that shows a slot that multiplies or screens, or that would need an image larger than 2048 pixels on a side, draws live. So does one drawn to a multisampled target.
- A tint above a skeleton with a dark color keeps it live, because the shaders tint the light color alone.
- An image takes 4 bytes per pixel of its box on the target. A dropped image lets go of its color pixels.
- The code is a chunk of 2.2 kB gzip that loads with the first display object that has the setting. The root import grows by about 0.1 kB.
