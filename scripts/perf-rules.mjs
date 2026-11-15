#!/usr/bin/env node
/**
 * The catalogue of performance rules: the one source for what `pixi-marrow/diagnose` reports.
 * Run as a script, it writes the catalogue into the files that repeat it:
 *
 * - packages/pixi-marrow/src/diagnose/rules-data.ts, the rules as data of the library,
 * - packages/pixi-marrow/perf-rules.json, which ships in the npm tarball,
 * - apps/site/public/perf-rules.json, which the site serves at /perf-rules.json,
 * - apps/site/src/pages/performance/rules.mdx, the docs page with one heading per rule,
 * - the rule table of packages/pixi-marrow/agent/AGENTS.md, the guide for coding agents.
 *
 *   --check   change nothing, fail when a file is stale
 *
 * usage: node scripts/perf-rules.mjs [--check]
 *
 *
 * A rule names one cause of cost that a tool can find in the Pixi scene tree or in the counters
 * of a skeleton. Its id is stable: an id is never used again for another cause, see RETIRED. Each text states
 * what the code does now, with the source file to read. scripts/perf-rules.mjs writes the rules
 * into the library, the JSON file, the docs page and the guide for coding agents.
 *
 * Fields of a rule:
 *
 * - `id`, `slug`, `title`: the stable id, a short name and one line for a table.
 * - `severity`: `warn` for a cost that grows with the scene, `info` for a cost to know about.
 * - `cost`: what the cause costs. See COSTS.
 * - `detect`: `static` when one look at the tree finds it, `dynamic` when two looks do.
 * - `pattern`: what a tool sees in the tree or in the counters.
 * - `does`: what the runtime does then. `source`: the file that does it.
 * - `check`: the field of `inspect(hero)` that shows it.
 * - `fix`: what to change.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The address of the docs page. The anchor of a rule is its id in lower case. */
export const DOCS = 'https://pixi-marrow.schmooky.dev/performance/rules/';

/** The release that first shipped the catalogue. */
const SINCE = '0.2.0';

/** What a cause costs, with the words the docs use for it. */
export const COSTS = {
    'draw-calls': 'draw calls',
    'cpu-vertex': 'CPU time for vertices',
    'cpu-pose': 'CPU time for the pose',
    upload: 'bytes sent to the GPU',
    overdraw: 'pixels drawn more than once',
    memory: 'memory',
};

