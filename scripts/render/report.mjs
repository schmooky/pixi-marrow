/**
 * Prints what the page of the render check found and saves the images of a case.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
    createModeSummary,
    describeBaked,
    describeMode,
    describeSceneBuilds,
    describeSceneDraws,
    describeSceneMode,
    describeSceneRows,
} from './report-modes.mjs';
import { describeChunk, describeIdle, describeLazy } from './report-sleep.mjs';

/** Failing frames per comparison that get a line of their own, unless every frame is listed. */
const LINES_PER_LABEL = 3;
const SUMMARY_NAMES = {
    exact: 'official twice',
    match: 'ours against official',
    // the frames of `match` that ours draws through a clip mask, once more on their own
    clipped: 'of those, clipped',
    // the frames of `match` of the rigs with physics constraints or sliders, once more on their own
    solved: 'physics or slider rigs',
    formats: 'json and binary',
    pma: 'premultiplied atlas',
    cuts: 'cuts on and off',
    polygons: 'polygons and quads',
    polygonsOfficial: 'polygons and official',
    // the batched mode has lines of its own, so the lines above stay what they were
    matchBatched: 'batched against official',
    clippedBatched: 'of those, clipped',
    solvedBatched: 'physics or slider rigs',
    modes: 'batched and mesh',
    pmaBatched: 'batched, premultiplied',
    cutsBatched: 'batched, cuts on and off',
    polygonsBatched: 'batched, polygons',
    auto: 'auto and its mode',
    matchBaked: 'baked against official',
    matchBakedBatched: 'baked batched, official',
    // scenes: several instances in one stage
    sceneTwice: 'scenes, official twice',
    sceneMesh: 'scenes, mesh',
    sceneBatched: 'scenes, batched',
    sceneModes: 'scenes, batched and mesh',
    sceneOwn: 'scenes, batched to mesh',
    sceneAuto: 'scenes, default options',
    sceneIdleOfficial: 'scenes, idle and official',
    sceneIdle: 'scenes, idle and live',
    // a page on another pixi.js: the official runtime there against the reference
    pixi: 'official, this pixi.js',
    scenePixi: 'scenes, official here',
};
/** The lines that follow the line of a comparison: its clipped frames and its frames of rigs with physics. */
const PARTS = { match: ['clipped', 'solved'], matchBatched: ['clippedBatched', 'solvedBatched'] };
/**
 * The order of the summary. The lines of the mesh mode come first, in the order their comparisons
 * first ran. Then the batched mode, then the scenes, each in the order of this list. The proofs
 * come last.
 */
const LATER_LINES = [
    'matchBatched',
    'modes',
    'pmaBatched',
    'cutsBatched',
    'polygonsBatched',
    'auto',
    'matchBaked',
    'matchBakedBatched',
    'sceneTwice',
    'sceneMesh',
    'sceneBatched',
    'sceneModes',
    'sceneOwn',
    'sceneAuto',
    'sceneIdleOfficial',
    'sceneIdle',
];
/** The kinds that compare ours with polygons to a picture of quads. */
const POLYGON_KINDS = ['polygons', 'polygonsOfficial'];
/** The kinds that measure and do not judge, unless a rule was switched on for them. Their line says `info`. */
const INFO_KINDS = ['mode', 'modes', 'sceneMode', 'sceneRows', 'sceneDraws', 'sceneBuilds', 'baked'];

const percent = (share) => `${(100 * share).toFixed(3)}%`;
const slug = (text) => String(text).replace(/[^A-Za-z0-9.]+/g, '-');
const range = (pair) => (pair ? (pair[0] === pair[1] ? `${pair[0]}` : `${pair[0]} to ${pair[1]}`) : 'none');
const minMax = (values) => [Math.min(...values), Math.max(...values)];
const place = (entry) => {
    const at = entry.animation ? `${entry.animation}${entry.skin ? ` (${entry.skin})` : ''}` : '';

    return `${at}${entry.step === undefined ? '' : ` step ${entry.step} t=${entry.time}`}`;
};

/** True when the check holds the two render modes against a limit. `createReporter` sets it. */
let modesJudged = false;

/** The numbers of one comparison on one background. */
function numbers(metrics) {
    const { max, channelMax, over1, over8, covered, box, worst, displaced } = metrics;
    const of = Math.max(covered, 1);
    const parts = [
        `max ${max} (${channelMax.join(',')})`,
        `over 1: ${percent(over1 / of)}`,
        `over 8: ${percent(over8 / of)}`,
        `${covered} px covered`,
    ];

    if (displaced !== undefined) parts.push(`not explained by a displacement: ${percent(displaced)}`);
    if (box) parts.push(`over 8 inside ${box[0]},${box[1]} to ${box[2]},${box[3]}`);
    if (worst && max > 0)
        parts.push(`worst at ${worst.x},${worst.y}: ${worst.a.join(',')} against ${worst.b.join(',')}`);

    return parts.join(', ');
}

