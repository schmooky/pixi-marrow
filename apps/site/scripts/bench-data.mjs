#!/usr/bin/env node
/**
 * Writes `apps/site/public/benchmarks.json`, the numbers of the page `/benchmarks/`, from the
 * raw file of one run of `pnpm bench:ab`. The page reads that file while the site builds, and
 * links it for a reader who wants the numbers as data.
 *
 * The raw file holds every frame of every block. This step keeps what the page shows: per
 * renderer, scene, rig, instance count and side the median of each time over the runs, with the
 * fastest and the slowest run, the draw calls, the uploads and the heap of one instance.
 *
 * usage: pnpm bench:ab --scene=play,rest
 *        node apps/site/scripts/bench-data.mjs .bench/ab-<date>.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = process.argv[2];

if (source === undefined) {
    console.error('usage: node apps/site/scripts/bench-data.mjs <file of pnpm bench:ab>');
    process.exit(1);
}
const run = JSON.parse(readFileSync(source, 'utf8'));
const round = (value, digits = 3) => (value === undefined || value === null ? null : Number(value.toFixed(digits)));
/** A time of a side: the median over the runs, the fastest run and the slowest run, in ms. */
const time = (value) => (value ? [round(value.median), round(value.min), round(value.max)] : null);
const SIDES = { ours: 'pixi-marrow', official: 'spine-pixi-v8', mesh: 'pixi-marrow, mesh mode' };

/** What the page keeps of one side of a block. */
function sideOf(name, side) {
    return {
        side: SIDES[name],
        ...(side.ours?.renderMode ? { renderMode: side.ours.renderMode } : {}),
        updateMs: time(side.update),
        cpuMs: time(side.cpu),
        renderMs: time(side.render),
        frameMs: time(side.frame),
        framePerc95Ms: round(side.frameP95?.median),
        drawCalls: side.draws,
        uploadsPerFrame: round(side.uploads?.median, 1),
        uploadKBPerFrame: round((side.uploadBytes?.median ?? 0) / 1024, 1),
        heapKBPerInstance: side.heapPerInstance ? round(side.heapPerInstance.median / 1024, 1) : null,
    };
}

const data = {
    what: 'One run of pnpm bench:ab of pixi-marrow: pixi-marrow against the official runtime @esotericsoftware/spine-pixi-v8 in headless Chrome. Times are ms as [median, fastest run, slowest run].',
    date: run.date,
    command: `pnpm bench:ab ${run.command.replace(/^node scripts\/bench\/ab\.mjs\s*/, '')}`.trim(),
    build: run.build,
    machine: run.machine,
    versions: run.versions,
    settings: {
        scenes: run.settings.scenes,
        runs: run.settings.runs,
        frames: run.settings.frames,
        warmupFrames: run.settings.warmup,
        instances: run.settings.instances,
        canvas: run.settings.canvas,
        timeStep: '1/60 s',
        renderModeOfPixiMarrow: run.settings.renderMode,
    },
    renderers: run.renderers.map((entry) => ({
        renderer: entry.renderer,
        gpu: entry.gpu,
        pixi: entry.pixi,
        emptyFrameMs: round(entry.emptyFrame?.median),
        rigs: entry.rigs.map((rig) => ({
            rig: rig.id,
            scene: rig.scene,
            animation: rig.animation,
            bones: rig.counts.bones,
            slots: rig.counts.slots,
            meshVertices: rig.counts.meshVertices,
            features: rig.features,
            // the share of the time before the rig in which other programs kept the GPU busy
            gpuBusyBefore: round(rig.emptyFrame?.busy ?? 0, 2),
            blocks: (rig.summary ?? []).map((group) => ({
                instances: group.instances,
                sides: Object.keys(SIDES)
                    .filter((name) => group[name])
                    .map((name) => sideOf(name, group[name])),
            })),
        })),
    })),
};
const target = fileURLToPath(new URL('../public/benchmarks.json', import.meta.url));

writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
console.log(`bench-data: ${target}`);