export const RULES = [
    {
        id: 'MARROW001',
        slug: 'moving-ancestor-batched',
        title: 'A display object above a batched skeleton moves',
        severity: 'warn',
        cost: ['cpu-vertex', 'upload'],
        detect: 'dynamic',
        pattern:
            'A skeleton in the batched mode, or a container above it, changes its position, scale or rotation in each frame. No render group lies between that container and the skeleton.',
        does: 'A batch holds vertex positions in the space of its render group. The runtime places every vertex of the skeleton again and uploads it, also when the pose is at rest.',
        source: 'src/render/batch-element.ts',
        check: '`totals.transformReplaces` grows from frame to frame.',
        fix: "Set `isRenderGroup: true` on the container that moves, or set `renderMode: 'mesh'` on the skeleton.",
    },
    {
        id: 'MARROW002',
        slug: 'ancestor-tint-animated',
        title: 'The alpha or the tint above a batched skeleton changes',
        severity: 'warn',
        cost: ['cpu-vertex', 'upload'],
        detect: 'dynamic',
        pattern:
            'The alpha or the tint of a skeleton in the batched mode, or of a container above it, changes in each frame. No render group lies between that container and the skeleton.',
        does: 'Each vertex of a batch carries the tint of its display object. The runtime writes the static data of every visible vertex again and uploads it.',
        source: 'src/render/batch-element.ts',
        check: '`totals.tintRewrites` grows from frame to frame.',
        fix: "Fade a container that has `isRenderGroup: true`, fade slots with `hero.slot(name).alpha`, or set `renderMode: 'mesh'`.",
    },
    {
        id: 'MARROW003',
        slug: 'ancestor-alpha-or-blend',
        title: 'An alpha or a blend mode above the skeleton stops occlusion and the idle image',
        severity: 'info',
        cost: ['overdraw'],
        detect: 'static',
        pattern:
            'The skeleton or a container above it has an alpha other than 1, or a blend mode other than `normal` and `inherit`. The skeleton has outlines or the setting `idleCache`.',
        does: 'An opaque slot then shows what is behind it. The runtime draws every covered slot again while that holds, and the idle cache drops its image.',
        source: 'src/render/gate.ts',
        check: '`cuts.blockedBy` holds `alpha-or-blend`, and `cuts.coveredSlots` is 0.',
        fix: 'Keep the alpha at 1 and the blend mode at `normal` while the skeleton is at rest. Fade for a short time only.',
    },
    {
        id: 'MARROW004',
        slug: 'batch-broken-by-sibling',
        title: 'Another display object draws between two batched skeletons',
        severity: 'warn',
        cost: ['draw-calls'],
        detect: 'static',
        pattern:
            'In the draw order, another display object lies between two batched skeletons. That object is a sprite, a text, a graphics object or a skeleton in the mesh mode.',
        does: 'A batch ends where Pixi draws something else. The second skeleton starts a new batch, which is one more draw call.',
        source: 'src/render/batcher.ts',
        check: '`render.sharedBy` is lower than the number of batched skeletons in the layer.',
        fix: 'Put the skeletons into one container and the other objects into a container above or below it.',
    },
    {
        id: 'MARROW005',
        slug: 'sortable-interleave',
        title: 'A sorted container mixes skeletons with other display objects',
        severity: 'warn',
        cost: ['draw-calls'],
        detect: 'static',
        pattern:
            'A container with `sortableChildren` holds batched skeletons and other display objects. Their `zIndex` values put another object between two skeletons.',
        does: 'Pixi draws the children in the order of `zIndex`. Each object between two skeletons ends a batch, as in MARROW004.',
        source: 'src/render/batcher.ts',
        check: '`render.sharedBy` is lower than the number of batched skeletons in the container.',
        fix: 'Give the skeletons one range of `zIndex` values, or put them into a layer of their own.',
    },
    {
        id: 'MARROW006',
        slug: 'blend-run-split',
        title: 'A blend mode splits the draws of a skeleton',
        severity: 'info',
        cost: ['draw-calls'],
        detect: 'static',
        pattern:
            'A visible slot blends with multiply or screen. Or the skeleton, or a container above it, has a blend mode other than `normal` and `inherit`.',
        does: 'Normal and additive slots share one draw. A slot that multiplies or screens starts a new draw, and so does a skeleton with another blend mode than the one before it.',
        source: 'src/render/batch-element.ts',
        check: '`render.blendSlots` counts the slots, and `render.runs` counts the draws of the skeleton.',
        fix: 'Use additive slots where the art allows it. Put skeletons with the same blend mode next to each other in the draw order.',
    },
    {
        id: 'MARROW007',
        slug: 'page-slots-exhausted',
        title: 'More atlas pages than one draw can sample',
        severity: 'warn',
        cost: ['draw-calls'],
        detect: 'static',
        pattern:
            'A batched skeleton has more than 16 atlas pages, or batched skeletons next to each other use more than 16 pages together. A skeleton in the mesh mode has more than 8 pages.',
        does: 'A batch samples up to 16 textures and a draw of the mesh mode up to 8. A slot on a page outside that group starts a new draw.',
        source: 'src/render/batch-layout.ts',
        check: '`counts.atlasPages` against 16 in the batched mode and 8 in the mesh mode.',
        fix: 'Pack the atlas into fewer pages, or share one atlas between the skeletons of a layer.',
    },
    {
        id: 'MARROW008',
        slug: 'batch-refused-by-device',
        title: 'The device samples fewer textures than the skeleton needs in a batch',
        severity: 'warn',
        cost: ['draw-calls'],
        detect: 'static',
        pattern: 'A skeleton that asked for the batched mode draws in the mesh mode, with the reason `limit`.',
        does: 'The renderer samples fewer textures in a batch than one group of pages of the skeleton has. The skeleton then draws with meshes of its own for good.',
        source: 'src/render/batch-body.ts',
        check: '`render.modeReason` is `limit`.',
        fix: 'Pack the atlas into fewer pages than the device samples in one batch.',
    },
    {
        id: 'MARROW009',
        slug: 'large-skeleton-many-instances',
        title: 'Many copies of a skeleton that is too large to batch',
        severity: 'warn',
        cost: ['draw-calls'],
        detect: 'static',
        pattern:
            "Four or more instances of one skeleton draw in the mesh mode, and none draws instanced. With `renderMode: 'auto'` that is a skeleton of more than 1024 batch vertices.",
        does: 'Each instance in the mesh mode has draw calls of its own. The CPU places its vertices unless `skinning` is `gpu`.',
        source: 'src/render/mode.ts',
        check: '`render.mode` is `mesh`, `render.instancing.active` is false, and `render.instancing.why` gives the reason.',
        fix: "Set `skinning: 'gpu'` and `instancing: 'auto'`, or use a skeleton with fewer vertices.",
    },
    {
        id: 'MARROW010',
        slug: 'clip-cpu-cut',
        title: 'A clipping attachment in the batched mode',
        severity: 'info',
        cost: ['cpu-vertex', 'upload'],
        detect: 'static',
        pattern: 'A skeleton in the batched mode applies a clipping attachment.',
        does: 'The CPU cuts the triangles of the clipped slots, as the official runtime does. It cuts them again when the clip polygon or a clipped slot moves.',
        source: 'src/render/batch-clip.ts',
        check: '`render.clips` is above 0 and `render.mode` is `batched`.',
        fix: 'Remove the clipping attachment in the Spine editor, or keep the clipped slots few and small.',
    },
    {
        id: 'MARROW011',
        slug: 'clip-mask-draws',
        title: 'A clipping attachment in the mesh mode',
        severity: 'warn',
        cost: ['draw-calls'],
        detect: 'static',
        pattern: 'A skeleton in the mesh mode applies a clipping attachment that cuts a visible slot.',
        does: 'The runtime draws a stencil mask twice for each such clip, and the clipped slots get draws of their own. The skeleton cannot draw instanced while that lasts.',
        source: 'src/render/clip-mask.ts',
        check: '`render.maskDraws` is above 0.',
        fix: "Remove the clipping attachment in the Spine editor, or set `renderMode: 'batched'` for a small skeleton.",
    },
    {
        id: 'MARROW012',
        slug: 'slot-attached-container',
        title: 'A container attached to a slot',
        severity: 'info',
        cost: ['draw-calls'],
        detect: 'static',
        pattern: 'The game attached a container to a slot with `hero.attach(slot, container)`.',
        does: 'The draw of the skeleton ends at that slot, and the container adds its own draws. The skeleton cannot draw instanced, and the runtime leaves out no covered slot across the container.',
        source: 'src/render/attach-work.ts',
        check: '`render.attached` is above 0.',
        fix: 'Use `hero.follow(bone, container)` where the container can draw above or below the whole skeleton.',
    },
    {
        id: 'MARROW013',
        slug: 'dark-tint-batch-switch',
        title: 'A skeleton without dark colors draws before one with dark colors',
        severity: 'info',
        cost: ['draw-calls'],
        detect: 'static',
        pattern:
            'In the draw order, a batched skeleton without dark colors comes directly before a batched skeleton with dark colors.',
        does: 'A skeleton with dark colors needs the batcher with 4 more bytes per vertex, which starts a new batch. A skeleton without dark colors that follows joins that batch.',
        source: 'src/render/batch-pipe.ts',
        check: '`render.darkTint` differs between two skeletons that follow each other.',
        fix: 'Draw a skeleton with dark colors first in the layer, or keep the two kinds in separate layers.',
    },
    {
        id: 'MARROW014',
        slug: 'render-group-rebuild-churn',
        title: 'Pixi builds the instructions of the render group again and again',
        severity: 'warn',
        cost: ['cpu-vertex', 'upload'],
        detect: 'dynamic',
        pattern:
            'The game adds, removes, shows, hides or sorts display objects in the render group of a batched skeleton many times a second.',
        does: 'Each build writes every batched skeleton of the render group again, and the batch uploads its buffers whole.',
        source: 'src/render/batch-element.ts',
        check: '`totals.instructionBuilds` grows from second to second.',
        fix: 'Keep display objects in a pool and move them off the screen. Give a layer that changes often a render group of its own.',
    },
    {
        id: 'MARROW015',
        slug: 'hidden-but-updating',
        title: 'A skeleton that nobody sees still updates',
        severity: 'warn',
        cost: ['cpu-pose', 'cpu-vertex'],
        detect: 'both',
        pattern:
            "A skeleton is off the screen with `offscreen: 'update'`, the default. Or the game calls `update()` itself on a skeleton that Pixi does not draw.",
        does: 'An update from the ticker skips a hidden skeleton, and an `update()` that the game calls always poses. A skeleton off the screen poses in every frame unless `offscreen` says otherwise.',
        source: 'src/api/pacing.ts',
        check: '`pacing.drawn` is false, or `pacing.onScreen` is false, while the upload counters of `totals` grow.',
        fix: "Set `perf: 'balanced'` or `offscreen: 'pause'`, or stop the `update()` calls for a hidden skeleton.",
    },
    {
        id: 'MARROW016',
        slug: 'cuts-disabled-antialias',
        title: 'The renderer turns the cuts of overdraw off',
        severity: 'info',
        cost: ['overdraw'],
        detect: 'static',
        pattern:
            'The renderer has `roundPixels`, or it draws to a multisampled target, as with `antialias: true`. The skeleton has outlines.',
        does: 'Both move edges inside a pixel, so a cut would show. The runtime turns occlusion and `tightMesh` off for that instance for good.',
        source: 'src/render/gate.ts',
        check: '`cuts.blockedBy` holds `roundPixels` or `multisample`.',
        fix: 'Turn `roundPixels` and `antialias` off, or accept the overdraw.',
    },
    {
        id: 'MARROW017',
        slug: 'filter-or-mask-ancestor',
        title: 'A filter or a mask above the skeleton',
        severity: 'warn',
        cost: ['draw-calls', 'memory'],
        detect: 'static',
        pattern: 'The skeleton or a container above it has a filter or a mask.',
        does: 'Pixi ends the batch before and after that container, and a filter draws to a texture of its own. The idle cache drops its image while that holds.',
        source: 'src/api/idle-gate.ts',
        check: 'The tree shows `filters` or `mask` on the path from the skeleton to the root.',
        fix: 'Put the filter or the mask on the smallest container that needs it, and remove it when its effect ends.',
    },
    {
        id: 'MARROW018',
        slug: 'cache-as-texture-with-playing',
        title: 'A playing skeleton below a container with `cacheAsTexture`',
        severity: 'warn',
        cost: ['cpu-pose', 'upload'],
        detect: 'static',
        pattern: 'A container above the skeleton has `cacheAsTexture`.',
        does: 'Pixi draws the cached image until the game calls `updateCacheTexture()`. The skeleton poses and the picture stands still, and each such call draws the whole container again.',
        source: 'pixi.js: scene/container/RenderGroupSystem',
        check: 'The tree shows `cacheAsTexture` on the path from the skeleton to the root.',
        fix: "Cache only containers whose skeletons are at rest. For one skeleton at rest, use `idleCache: 'auto'`.",
    },
    {
        id: 'MARROW019',
        slug: 'idle-cache-thrash',
        title: 'The idle cache draws and drops its image again and again',
        severity: 'warn',
        cost: ['draw-calls', 'upload'],
        detect: 'dynamic',
        pattern:
            "A skeleton with `idleCache: 'auto'` rests for about half a second, moves, and rests again, many times.",
        does: 'Each image costs one draw into a texture and two builds of the instructions of the render group. A change of the pose or of the place drops the image.',
        source: 'src/api/idle-image.ts',
        check: '`idle.showing` changes between samples, and `totals.instructionBuilds` grows.',
        fix: "Set `idleCache: 'off'` for a skeleton that does not rest for seconds.",
    },
    {
        id: 'MARROW020',
        slug: 'no-outlines',
        title: 'The asset has no outlines',
        severity: 'info',
        cost: ['overdraw'],
        detect: 'static',
        pattern: 'The game loaded the asset without outlines, or the scan could read no page image.',
        does: 'Without outlines the runtime cannot leave out a covered slot or a region without a visible pixel. `tightMesh` and `occlusion` then do nothing.',
        source: 'src/api/no-effect.ts',
        check: '`cuts.outlines` is `off` or `unread`.',
        fix: 'Run `pixi-marrow outlines <atlas>` at build time and pass the file as the `outlines` option of the load.',
    },
    {
        id: 'MARROW021',
        slug: 'page-texture-blocks-cuts',
        title: 'A page texture blocks the cuts of overdraw',
        severity: 'info',
        cost: ['overdraw'],
        detect: 'static',
        pattern:
            'A page texture has mipmaps, anisotropic filtering, repeat, another pixel size than the atlas states, or a premultiplied image for a straight page.',
        does: 'Such a texture mixes pixels that the outlines do not know. The regions of that page keep their quads, and none of them hides a slot.',
        source: 'src/render/page-block.ts',
        check: '`cuts.pageBlocks` names the page and the reason.',
        fix: 'Load the page textures at the size of the atlas, with no mipmaps, no anisotropy and no repeat.',
    },
    {
        id: 'MARROW022',
        slug: 'physics-active',
        title: 'Physics constraints run in every update',
        severity: 'info',
        cost: ['cpu-pose', 'cpu-vertex'],
        detect: 'static',
        pattern: 'The skeleton has physics constraints, and its physics mode is `update`.',
        does: 'The runtime simulates each constraint until a step changes no bit of its state. Wind, gravity or a bone that moves keeps the skeleton from rest.',
        source: 'src/pose/legacy/physics-rest.ts',
        check: '`physics.constraints` is above 0 and `physics.mode` is `update`.',
        fix: "Set `hero.physics = 'none'` for small or far skeletons, or set `lod: 'auto'`.",
    },
    {
        id: 'MARROW023',
        slug: 'skin-churn',
        title: 'The runtime builds the vertex layout again and again',
        severity: 'warn',
        cost: ['cpu-vertex', 'upload', 'memory'],
        detect: 'dynamic',
        pattern: 'The game sets another skin many times a second, or a page texture changes as often.',
        does: 'The runtime lays the vertex ranges out again for a new skin, for new outlines and for a page texture that changed. It then writes every vertex again.',
        source: 'src/render/skeleton-view.ts',
        check: '`totals.templateBuilds` grows from second to second.',
        fix: 'Set the skins once. To change one attachment, use `hero.slot(name).attachment`.',
    },
    {
        id: 'MARROW024',
        slug: 'webgpu-uniform-overflow',
        title: 'More mesh draws on WebGPU than the shared uniform buffer of Pixi holds',
        severity: 'info',
        cost: ['memory', 'upload'],
        detect: 'static',
        pattern: 'On WebGPU, the skeletons in the mesh mode take more than about 1800 draws in a frame.',
        does: 'Pixi keeps the uniforms of about 2000 draws in one buffer. Past that, each mesh of the runtime binds a small uniform buffer of its own.',
        source: 'src/render/mesh-uniforms.ts',
        check: 'The sum of `render.drawCalls` over the skeletons in the mesh mode.',
        fix: "Use the batched mode for small skeletons, or `skinning: 'gpu'` with `instancing: 'auto'` for large ones.",
    },
    {
        id: 'MARROW025',
        slug: 'mix-chain-growth',
        title: 'A Spine 4.3 track changes its animation faster than the mix',
        severity: 'warn',
        cost: ['cpu-pose'],
        detect: 'dynamic',
        pattern:
            'A skeleton of Spine 4.3 starts a new animation on a track before the mix into the one before it ends, again and again.',
        does: 'The 4.3 engine keeps every entry of such a chain, as the official 4.3 runtime does, and applies all of them in each update. The chain ends when one mix runs to its end.',
        source: 'src/pose/v43/player.ts',
        check: 'The `start` events of the skeleton outnumber its `end` events from frame to frame.',
        fix: 'Let a mix end before the next change, or change with `mix: 0`.',
    },
].map((rule) => ({ ...rule, since: SINCE, docs: `${DOCS}#${rule.id.toLowerCase()}` }));

