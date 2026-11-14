# How the docs explain

The docs of pixi-marrow teach people who have never used Spine, a Spine runtime or a GPU. Many of them come from slot games, and some from no game at all. A page succeeds when such a reader can say what happens on the screen, why it happens, and what it costs. This file is the standard every page of `apps/site` follows.

## The reader

Assume a developer who knows TypeScript and a little Pixi, and nothing else. They do not know what a bone, a slot, a mix, a draw call or a vertex is. Every such word is explained where it first appears, in plain words, before it is used.

## Three kinds of page

The site follows Diátaxis. Each page has one job, and mixing jobs on one page serves none of them.

- **Basics** pages explain the computer graphics a runtime stands on: pixels and frames, transforms, triangles and textures, the GPU and draw calls, blending. They come first, so that no later page has to assume them.
- **Guide** pages lead to a result: load, play, mix, listen. They show the calls and say what each does. They link to How it works for the why, and do not explain the machinery themselves.
- **How it works** pages build understanding: what the runtime does in a frame, why, and what it costs. They show no setup code.
- **Reference** pages are for looking things up: options, numbers, limits.

## Show, then tell

Every idea starts with something the reader can see move, and the words come after it.

1. **An animation first.** A diagram on plain shapes, such as squares, a two-bone arm or a strip of triangles, shows the idea before any sentence names it. A live preview of a real rig follows when the idea is clear.
2. **Then the name.** The paragraph after the diagram names what the reader saw: "this is a mix".
3. **Then the rule.** The general rule comes after a concrete case, with real numbers from the rigs.
4. **Then the call.** On guide pages, the API comes last, as the way to get what the reader now understands.

## One idea per diagram

- A diagram shows one idea. Two ideas get two diagrams.
- A diagram is guided, not a sandbox. Its caption says what to look at, and the text tells the reader what to try and what they will see: "pick 0 s first, and the square jumps".
- **Contrast** teaches. Put two cases side by side, with and without, replace and add, and let the difference be the lesson.
- **Labels sit on the drawing**, next to what they name, and the paragraph that explains a diagram comes right after it.
- **Colors mean the same everywhere.** Blue is the first track or animation, orange the second, white the result. Grey dashes mark the setup pose.
- **Motion has a purpose.** Nothing moves for decoration. A diagram that shows a sequence steps through it, and the reader can pause it and slow it down to a half or a quarter.
- **The line under the drawing says what happens now**, as subtitles do. It is a sentence, not a value dump: "Mix from A into B, 30 percent of the way. B keys no position, so the square slides home." It changes when the phase changes, not in every frame, and the names in it take the colors of the drawing.
- **The picture comes before the code** in every section. A section that opens with a call has the order upside down.

## Words

- Each paragraph adds a fact or a reason. A paragraph that only repeats what the code above it says is cut.
- One name per thing, the name of the official runtime where there is one, and the same name on every page.
- Name the wrong picture a reader is likely to have, and show why it is wrong. For example, a mix is not a fade between two pictures, and a draw call does not draw one skeleton.
- Every mechanism ends with its cost: what it costs in a frame, what makes it grow, and what breaks it. A reader who knows the mechanism can then predict performance.
- Numbers come from the rigs and from measurements, and each is checked before it goes on a page.

## How the diagrams are built

- `apps/site/src/diagrams/` holds one module per diagram, mounted by `Diagram.astro`. A diagram runs only while it is in view.
- Sequences, such as a frame from time to pixels, are timelines of anime.js that the reader can play, pause and step.
- Every diagram gets a line under its drawing, with a button that pauses it and one that slows it down. `say` writes the line, and a part written `{first:A}`, `{second:B}` or `{result:what you see}` takes that color. The panel under the line holds what the reader picks, and readouts only for numbers that do not fit the sentence. The `rows` of `Diagram` counts the panel rows, so that the page does not jump, and 0 leaves the panel out.
- A diagram that changes only when the reader picks something hides the buttons. A reader who asks for less motion sees the first frame, and presses play when they want it to move.
- Text on a drawing is 12 units or more. A label inside a small shape, such as a bar of a time line, may go down to 10.5.
- Where the numbers matter, such as how a mix blends, a diagram computes them with `mixing.ts` and the other models of the folder, which follow the rules of the official runtime. A diagram never fakes a result that the runtime would compute differently.
- The live previews of `src/previews/` show the real runtime on real rigs, and come after the diagram that explains the idea.

## Sources

- Daniele Procida, [Diátaxis](https://diataxis.fr/): tutorials, how-to guides, reference and explanation, and why they stay apart.
- Bret Victor, [Explorable Explanations](https://worrydream.com/ExplorableExplanations/) and Up and Down the Ladder of Abstraction: explanations the reader plays with, guided to a particular point, from concrete to abstract.
- Nicky Case, [How I make an explorable explanation](https://blog.ncase.me/how-i-make-an-explorable-explanation/) and How To Explain Things Real Good: show what made you care, show then tell.
- Amit Patel builds a tutorial up from one small diagram, and shows how in [the making of his line drawing tutorial](https://www.redblobgames.com/making-of/line-drawing/).
- Richard Mayer, the cognitive theory of multimedia learning, summarized in [Design for Learning](https://edtechbooks.org/design_psychology/CTML): signaling, contiguity, segmenting, pretraining and coherence.
