import type { Container } from 'pixi.js';
import { readBake, readMemory } from '../api/perf-read';
import type { MarrowSpine } from '../api/spine';
import { MarrowError } from '../base/errors';
import { inspectView, type ViewReport } from '../render/inspect';
import type { SkeletonInspection } from './types';

/*
 * A skeleton as plain data. The code is in the entry `pixi-marrow/diagnose`, so the root import
 * pays for none of it: a display object hands out its view, and this module describes it.
 */

/** The label of the body that shows the image of the idle cache. */
const IDLE_LABEL = 'marrow-idle';
/** The first slot blend mode that needs a draw of its own: multiply, then screen. */
const MULTIPLY = 2;

/** What `inspect` reads of a display object. A `MarrowSpine` is one. */
type Inspected = Pick<MarrowSpine, 'label' | 'perf' | 'autoUpdate' | 'children' | 'parent'> & Container;

/**
 * Whether a display object shows something: it has a parent, and it and every container above
 * it are visible, renderable and have an alpha above 0. An update from the ticker poses a
 * skeleton only then. Pixi still collects an object with an alpha of 0 for its batch.
 *
 * @example
 * hero.visible = false;
 * console.log(isDrawn(hero)); // false
 */
export function isDrawn(node: Container): boolean {
    if (node.parent == null) return false;
    for (let at: Container | null | undefined = node; at != null; at = at.parent) {
        if (!at.visible || !at.renderable || at.alpha === 0) return false;
    }

    return true;
}

/** What stops the cuts of overdraw for a view at the moment. */
function blockedBy({ cuts, plain }: ViewReport): string[] {
    const blocks: string[] = [];

    if (cuts.hostile) blocks.push(cuts.bend ?? 'edge-bend');
    if (!plain) blocks.push('alpha-or-blend');
    if (cuts.outlines && cuts.code !== 'loaded') blocks.push('code');

    return blocks;
}

/** The settings of `perf` as plain values. A list of animations to bake becomes one string. */
function plainSettings(settings: object): Record<string, string | number> {
    const plain: Record<string, string | number> = {};

    for (const [key, value] of Object.entries(settings)) {
        if (typeof value === 'string' || typeof value === 'number') plain[key] = value;
        else if (Array.isArray(value)) plain[key] = value.join(', ');
    }

    return plain;
}

/**
 * Reads a `MarrowSpine` into plain data: what it is, how it draws, what it costs and what it
 * counted. Synchronous. The result survives `JSON.stringify`.
 *
 * Throws a `MarrowError` for an object that another copy of pixi-marrow made.
 *
 * @example
 * const { render, totals } = inspect(hero);
 * console.log(render.mode, render.drawCalls, totals.transformReplaces);
 *
 * @see https://pixi-marrow.schmooky.dev/performance/rules/
 */