/**
 * The rules that left the catalogue. Their ids stay reserved, so no later rule takes one. The
 * docs page keeps a heading for each, so that an old link still lands. They are not in the rule
 * data, in perf-rules.json or in the guide for coding agents.
 */
export const RETIRED = [
    {
        id: 'MARROW026',
        title: 'Uploads are larger on pixi.js before 8.23 with WebGL',
        reason: 'The floor is pixi.js 8.23, so no game can run the older versions.',
    },
];

const root = fileURLToPath(new URL('..', import.meta.url));
const NOTE = 'Generated by scripts/perf-rules.mjs. Do not edit: change the catalogue in that file and run pnpm rules.';
const DETECT = { static: 'one look', dynamic: 'two looks', both: 'one look or two' };

/** Text as Biome formats it for a file of that path, so that the linter finds nothing to change. */
function formatted(path, text) {
    return execFileSync(join(root, 'node_modules/.bin/biome'), ['format', `--stdin-file-path=${path}`], {
        cwd: root,
        input: text,
        encoding: 'utf8',
    });
}

function rulesModule() {
    return `// ${NOTE}
import type { PerfRule } from './types';

/** The address of the docs page of the rules. The anchor of a rule is its id in lower case. */
export const DOCS = ${JSON.stringify(DOCS)};

/**
 * The catalogue of the performance rules, in the order of their ids. \`diagnose\` reports hits of
 * these rules, and \`perf-rules.json\` of the package holds the same data.
 *
 * @example
 * const rule = RULES.find((entry) => entry.id === 'MARROW004');
 * console.log(rule?.fix, rule?.docs);
 */
export const RULES: readonly PerfRule[] = ${JSON.stringify(RULES, null, 4)};
`;
}