/** The numbers of a frame over both backgrounds: the larger one of each. */
function frameNumbers(entry) {
    const of = (metrics) => Math.max(metrics.covered, 1);
    const both = [entry.clear, entry.solid];

    return {
        max: Math.max(...both.map((m) => m.max)),
        differ: Math.max(...both.map((m) => (m.differ ?? 0) / of(m))),
        over1: Math.max(...both.map((m) => m.over1 / of(m))),
        over8: Math.max(...both.map((m) => m.over8 / of(m))),
        displaced: Math.max(...both.map((m) => m.displaced ?? 0)),
    };
}

/** What a comparison measured over its frames: the worst frame, or the weakest one for a proof. */
function groupNumbers(frames, proof) {
    const pick = proof ? Math.min : Math.max;
    const all = frames.map(frameNumbers);
    const out = {};

    for (const key of ['max', 'differ', 'over1', 'over8', 'displaced']) out[key] = pick(...all.map((n) => n[key]));

    return out;
}

/** What the buffer check saw, over the animations it played. */
function describeBuffers(entries) {
    const played = entries.filter((entry) => entry.info);
    const list = (some) => some.map((entry) => `${entry.animation} ${entry.info.rewrites}`).join(', ');
    const counted = played.filter((entry) => !entry.info.noStats);
    const kept = counted.filter((entry) => entry.info.keys.length === 0);
    const free = counted.filter((entry) => entry.info.keys.length > 0);
    const built = played.filter((entry) => typeof entry.info.instructionBuilds === 'number');
    const parts = [];

    if (played.length === 0) return `skipped: ${entries[0].skipped}`;
    parts.push(`${played[0].info.frames} frames each`);
    if (counted.length > 0) {
        const builds = range(minMax(counted.map((entry) => entry.info.templateBuilds)));

        // setting a skin builds the vertex ranges a second time, before the animation plays
        parts.push(`Template builds stay at ${builds}${played[0].skin ? ' after the skin was set' : ''}`);
    } else parts.push('The display object has no counters for its buffers in this mode');
    if (kept.length) parts.push(`Index rewrites that must be 0: ${list(kept)}`);
    if (free.length) parts.push(`Index rewrites where slots can come and go: ${list(free)}`);
    if (built.length) {
        const builds = built.map((entry) => `${entry.animation} ${entry.info.instructionBuilds}`).join(', ');

        parts.push(`Instruction builds by Pixi: ${builds}`);
    } else parts.push('Instruction builds by Pixi were not counted');

    return parts.join('. ');
}

const megapixels = (area) => `${(area / 1e6).toFixed(3)} Mpx`;

/** One way to cut overdraw against no cuts: the triangle area, the vertices and the indices. */
function against(name, side, off) {
    const share = off.area > 0 ? side.area / off.area : 1;

    return (
        `${name}: triangle area ${megapixels(side.area)} against ${megapixels(off.area)}, ${(100 * share).toFixed(1)}%, ` +
        `vertices ${side.vertices} against ${off.vertices}, indices ${side.indices} against ${off.indices}`
    );
}

/** What the cuts of overdraw saved over the captured frames of a rig. */
function describeOverdraw(info) {
    const { on, off, polygons, frames, outlines } = info;
    const parts = [
        `${frames} frames`,
        against('Default cuts', on, off),
        `Covered slots: ${info.covered}, at most ${info.coveredMost} in a frame. Regions without a pixel: at most ${info.hollowMost}`,
        against('With polygons', polygons, off),
        `Polygons: at most ${info.tightMost} in a frame`,
    ];

    if (outlines) {
        parts.push(
            `Outlines: ${outlines.polygons} polygons and ${outlines.opaque} opaque rectangles in ${outlines.regions} regions, ` +
                `${outlines.unread} regions not read, ${outlines.pages} pages scanned ${outlines.scanMs.toFixed(0)} ms after the load`,
        );
    } else parts.push('The asset has no outlines');

    return parts.join('. ');
}

/** The frame of some frames with the largest value of one of its numbers, as text. */
function worstFrame(frames, key) {
    const [frame] = [...frames].sort((a, b) => frameNumbers(b)[key] - frameNumbers(a)[key]);
    const n = frameNumbers(frame);

    return `${place(frame)} with max ${n.max}, over 1: ${percent(n.over1)}, over 8: ${percent(n.over8)}`;
}

