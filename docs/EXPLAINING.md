# How the docs explain

The docs of pixi-marrow teach people who have never used Spine, a Spine runtime or a GPU. Many of them come from slot games, and some from no game at all. A page succeeds when such a reader can say what happens on the screen, why it happens, and what it costs. This file is the standard that every page of `apps/site` follows.

## The reader

Assume a developer who knows TypeScript and a little Pixi, and nothing else. They do not know what a bone, a slot, a mix, a draw call or a vertex is. Explain every such word in plain words where it first appears, before the page uses it.

## Four kinds of page

The site follows Diátaxis. It has four kinds of page: Basics, Guide, How it works and Reference. Each page has one job, and a page that mixes jobs serves none of them.

- **Basics** pages explain the computer graphics a runtime stands on: pixels and frames, transforms, triangles and textures, the GPU and draw calls, blending. They come first, so that no later page has to assume them.
- **Guide** pages lead to a result: load, play, mix, listen. They show the calls and say what each does. They link to How it works for the why, and do not explain the machinery themselves.
- **How it works** pages build understanding: what the runtime does in a frame, why, and what it costs. They show no setup code.
- **Reference** pages are where a reader finds a fact: options, numbers, limits.

## Show, then tell

Every idea starts with something the reader can see move, and the words come after it.

1. **An animation first.** A diagram on plain shapes, such as squares, a two-bone arm or a strip of triangles, shows the idea before any sentence names it. A live preview of a real rig follows when the idea is clear.
2. **Then the name.** The paragraph after the diagram names what the reader saw: "this is a mix".
3. **Then the rule.** The general rule comes after a concrete case, with real numbers from the rigs.
4. **Then the call.** On guide pages, the API comes last, as the way to get what the reader now understands.

## One idea per diagram

- A diagram shows one idea. Two ideas get two diagrams.
- A diagram guides the reader, and is not a sandbox. Its caption says what to look at. The text tells the reader what to try and what they will see: "pick 0 s first, and the square jumps".
- **Contrast** teaches. Put two cases side by side, with and without, replace and add, and let the difference be the lesson.
- **Labels sit on the drawing**, next to what they name. The paragraph that explains a diagram comes right after it.
- **Colors mean the same everywhere.** Blue is the first track or animation, orange the second, white the result. Grey dashes mark the setup pose.
- **Motion has a purpose.** Nothing moves for decoration. A diagram that shows a sequence steps through it. The reader can pause it, and slow it to a half or a quarter of its speed.
- **The line under the drawing says what happens now**, as subtitles do. It is a sentence, not a value dump: "Mix from A into B, 30 percent of the way. B keys no position, so the square slides home." Its words change when the phase changes. A number that the reader should watch may follow the drawing, as the share of a mix or the value of a curve does. The names in it take the colors of the drawing.
- **The picture comes before the code** in every section. A section that opens with a call has the order upside down.

## Words

- Each paragraph adds a fact or a reason. Cut a paragraph that only repeats what the code above it says.
- One name per thing, the name of the official runtime where there is one, and the same name on every page.
- Name the wrong picture a reader is likely to have, and show why it is wrong. For example, a mix is not a fade between two pictures, and a draw call does not draw one skeleton.
- Every mechanism ends with its cost: what it costs in a frame, what makes it grow, and what breaks it. A reader who knows the mechanism can then predict performance.
- Numbers come from the rigs and from measurements. Check each one before it goes on a page.

## Simplified Technical English

The Markdown and MDX docs follow ASD-STE100, Simplified Technical English, in its STE-flavored mode. They are the README, AGENTS.md, the files of `docs/`, the changesets and the pages of the site, captions included. STE removes the two main causes of misreading: a word with more than one meaning, and a sentence with more than one structure. The changelog and the released changesets in `.changeset/pre/` keep their history as written.

The structural rules hold in full:

- At most 25 words in a sentence that describes, and at most 20 in an instruction, such as "Pick 0 s first."
- One idea per sentence. One topic per paragraph, and at most 6 sentences in it.
- Active voice. Name who acts: the runtime, the game, the track, Pixi, you. Use the passive only when the actor is unknown or does not matter.
- Simple tenses. Use the present perfect or the past perfect only when the result now is the point.
- No semicolons, and at most one colon in a sentence.
- No phrasal verb where one plain verb exists. Write `start`, not `kick off`.
- Verbs, not actions frozen into nouns. Write `measure it`, not `perform a measurement`.
- No stack of more than 3 nouns.
- A list for 3 or more steps or conditions.
- Plain ASCII, and no hype or filler words.

A rewrite keeps every fact, number, unit, API name, code span, link and hedge, and adds no fact. A hedge is part of the claim, so `may fail` stays `may fail`. A sentence that already follows the rules stays as it is. The pages teach newcomers, so they stay friendly and clear: short sentences, not robotic ones.

Two names are settled. One `MarrowSpine` of an asset is an instance on every page. The second color of a slot is the dark tint, as in `Slot.darkTint`. Say once, where a page first uses it, that the Spine editor calls it Tint black and the official runtime calls it the dark color.

The lexical rules are a direction, not a lock. Use the plainest common word, and the same word for the same thing. Prose needs some range, so only the words of the list below have one fixed meaning.

`node scripts/check-prose.mjs` enforces the hard part, and `pnpm lint:prose` runs it on every file in scope. It fails on:

