# LinkedIn post for the tour video

Attach `out/pixi-marrow-tour-small.mp4`. Use `out/cover.png` as the thumbnail, because the first frame of the video is black.

---

I wrote a Spine runtime for PixiJS v8. It is called pixi-marrow, and version 0.2.0 is on npm.

Why I wrote it: a slot game shows many small Spine skeletons at once. Each one costs draw calls and CPU time, also when it stands still. On a weak phone that adds up fast.

What pixi-marrow does about it:

→ 200 skeletons of 11 different rigs draw in one draw call. The counter in the video is the real number of each frame.
→ A skeleton at rest is not posed, and it uploads nothing.
→ On my machine, 200 playing skeletons took between a third and four fifths of the frame time of the official runtime. One rig of five is too close to call. The benchmarks page has every row, the method and the date.
→ It tells you why a scene is slow. 25 rules with ids, such as MARROW001 for a container that moves. People can read them, and AI agents can too.

What it is not: version 1.0. The API can still change. It needs pixi.js 8.23 or later, and WebGL2 or WebGPU. It plays Spine 4.1, 4.2 and 4.3, under the Spine Runtimes License.

Every frame of the video is drawn live by pixi-marrow on one canvas. The text and the panels are pixi-silk.

npm install pixi-marrow pixi.js

Docs and live demos: https://pixi-marrow.schmooky.dev
Benchmarks: https://pixi-marrow.schmooky.dev/benchmarks/
Code: https://github.com/schmooky/pixi-marrow

If you try it and something looks wrong, show me. Hard cases made it better so far.

#PixiJS #Spine #WebGL #WebGPU #gamedev #javascript #typescript #opensource