/** What polygons change against a picture of quads, over the frames of a rig. */
function describePolygons(frames) {
    const n = groupNumbers(frames, false);

    return (
        `${frames.length} frames, ${worst(frames)}, pixels that differ at all: ${percent(n.differ)}. ` +
        `Most pixels over 1 in ${worstFrame(frames, 'over1')}. Most pixels over 8 in ${worstFrame(frames, 'over8')}`
    );
}

/** One frame that passed at the second placement only, with the numbers of both placements. */
function describeTie(entry) {
    const side = (n) => `max ${n.max}, ${n.differ} px differ, ${n.over1} px by more than 1`;

    return `tie  ${place(entry)}: ${side(entry.tie.first)}. At the second placement: ${side(entry.tie.second)}`;
}

/** The largest differences of some frames, as text. */
function worst(frames, proof = false) {
    const n = groupNumbers(frames, proof);

    return `max ${n.max}, over 1: ${percent(n.over1)}, over 8: ${percent(n.over8)}`;
}

/** The text after the label of a comparison. `frames` are its frames with pictures. */
function describe(entries, frames) {
    const [first] = entries;
    const { kind, info } = first;

    if (kind === 'draws') {
        const masks = info.masks?.[1] > 0 ? `, of which clip masks ${range(info.masks)}` : '';
        const batched = info.batched ? `, batched ${range(info.batched)}` : '';

        return `ours ${range(info.ours)}${masks}${batched}, official ${range(info.official)}`;
    }
    if (kind === 'mode') return describeMode(info);
    if (kind === 'baked') return describeBaked(info);
    if (kind === 'sceneMode') return describeSceneMode(info);
    if (kind === 'sceneRows') return describeSceneRows(info);
    if (kind === 'sceneDraws') return describeSceneDraws(info);
    if (kind === 'sceneBuilds') return describeSceneBuilds(info);
    if (kind === 'lazy') return describeLazy(info);
    if (kind === 'idleCache') return describeIdle(info);
    if (kind === 'chunk') return first.finding ?? describeChunk(info);
    if (kind === 'steady') return describeBuffers(entries);
    if (kind === 'overdraw') return describeOverdraw(info);
    if (kind === 'reading') {
        return `a red under alpha 0: the 2D canvas returns ${info.canvas?.join(',')}, the scan keeps the ${info.outline}, ${info.lit} px lit, cuts on and off differ by ${info.max}`;
    }
    if (kind === 'multisampled') {
        const side = (name, it) =>
            it
                ? `${name} max ${it.max}, polygons ${it.tightBefore} before the draw and ${it.tightAfter} after, ${it.builds} new layout`
                : '';

        return `against no cuts: ${side('default cuts', info.default)}. ${side('With polygons', info.polygons)}`;
    }
    if (kind === 'visible') {
        return `${entries.length} animations, each draws ${Math.min(...entries.map((e) => e.info.covered))} px or more`;
    }
    if (frames.length === 0) return '';
    if (POLYGON_KINDS.includes(kind)) return describePolygons(frames);
    const n = groupNumbers(frames, kind === 'proof');
    const direct = worst(frames, kind === 'proof');
    const alpha = Math.max(...frames.map((entry) => entry.alphaMax ?? 0));
    const clipped = frames.filter((entry) => entry.clipped);
    let text = `${frames.length} frames, `;

    if (kind === 'proof') text += `weakest ${direct}`;
    else if (kind === 'formats') text += `not explained by a displacement: ${percent(n.displaced)} (${direct})`;
    else if (kind === 'cuts') text += `max ${n.max}, pixels that differ at all: ${percent(n.differ)}`;
    else if (kind === 'modes')
        text += `${direct}, pixels that differ at all: ${percent(n.differ)}${modesJudged ? '' : '. Measured, not judged'}`;
    else text += direct;
    if (kind === 'proof' && frames[0].solid.displaced !== undefined)
        text += `, not explained by a displacement: ${percent(n.displaced)}`;
    if (alpha) text += `. Alpha on a transparent target differs by up to ${alpha}: additive slots add none in ours`;
    if (clipped.length) text += `. Clipped: ${clipped.length} frames, ${worst(clipped)}`;
    const fell = frames.filter((entry) => entry.drew === 'mesh');

    // a frame the batched mode drew with meshes is the mesh picture: it says nothing about batching
    if (fell.length) text += `. The batched side drew ${fell.length} of these frames with meshes`;
    const ties = frames.filter((entry) => entry.tie);
    const seconds = frames.filter((entry) => entry.second);

    if (ties.length) text += `. Ties: ${ties.length} frames passed at the second placement only`;
    if (seconds.length)
        text += `. At the second placement: weakest max ${Math.min(...seconds.map((e) => e.second.max))}`;

    return text;
}