function rulesJson() {
    const catalogue = { kind: 'pixi-marrow/perf-rules', version: 1, docs: DOCS, costs: COSTS, rules: RULES };

    return `${JSON.stringify(catalogue, null, 2)}\n`;
}

/** One row of a Markdown table. A pipe inside a cell would end the cell. */
const row = (...cells) => `| ${cells.map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`;
const costWords = (rule) => rule.cost.map((cost) => COSTS[cost]).join(', ');

function ruleSection(rule) {
    return [
        `## ${rule.id}`,
        '',
        `**${rule.title}.** Its short name is \`${rule.slug}\`, and its level is \`${rule.severity}\`.`,
        '',
        row('What', 'Details'),
        row('---', '---'),
        row('Cost', costWords(rule)),
        row('Found by', DETECT[rule.detect]),
        row('Pattern', rule.pattern),
        row('Runtime', rule.does),
        row('Source', `\`${rule.source}\``),
        row('Check', rule.check),
        row('Fix', rule.fix),
        '',
    ].join('\n');
}

/** The end of the docs page: one heading per retired rule, so that its anchor stays. */
function retiredSection() {
    const rules = RETIRED.map(({ id, title, reason }) =>
        [`### ${id}`, '', `**${title}.** Retired. ${reason}`, ''].join('\n'),
    );

    return [
        '## Retired rules',
        '',
        'A retired rule can no longer hit. Its id stays reserved, and no later rule takes it.',
        '',
        ...rules,
    ].join('\n');
}