- a sentence of more than 25 words, or a paragraph or caption of more than 6 sentences
- a semicolon, or two colons in one sentence
- a soft phrasal verb, such as `spin up` or `kick off`
- an action frozen into a noun, such as `perform an analysis`
- a hype or filler word
- typography outside plain ASCII, such as a curly quote or an em dash

`node scripts/check-prose.mjs --advisory` also lists what needs judgment, and does not fail on it:

- possible passive voice
- compound tenses, such as `has shown` or `had moved`
- several verbs for one action in one file, such as `check` and `verify`

Review every note. Fix it, unless the passive is right because the actor is unknown or does not matter. Keep a compound tense only when it carries a meaning that the simple tense cannot.

### Word list

STE allows a project word list. In the docs, each of these words has one meaning, and each verb takes the place of the words in its last column.

| Verb | Meaning | Instead of |
|---|---|---|
| check | to test that something is right | `verify`, `confirm`, `validate` |
| remove | to take something out of a place or a list | `delete`, `erase`, except in code |
| start | to make something run from its first moment | `begin`, `launch`, `initiate` |
| stop | to make something end | `halt`, `terminate` |
| show | to make something visible | `display` as a verb. "display object" is a Pixi name and stays |
| use | to do work with something | `utilize`, `employ` |
| fix | to make something that is wrong right | `repair`, `correct` |
| change | to make something different | `modify`, `alter` |

| Noun | Meaning |
|---|---|
| skeleton | the bones, slots, skins and animations of one Spine export |
| bone | one part of the tree of a skeleton, with a transform relative to its parent |
| slot | a place in the draw order that holds one attachment at a time |
| attachment | what a slot holds: a region, a mesh or another shape |
| skin | a set of attachments, each under a slot and a name |
| animation | a named stretch of time that keys bones, slots and other values |
| track | a layer that plays one animation at a time, with a playhead |
| mix | a blend over some time from one animation into the next |
| pose | where every bone is and what every slot shows, at one moment |
| setup pose | the pose of a skeleton as the animator built it, with no animation applied |
| draw call | one command from the CPU to the GPU to draw triangles |
| batch | the triangles of one draw call, often from many skeletons |
| vertex | a corner of a triangle |
| texture | an image that the GPU can read |
| atlas | a `.atlas` file and its page images, which hold the images of a skeleton |
| page | one image of an atlas. This file and AGENTS.md also use it for a page of the site |
| region | a rectangle on an atlas page, or the attachment that shows it |
| mesh | an attachment made of many triangles |
| instance | one `MarrowSpine` of an asset, with its own pose and tracks. Write `instance` on every page, not `copy` |
| dark tint | the second color of a slot, which colors the dark parts of its image. The API name is `Slot.darkTint` |

## How the diagrams are built

- `apps/site/src/diagrams/` holds one module per diagram, and `Diagram.astro` mounts it. A diagram runs only while it is in view.
- Sequences, such as a frame from time to pixels, are timelines of anime.js that the reader can play, pause and slow. A diagram hands them to the diagram runtime with `own`, which plays them only while the diagram plays.
- Every diagram gets a line under its drawing, with a button that pauses it and one that slows it. `say` writes the line. A part written `{first:A}`, `{second:B}` or `{result:what you see}` takes that color. The panel under the line holds what the reader picks, and readouts only for numbers that do not fit the sentence. The `rows` of `Diagram` counts the panel rows, so that the page does not jump. With 0, the diagram has no panel.
- A diagram that changes only when the reader picks something hides the buttons. A reader who asks for less motion sees a still frame, and presses play when they want it to move. In the still frame each step of `onFrame` runs once with no time. Each animation given to `own` stands at the end of its first pass, or at the moment it names with `still`. A still frame must show the idea, so a diagram whose content appears late names a moment where the content shows.
- A pick does not start a paused diagram. The diagram stays paused and shows the pick as a still frame.
- On a phone a row of lanes stands one under the other. When the screen crosses that width, the diagram runtime builds the diagram again from nothing.
- Text on a drawing is 12 units or more. A label inside a small shape, such as a bar of a time line, may be as small as 10.5.
- Where the numbers matter, such as how a mix blends, a diagram computes them with `mixing.ts` and the other models of the folder. These models follow the rules of the official runtime. A diagram never fakes a result that the runtime would compute differently.
- The live previews of `src/previews/` show the real runtime on real rigs, and come after the diagram that explains the idea.

## Sources

- Daniele Procida, [Diátaxis](https://diataxis.fr/): tutorials, how-to guides, reference and explanation, and why they stay apart.
- Bret Victor, [Explorable Explanations](https://worrydream.com/ExplorableExplanations/) and Up and Down the Ladder of Abstraction: explanations the reader plays with, guided to one point, from concrete to abstract.
- Nicky Case, [How I make an explorable explanation](https://blog.ncase.me/how-i-make-an-explorable-explanation/) and How To Explain Things Real Good: show what made you care, show then tell.
- Amit Patel builds a tutorial up from one small diagram, and shows how in [the making of his line drawing tutorial](https://www.redblobgames.com/making-of/line-drawing/).
- Richard Mayer, the cognitive theory of multimedia learning, summarized in [Design for Learning](https://edtechbooks.org/design_psychology/CTML): signaling, contiguity, segmenting, pretraining and coherence.
- ASD, [ASD-STE100 Simplified Technical English](https://www.asd-ste100.org/): the writing rules of the prose, in its STE-flavored mode.