/**
 * A reporter for one renderer.
 *
 * @param options.root The repo root, for the image paths it prints.
 * @param options.dir Where the images of this renderer go.
 * @param options.verbose True lists every frame, not only the failing ones.
 * @param options.modesJudged True when the check holds the two render modes against a limit.
 */
export function createReporter({ root, dir, verbose, modesJudged: judged = false }) {
    modesJudged = judged;
    const totals = new Map();
    // what the scenes that look for a limit found: such a failure is a finding and fails nothing
    const findings = [];
    // which mode auto picked per rig, and the instruction builds while animations played
    const modes = createModeSummary();
    // the triangle area of every rig added up, with the cuts of overdraw and without
    const overdraw = { rigs: 0, on: 0, off: 0, polygons: 0, covered: 0 };
    const total = (key) => {
        if (!totals.has(key)) totals.set(key, { frames: 0, failed: 0, numbers: [] });

        return totals.get(key);
    };

    function saveShots(rig, entry) {
        const name = [
            entry.reasons.length ? 'fail' : entry.tie ? 'tie' : 'pass',
            slug(rig.id),
            // a frame of a scene has no animation of its own
            ...(entry.animation ? [slug(entry.animation)] : []),
            ...(entry.skin ? [slug(entry.skin)] : []),
            `step${entry.step}`,
            slug(entry.label),
            entry.shots.background,
        ].join('__');
        // the first picture is ours wherever ours is in the comparison
        const [a, b] = entry.kind === 'match' ? ['ours', 'official'] : ['first', 'second'];

        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${name}__${a}.png`), Buffer.from(entry.shots.a, 'base64'));
        writeFileSync(join(dir, `${name}__${b}.png`), Buffer.from(entry.shots.b, 'base64'));
        writeFileSync(join(dir, `${name}__diff.png`), Buffer.from(entry.shots.diff, 'base64'));

        return `${relative(root, join(dir, name))}__{${a},${b},diff}.png`;
    }

    return {
        /**
         * Prints the cases of one rig or scene, grouped by comparison. Returns the number of
         * failures. A scene with `limit` looks for a limit: its failures print as `FOUND`, count
         * as findings and stay out of the lines of the summary.
         */
        rig(rig, report) {
            const groups = new Map();
            const limit = rig.limit === true;
            let failed = 0;
            // what the official runtime draws on another pixi.js is a finding about it, and fails nothing
            let official = 0;

            modes.add(rig, report.cases);
            for (const entry of report.cases) {
                if (!groups.has(entry.label)) groups.set(entry.label, []);
                groups.get(entry.label).push(entry);
            }
            for (const [label, entries] of groups) {
                const bad = entries.filter((entry) => entry.reasons.length);
                const frames = entries.filter((entry) => entry.solid);
                const clipped = frames.filter((entry) => entry.clipped);
                const { kind, info, group } = entries[0];
                // the line of the summary: a proof has one per label, the batched mode has its own
                const line = group ?? (kind === 'proof' ? label : kind);
                const [clippedLine, solvedLine] = PARTS[line] ?? [];

                if (kind === 'overdraw') {
                    overdraw.rigs++;
                    overdraw.on += info.on.area;
                    overdraw.off += info.off.area;
                    overdraw.polygons += info.polygons.area;
                    overdraw.covered += info.covered;
                }
                // the clipped frames count in their comparison, and once more in a line of their own.
                // So do the frames of a rig with physics or a slider against the official runtime
                for (const [key, list] of [
                    [line, frames],
                    [clippedLine, clipped],
                    [solvedLine, rig.physics || rig.slider ? frames : []],
                ]) {
                    if (list.length === 0 || !key || limit) continue;
                    const sum = total(key);

                    sum.frames += list.length;
                    sum.failed += list.filter((entry) => entry.reasons.length).length;
                    sum.ties = (sum.ties ?? 0) + list.filter((entry) => entry.tie).length;
                    sum.fell = (sum.fell ?? 0) + list.filter((entry) => entry.drew === 'mesh').length;
                    sum.proof = kind === 'proof';
                    sum.kind = kind;
                    sum.numbers.push(groupNumbers(list, sum.proof));
                }
                // a case can hold a finding: something worth a line that fails nothing
                const found = entries.find((entry) => entry.finding);
                const state = bad.length
                    ? limit || kind === 'pixi'
                        ? 'FOUND'
                        : 'FAIL'
                    : found
                      ? 'FOUND'
                      : INFO_KINDS.includes(kind)
                        ? 'info'
                        : 'ok  ';

                if (found) findings.push(`${rig.id}: ${found.finding.split(':')[0]}`);

                // a runtime that reports no render mode says so once, in the summary
                if (kind === 'mode' && !info.known && bad.length === 0) continue;
                console.log(`    ${state} ${label.padEnd(30)} ${describe(entries, frames)}`);
                if (kind === 'pixi') official += bad.length;
                else failed += bad.length;
                for (const [index, entry] of (verbose ? entries : bad).entries()) {
                    if (!verbose && index === LINES_PER_LABEL) {
                        console.log(`         and ${bad.length - index} more failing frames (--verbose lists them)`);
                        break;
                    }
                    const why = entry.reasons.length ? `: ${entry.reasons.join('. ')}` : '';

                    if (place(entry) || why) console.log(`         ${place(entry)}${why}`);
                    if (entry.solid) {
                        console.log(`           clear: ${numbers(entry.clear)}`);
                        console.log(`           solid: ${numbers(entry.solid)}`);
                    }
                }
                // a frame that passed at the second placement only is listed with both measurements
                for (const entry of entries) {
                    if (entry.tie) console.log(`         ${describeTie(entry)}`);
                }
                for (const entry of entries) {
                    const images = entry.shots ? saveShots(rig, entry) : null;

                    if (images && (entry.reasons.length || entry.tie || verbose))
                        console.log(`         images: ${images}`);
                }
            }
            for (const note of report.notes) console.log(`    note ${note}`);
            if (official > 0)
                findings.push(`${rig.id}: the official runtime differs from the reference in ${official} frames`);
            if (!limit) return failed;
            if (failed > 0) findings.push(`${rig.id}: ${failed}`);

            return 0;
        },

        /** What the scenes that look for a limit found so far: per scene its id and the number of findings. */
        findings,

        /**
         * Prints one line per comparison over every rig. The clipped frames and the frames of the
         * rigs with physics or sliders follow their comparison.
         */
        summary() {
            const parts = Object.values(PARTS).flat();
            const rank = (key) => (totals.get(key).proof ? LATER_LINES.length + 1 : LATER_LINES.indexOf(key) + 1);
            // a stable sort: lines of the same rank stay in the order they first appeared
            const keys = [...totals.keys()].filter((key) => !parts.includes(key)).sort((a, b) => rank(a) - rank(b));

            for (const [key, following] of Object.entries(PARTS)) {
                if (keys.includes(key)) {
                    keys.splice(keys.indexOf(key) + 1, 0, ...following.filter((part) => totals.has(part)));
                }
            }
            for (const key of keys) {
                const sum = totals.get(key);
                const pick = sum.proof ? Math.min : Math.max;
                const of = (name) => (sum.numbers.length ? pick(...sum.numbers.map((n) => n[name])) : 0);
                // a comparison that is measured and has no limit cannot fail
                const judged =
                    sum.kind === 'modes' && !modesJudged
                        ? 'not judged'
                        : sum.kind === 'pixi'
                          ? `${sum.failed} differ from the reference`
                          : `${sum.failed} failed`;
                let line = `  ${(SUMMARY_NAMES[key] ?? key).padEnd(24)} ${sum.frames} frames, ${judged}, `;

                line += `${sum.proof ? 'weakest' : 'worst'} max ${of('max')}, over 1: ${percent(of('over1'))}, over 8: ${percent(of('over8'))}`;
                if (key === 'formats') line += `, not explained by a displacement: ${percent(of('displaced'))}`;
                if (['cuts', 'modes', ...POLYGON_KINDS].includes(sum.kind))
                    line += `, pixels that differ at all: ${percent(of('differ'))}`;
                if (sum.ties) line += `, ${sum.ties} frames passed at the second placement only`;
                if (sum.fell) line += `, ${sum.fell} frames were drawn with meshes by the batched side`;
                console.log(line);
            }
            if (overdraw.rigs > 0 && overdraw.off > 0) {
                const share = (area) => `${megapixels(area)}, ${((100 * area) / overdraw.off).toFixed(1)}%`;

                console.log(
                    `  ${'overdraw'.padEnd(24)} ${overdraw.rigs} rigs, triangle area ${megapixels(overdraw.off)} without cuts, ` +
                        `${share(overdraw.on)} with the default cuts (${overdraw.covered} covered slots), ${share(overdraw.polygons)} with polygons`,
                );
            }
            for (const line of modes.lines()) console.log(line);
            if (findings.length > 0) console.log(`  ${'findings'.padEnd(24)} ${findings.join(', ')}`);
        },
    };
}