function docsPage() {
    return `---
layout: ../../layouts/Docs.astro
title: Performance rules
description: Each cause of cost that pixi-marrow can name in a scene, with a stable id, the pattern, what the runtime does and the fix.
---

{/* ${NOTE} */}

A rule names one cause of cost in a scene. Each rule has a stable id, from \`MARROW001\` on. A warning, a row of \`perf.report()\` and a hit of \`diagnose\` each carry the id and a link to its heading on this page.

The same list is in the package as \`perf-rules.json\`, and on this site at [/perf-rules.json](/perf-rules.json).

## Find the rules that hit

Add one line to the development build of the game. It puts the hook \`__PIXI_MARROW__\` on \`globalThis\`. The package registers nothing until that call.

\`\`\`ts
import { installDevtools } from 'pixi-marrow/diagnose';

installDevtools({ root: app.stage, renderer: app.renderer });
\`\`\`

Then ask the hook in the console of the browser. A coding agent that can run code in the page calls the same functions.

\`\`\`ts
__PIXI_MARROW__.diagnose().hits; // the causes that one look finds
const watching = __PIXI_MARROW__.watch(); // note the counters now
watching.report().hits; // some frames later: also the causes that show over time
__PIXI_MARROW__.inspect(); // each skeleton as plain data
JSON.stringify(__PIXI_MARROW__.tree()); // the tree, to diagnose somewhere else
\`\`\`

A hit is a plain object. \`id\` is the rule and \`node\` is the path of the skeleton, such as \`stage/reels[2]/MarrowSpine\`. \`cause\` is the path of the display object that causes the hit. \`measured\` holds the numbers, \`fix\` says what to change, and \`docs\` links here.

Without a browser, save the tree as a file and run the command line tool. It runs the rules that one look finds.

\`\`\`bash
pixi-marrow diagnose tree.json
pixi-marrow rules --json
\`\`\`

\`installDevtools({ warn: true })\` also prints each hit once per rule and skeleton. Pass \`ticker: app.ticker\` and the hook looks again every 120 ticks.

## Costs

${row('Cost', 'What grows')}
${row('---', '---')}
${row('draw calls', 'The commands from the CPU to the GPU in a frame.')}
${row('CPU time for vertices', 'The work to place vertices and to write their colors.')}
${row('CPU time for the pose', 'The work of the animations and the constraints.')}
${row('bytes sent to the GPU', 'The vertex and index data that a frame uploads.')}
${row('pixels drawn more than once', 'The work of the GPU for pixels that a later slot hides.')}
${row('memory', 'Typed arrays, GPU buffers and textures.')}

## All rules

"Found by" says how many looks at the scene a tool needs. One look reads the tree. Two looks compare the counters of a skeleton between two moments.

${row('Id', 'Cause', 'Level', 'Found by')}
${row('---', '---', '---', '---')}
${RULES.map((rule) => row(`[${rule.id}](#${rule.id.toLowerCase()})`, rule.title, `\`${rule.severity}\``, DETECT[rule.detect])).join('\n')}

${RULES.map(ruleSection).join('\n')}
${retiredSection()}`;
}

/** The rule table of the guide for coding agents. */
function agentTable() {
    return [
        row('Id', 'Cause', 'Fix'),
        row('---', '---', '---'),
        ...RULES.map((rule) => row(`[${rule.id}](${rule.docs})`, rule.title, rule.fix)),
    ].join('\n');
}

/** A file with the text between its two rule markers replaced. Throws when the markers are not there. */
function withBlock(path, content) {
    const open = '<!-- rules:table -->';
    const close = '<!-- /rules:table -->';
    const before = readFileSync(join(root, path), 'utf8');
    const start = before.indexOf(open);
    const end = before.indexOf(close);

    if (start === -1 || end < start) throw new Error(`${path} needs both ${open} and ${close}`);

    return `${before.slice(0, start)}${open}\n${content}\n${before.slice(end)}`;
}

/** Writes or checks every file that repeats the catalogue. */
function main() {
    const check = process.argv.includes('--check');
    const modulePath = 'packages/pixi-marrow/src/diagnose/rules-data.ts';
    const agentPath = 'packages/pixi-marrow/agent/AGENTS.md';
    const json = formatted('packages/pixi-marrow/perf-rules.json', rulesJson());
    const targets = {
        [modulePath]: formatted(modulePath, rulesModule()),
        'packages/pixi-marrow/perf-rules.json': json,
        'apps/site/public/perf-rules.json': json,
        'apps/site/src/pages/performance/rules.mdx': docsPage(),
        [agentPath]: withBlock(agentPath, agentTable()),
    };
    const errors = [];

    const retired = new Set(RETIRED.map(({ id }) => id));
    let number = 0;

    for (const { id } of RULES) {
        let wanted = '';

        // a retired id is never used again: the count steps over it
        do wanted = `MARROW${String(++number).padStart(3, '0')}`;
        while (retired.has(wanted));
        if (id !== wanted) errors.push(`${id} is out of order: the ids count up from MARROW001, past the retired ones`);
    }
    for (const [path, text] of Object.entries(targets)) {
        const file = join(root, path);

        if (existsSync(file) && readFileSync(file, 'utf8') === text) continue;
        if (check) errors.push(`${path} is stale. Run: pnpm rules`);
        else {
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, text);
        }
    }
    for (const error of errors) console.error(`perf-rules: ${error}`);
    if (errors.length) process.exit(1);
    console.log(
        `perf-rules: ${RULES.length} rules, ${RETIRED.length} retired, ${Object.keys(targets).length} files ${check ? 'are current' : 'written'}`,
    );
}

// the path of the command line can pass through a link, and the URL of a module never does
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