export function inspect(hero: Inspected): SkeletonInspection {
    const parts = typeof hero.perf?.parts === 'function' ? hero.perf.parts() : undefined;

    if (parts === undefined) {
        throw new MarrowError('invalid-option', 'inspect got an object that this copy of pixi-marrow did not make.', {
            fix: 'Import inspect from the same copy of pixi-marrow that the game imports MarrowSpine from.',
        });
    }
    const { owner, view, links } = parts;
    const { asset, engine, stats, perfSettings } = owner;
    const { model, atlas, info } = asset;
    const report = inspectView(view);
    const memory = readMemory(owner, view);
    const bake = readBake(engine.source);
    const pacing = owner.pacingStatus?.();
    const batched = stats.renderMode === 'batched';
    const constraints: Record<string, number> = {};
    const { preset, given, ...settings } = perfSettings;

    for (const { type } of model.constraints) constraints[type] = (constraints[type] ?? 0) + 1;

    return {
        kind: 'pixi-marrow/skeleton',
        version: 1,
        label: hero.label,
        asset: { id: -1, spine: model.version, editorVersion: info.editorVersion, hash: model.hash, instances: 1 },
        counts: {
            bones: model.bones.count,
            slots: model.slots.count,
            visibleSlots: report.visible.length,
            vertices: stats.vertices,
            indices: stats.indices,
            atlasPages: atlas.pages.length,
            constraints,
        },
        render: {
            mode: stats.renderMode,
            option: report.mode.option,
            modeReason: report.mode.reason,
            batchVertices: report.mode.vertices,
            batchLimit: report.mode.limit,
            drawCalls: stats.drawCalls,
            sharedBy: report.mode.sharedBy,
            runs: batched ? report.mode.batches : stats.drawCalls - stats.maskDraws,
            blendSlots: report.visible.filter(({ slot }) => Number(model.slots.blendModes[slot]) >= MULTIPLY).length,
            skinning: report.mode.gpu ? 'gpu' : 'cpu',
            instancing: {
                active: report.instancing.why === null,
                why: report.instancing.why,
                run: report.instancing.run,
                draws: report.instancing.draws,
            },
            darkTint: model.slots.hasDark.includes(1),
            clips: stats.clips,
            maskDraws: stats.maskDraws,
            attached: links.filter((link) => link.slot >= 0).length,
            following: links.filter((link) => link.slot < 0).length,
        },
        cuts: {
            outlines: asset.outlinesState,
            occlusion: report.cuts.occlusion,
            tightMesh: report.cuts.tightMesh,
            blockedBy: blockedBy(report),
            pageBlocks: report.cuts.pages.flatMap((block, page) =>
                block === null ? [] : [`${atlas.pages[page]?.name}: ${block}`],
            ),
            coveredSlots: stats.coveredSlots,
            tightRanges: stats.tightRanges,
        },
        frame: {
            posed: !report.motion.skipped,
            skipped: report.motion.skipped,
            placedSlots: stats.placedSlots,
            coloredSlots: stats.coloredSlots,
            uploadBytes: stats.frameBytes,
        },
        totals: {
            skips: stats.skips,
            transformReplaces: stats.transformReplaces,
            tintRewrites: stats.tintRewrites,
            templateBuilds: stats.templateBuilds,
            indexRebuilds: stats.indexRebuilds,
            instructionBuilds: stats.instructionBuilds,
            positionUploads: stats.positionUploads,
            colorUploads: stats.colorUploads,
            uvUploads: stats.uvUploads,
            boneUploads: stats.boneUploads,
            maskUploads: stats.maskUploads,
            uploadBytes: { ...stats.uploadBytes },
        },
        pacing: {
            autoUpdate: hero.autoUpdate,
            rate: pacing?.rate ?? 'display',
            offscreen: pacing?.offscreen ?? perfSettings.offscreen,
            hidden: pacing?.hidden ?? false,
            size: pacing !== undefined && Number.isFinite(pacing.size) ? pacing.size : null,
            reduced: pacing?.reduced ?? false,
            drawn: isDrawn(hero),
            onScreen: null,
        },
        perf: { preset, given: [...given], settings: plainSettings(settings) },
        idle: {
            setting: perfSettings.idleCache,
            showing: hero.children.some((child) => child.label === IDLE_LABEL && child.visible),
        },
        bake: {
            setting: typeof perfSettings.bake === 'string' ? perfSettings.bake : perfSettings.bake.join(', '),
            active: bake !== null,
            baked: bake?.baked ?? 0,
            unbaked: bake?.unbaked ?? 0,
            last: bake?.last ?? '',
            bytes: bake?.bytes ?? 0,
        },
        physics: {
            constraints: constraints.physics ?? 0,
            mode: owner.physics,
        },
        memory: {
            shared: memory.shared,
            baked: memory.baked,
            instance: memory.instance,
            gpuBuffers: memory.gpuBuffers,
            gpuTextures: memory.gpuTextures,
        },
        rules: [],
    };
}
