/**
 * Prints what the page of the render check found and saves the images of a case.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Failing frames per comparison that get a line of their own, unless every frame is listed. */
const LINES_PER_LABEL = 3;
const SUMMARY_NAMES = {
    exact: 'official twice',
    match: 'ours against official',
    formats: 'json and binary',
    pma: 'premultiplied atlas',
};

const percent = (share) => `${(100 * share).toFixed(3)}%`;
const slug = (text) => String(text).replace(/[^A-Za-z0-9.]+/g, '-');
const range = (pair) => (pair ? (pair[0] === pair[1] ? `${pair[0]}` : `${pair[0]} to ${pair[1]}`) : 'none');
const minMax = (values) => [Math.min(...values), Math.max(...values)];
const place = (entry) => {
    const at = entry.animation ? `${entry.animation}${entry.skin ? ` (${entry.skin})` : ''}` : '';

    return `${at}${entry.step === undefined ? '' : ` step ${entry.step} t=${entry.time}`}`;
};

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

    for (const key of ['max', 'over1', 'over8', 'displaced']) out[key] = pick(...all.map((n) => n[key]));

    return out;
}

/** What the buffer check saw, over the animations it played. */
function describeBuffers(entries) {
    const played = entries.filter((entry) => entry.info);
    const list = (some) => some.map((entry) => `${entry.animation} ${entry.info.rewrites}`).join(', ');
    const kept = played.filter((entry) => entry.info.keys.length === 0);
    const free = played.filter((entry) => entry.info.keys.length > 0);
    const parts = [];

    if (played.length === 0) return `skipped: ${entries[0].skipped}`;
    const builds = range(minMax(played.map((entry) => entry.info.templateBuilds)));

    parts.push(`${played[0].info.frames} frames each`);
    // setting a skin builds the vertex ranges a second time, before the animation plays
    parts.push(`Template builds stay at ${builds}${played[0].skin ? ' after the skin was set' : ''}`);
    if (kept.length) parts.push(`Index rewrites that must be 0: ${list(kept)}`);
    if (free.length) parts.push(`Index rewrites where slots can come and go: ${list(free)}`);

    return parts.join('. ');
}

/** The text after the label of a comparison. `frames` are its frames outside the known gap. */
function describe(entries, frames, gaps) {
    const [first] = entries;
    const { kind, info } = first;
    const known = gaps ? `${gaps} ${gaps === 1 ? 'frame' : 'frames'} in the known gap: clipping` : '';

    if (kind === 'draws') return `ours ${range(info.ours)}, official ${range(info.official)}`;
    if (kind === 'steady') return describeBuffers(entries);
    if (kind === 'visible') {
        return `${entries.length} animations, each draws ${Math.min(...entries.map((e) => e.info.covered))} px or more`;
    }
    if (frames.length === 0) return known;
    const n = groupNumbers(frames, kind === 'proof');
    const direct = `max ${n.max}, over 1: ${percent(n.over1)}, over 8: ${percent(n.over8)}`;
    const alpha = Math.max(...frames.map((entry) => entry.alphaMax ?? 0));
    let text = `${frames.length} frames, `;

    if (kind === 'proof') text += `weakest ${direct}`;
    else if (kind === 'formats') text += `not explained by a displacement: ${percent(n.displaced)} (${direct})`;
    else text += direct;
    if (kind === 'proof' && frames[0].solid.displaced !== undefined)
        text += `, not explained by a displacement: ${percent(n.displaced)}`;
    if (alpha) text += `. Alpha on a transparent target differs by up to ${alpha}: additive slots add none in ours`;
    if (known) text += `. And ${known}`;

    return text;
}

/**
 * A reporter for one renderer.
 *
 * @param options.root The repo root, for the image paths it prints.
 * @param options.dir Where the images of this renderer go.
 * @param options.verbose True lists every frame, not only the failing ones.
 */
export function createReporter({ root, dir, verbose }) {
    const totals = new Map();
    // the captures of the known gap, with the rig and the images of each
    const known = [];
    const total = (key) => {
        if (!totals.has(key)) totals.set(key, { frames: 0, failed: 0, gaps: 0, numbers: [] });

        return totals.get(key);
    };

    function saveShots(rig, entry) {
        const name = [
            entry.gap ? 'gap' : entry.reasons.length ? 'fail' : 'pass',
            slug(rig.id),
            slug(entry.animation),
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
        /** Prints the cases of one rig, grouped by comparison. Returns the number of failures. */
        rig(rig, report) {
            const groups = new Map();
            let failed = 0;

            for (const entry of report.cases) {
                if (!groups.has(entry.label)) groups.set(entry.label, []);
                groups.get(entry.label).push(entry);
            }
            for (const [label, entries] of groups) {
                const bad = entries.filter((entry) => entry.reasons.length);
                const gaps = entries.filter((entry) => entry.gap);
                // the known gap has a list of its own and stays out of the worst numbers
                const frames = entries.filter((entry) => entry.solid && !entry.gap);
                const { kind } = entries[0];

                if (frames.length || gaps.length) {
                    const sum = total(kind === 'proof' ? label : kind);

                    sum.frames += frames.length + gaps.length;
                    sum.failed += bad.length;
                    sum.gaps += gaps.length;
                    sum.proof = kind === 'proof';
                    if (frames.length) sum.numbers.push(groupNumbers(frames, sum.proof));
                }
                console.log(
                    `    ${bad.length ? 'FAIL' : 'ok  '} ${label.padEnd(30)} ${describe(entries, frames, gaps.length)}`,
                );
                failed += bad.length;
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
                for (const entry of entries) {
                    const images = entry.shots ? saveShots(rig, entry) : null;

                    if (entry.gap) known.push({ rig, entry, images });
                    if (images && (entry.reasons.length || verbose)) console.log(`         images: ${images}`);
                }
            }
            for (const note of report.notes) console.log(`    note ${note}`);

            return failed;
        },

        /** Prints one line per comparison over every rig. Numbers leave the known gap out. */
        summary() {
            for (const [key, sum] of totals) {
                const pick = sum.proof ? Math.min : Math.max;
                const of = (name) => (sum.numbers.length ? pick(...sum.numbers.map((n) => n[name])) : 0);
                let line = `  ${(SUMMARY_NAMES[key] ?? key).padEnd(24)} ${sum.frames} frames, ${sum.failed} failed, `;

                if (sum.gaps) line += `${sum.gaps} in the known gap, `;
                line += `${sum.proof ? 'weakest' : 'worst'} max ${of('max')}, over 1: ${percent(of('over1'))}, over 8: ${percent(of('over8'))}`;
                if (key === 'formats') line += `, not explained by a displacement: ${percent(of('displaced'))}`;
                console.log(line);
            }
        },

        /**
         * Lists the captures of the known gap: ours is off there and reports a clipping attachment
         * it ignored. Returns how many there are.
         */
        knownGap(heading) {
            if (known.length === 0) return 0;
            console.log(`${heading} (${known.length} captures, --strict-clipping fails them)`);
            for (const { rig, entry, images } of known) {
                const n = frameNumbers(entry);
                const direct = `max ${n.max}, over 1: ${percent(n.over1)}, over 8: ${percent(n.over8)}`;

                console.log(`  ${rig.id} ${entry.label}, ${place(entry)}: ${direct}`);
                if (verbose) {
                    console.log(`      clear: ${numbers(entry.clear)}`);
                    console.log(`      solid: ${numbers(entry.solid)}`);
                }
                if (images) console.log(`      images: ${images}`);
            }

            return known.length;
        },
    };
}
