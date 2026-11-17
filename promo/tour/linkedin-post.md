# LinkedIn post for the tour video

Attach `out/pixi-marrow-tour-portrait-small.mp4`. Use `out/cover-portrait.png` as the thumbnail.

---

I wrote a Spine runtime for PixiJS v8. It is called pixi-marrow, and version 0.2.0 is on npm.

A slot game shows many small Spine skeletons at once. Each one costs draw calls and CPU time, also when it stands still. On a weak phone that adds up fast.

What pixi-marrow does about it:

- 96 skeletons draw in one draw call. The counter in the video is the real number of each frame.
- A skeleton at rest is not posed, and it uploads nothing.
- On my machine, 200 playing skeletons took between a third and four fifths of the frame time of the official runtime. One rig of five is too close to call. The benchmarks page has every row.
- It tells you why a scene is slow, with rules that have ids. People can read them, and AI agents can too.

It is not version 1.0 yet, so the API can still change. It needs pixi.js 8.23 or later.

Every frame of the video is drawn live by pixi-marrow. The Spine animations are by Winspinity, https://winspinity.com

npm install pixi-marrow pixi.js

Docs and demos: https://pixi-marrow.schmooky.dev
Code: https://github.com/schmooky/pixi-marrow

#PixiJS #Spine #WebGL #WebGPU #gamedev #typescript #opensource
