/**
 * The verdict of the A/B bench for milestone M6, work that follows change. The list, for 200
 * instances on WebGL2 and WebGPU with the default options:
 *
 *   - a skeleton at rest: the update costs at most a tenth of what it costs while it plays
 *   - a skeleton at rest uploads nothing
 *   - playing: no rig gets slower than in M5, in update, cpu and frame
 *   - the root import is at most 27 kB gzip
 *
 * The first two need the scenes `play` and `rest` in one run. A row is one rule for one renderer
 * and rig, with the outcome `pass`, `fail`, `undecided` or `not measured`, as in the list of M5:
 * a time is compared over the runs of a block, and where the runs of the two sides overlap the
 * row is undecided, never a pass.
 *
 * At rest. The update at rest passes when its slowest run is within a tenth of the fastest run
 * while playing. Uploads are counted on the GPU interface, see `countUploads` of
 * scripts/render/pixels.js. A frame of an empty stage uploads something too: on WebGPU the
 * uniforms of the stage. So a skeleton at rest uploads nothing when its frame has no more
 * uploads than an empty stage. The uniforms of its own draw call may add up to `UNIFORM_SLACK`
 * bytes.
 *
 * Against M5. The numbers of M5 come from a baseline file, see scripts/bench/baseline.mjs. They
 * are from another day, and the row says from which. The size is read from
 * ci/size-baseline.json, which `pnpm size:update` writes: it is the size of the build that was
 * accepted last, not of this run.
 */
import { existsSync, readFileSync } from 'node:fs';
import { runsOf } from './baseline.mjs';
import { ms, overlap, print, spread } from './table.mjs';

const VERDICT_INSTANCES = 200;
const VERDICT_RENDERERS = ['webgl', 'webgpu'];
/** The share of the update while playing that the update at rest may cost. */
const REST_SHARE = 0.1;
/** Bytes a frame at rest may upload above an empty stage: the uniforms of a few draw calls. */
const UNIFORM_SLACK = 1024;
/** The most bytes the root import may have, gzipped: 27 kB. */
const SIZE_LIMIT = 27 * 1024;

const kb = (bytes) => (bytes / 1024).toFixed(1);

/** The combined runs of a rig in a scene at the instance count of the verdict, or null. */
function groupOf(entry, scene, id) {
    const rig = entry?.rigs.find((it) => (it.scene ?? 'play') === scene && it.id === id);

    return rig ? { rig, group: rig.summary?.find((it) => it.instances === VERDICT_INSTANCES) ?? null } : null;
}

/** The rule about the update at rest: at most a tenth of the update while playing. */
function judgeRestUpdate(play, rest) {
    if (!play?.ours || !rest?.ours)
        return { outcome: 'not measured', detail: 'the scenes play and rest did not both run' };
    const [a, b] = [rest.ours.update, play.ours.update];
    const detail =
        `update at rest ${ms(a.median)} +-${spread(a)} ms, while playing ${ms(b.median)} +-${spread(b)} ms, ` +
        `${((100 * a.median) / b.median).toFixed(1)} percent`;

    if (a.max <= REST_SHARE * b.min) return { outcome: 'pass', detail };
    if (a.min > REST_SHARE * b.max) return { outcome: 'fail', detail };

    return { outcome: 'undecided', detail: `${detail}. The runs lie on both sides of a tenth` };
}

/** The rule about uploads at rest: no more than a frame of an empty stage. */
function judgeRestUploads(rest, empty) {
    if (!rest?.ours?.uploads || typeof empty?.uploads !== 'number') {
        return { outcome: 'not measured', detail: 'the scene rest did not run, or the page counted no uploads' };
    }
    const calls = rest.ours.uploads.median;
    const bytes = rest.ours.uploadBytes.median;
    const official = rest.official?.uploads
        ? `, official ${rest.official.uploads.median.toFixed(1)} and ${kb(rest.official.uploadBytes.median)} KB`
        : '';
    const detail =
        `ours uploads ${calls.toFixed(1)} buffers and ${kb(bytes)} KB per frame, ` +
        `an empty stage ${empty.uploads.toFixed(1)} and ${kb(empty.uploadBytes)} KB${official}`;
    const none = calls <= empty.uploads + 0.01 && bytes <= empty.uploadBytes + UNIFORM_SLACK;

    return { outcome: none ? 'pass' : 'fail', detail };
}

/** One time of a rig while playing against the same time of the baseline. */
function judgeAgainstBaseline(now, before, key, from) {
    if (!now?.ours) return { outcome: 'not measured', detail: 'the scene play did not run' };
    if (!before?.ours?.[key]) return { outcome: 'not measured', detail: 'the baseline has no number for it' };
    const [a, b] = [now.ours[key], runsOf(before.ours[key])];
    const detail =
        `${key} ${ms(a.median)} +-${spread(a)} ms, M5 ${ms(b.median)} +-${spread(b)} ms, ` +
        `ratio ${(a.median / b.median).toFixed(2)}, against a run of ${from}`;

    if (now.ours.runs < 2) return { outcome: 'undecided', detail: `${detail}. One run has no spread to judge by` };
    if (overlap(a, b)) return { outcome: 'undecided', detail: `${detail}. The runs of the two overlap` };

    return { outcome: a.median <= b.median ? 'pass' : 'fail', detail };
}

/** The rule about the size of the root import, from the size baseline of the repo. */
function judgeSize(file) {
    const row = (judged) => [{ renderer: 'none', rig: 'the root import', ...judged }];

    if (!existsSync(file)) return row({ outcome: 'not measured', detail: 'ci/size-baseline.json is missing' });
    const bytes = JSON.parse(readFileSync(file, 'utf8')).everything?.gzip;

    if (typeof bytes !== 'number')
        return row({ outcome: 'not measured', detail: 'the size baseline has no entry `everything`' });

    return row({
        outcome: bytes <= SIZE_LIMIT ? 'pass' : 'fail',
        detail: `${(bytes / 1024).toFixed(2)} kB gzip in ci/size-baseline.json, the limit is ${SIZE_LIMIT / 1024} kB`,
    });
}

/**
 * Judges the list of M6 from the result of an A/B run.
 *
 * @param result What the bench writes to its JSON file.
 * @param options.baseline The baseline of M5 from `readBaseline`, or null.
 * @param options.sizeFile The path of ci/size-baseline.json.
 * @returns The rules with their rows, and the `outcome` of the list, as `judgeVerdict` returns it.
 */
export function judgeM6(result, { baseline, sizeFile }) {
    const from = baseline ? `${baseline.date.slice(0, 10)}, ${baseline.machine?.power || 'unknown power'}` : '';
    const rules = [
        {
            id: 'rest-update',
            text: 'a skeleton at rest: the update costs at most a tenth of what it costs while it plays',
            rows: [],
        },
        { id: 'rest-uploads', text: 'a skeleton at rest uploads nothing', rows: [] },
        { id: 'play-update', text: 'playing: no rig takes longer to update than in M5', rows: [] },
        { id: 'play-cpu', text: 'playing: no rig takes more CPU time per frame than in M5', rows: [] },
        { id: 'play-frame', text: 'playing: no rig takes longer per frame than in M5', rows: [] },
        { id: 'size', text: 'the root import is at most 27 kB gzip', rows: judgeSize(sizeFile) },
    ];
    const [restUpdate, restUploads, ...playRules] = rules;

    for (const renderer of VERDICT_RENDERERS) {
        const entry = result.renderers.find((it) => it.renderer === renderer);
        const row = (rig, judged) => ({ renderer, rig, ...judged });
        const ids = [
            ...new Set(
                (entry?.rigs ?? []).filter((it) => ['play', 'rest'].includes(it.scene ?? 'play')).map((it) => it.id),
            ),
        ];

        if (!entry) {
            const missing = row('every rig', { outcome: 'not measured', detail: 'the renderer did not run' });

            for (const rule of rules.slice(0, 5)) rule.rows.push(missing);
            continue;
        }
        for (const id of ids) {
            const play = groupOf(entry, 'play', id);
            const rest = groupOf(entry, 'rest', id);

            restUpdate.rows.push(row(id, judgeRestUpdate(play?.group, rest?.group)));
            restUploads.rows.push(row(id, judgeRestUploads(rest?.group, rest?.rig.emptyFrame)));
            for (const [index, key] of ['update', 'cpu', 'frame'].entries()) {
                const before = baseline?.scenes.play?.[renderer]?.[id];
                const judged = baseline
                    ? judgeAgainstBaseline(play?.group, before, key, from)
                    : { outcome: 'not measured', detail: 'no baseline of M5 was given' };

                playRules[index].rows.push(row(id, judged));
            }
        }
    }
    const rows = rules.flatMap((rule) => rule.rows);
    const count = (outcome) => rows.filter((row) => row.outcome === outcome).length;
    const counts = {
        pass: count('pass'),
        fail: count('fail'),
        undecided: count('undecided'),
        unmeasured: count('not measured'),
    };
    const outcome = counts.fail > 0 ? 'fail' : counts.undecided + counts.unmeasured > 0 ? 'undecided' : 'pass';

    return { instances: VERDICT_INSTANCES, renderMode: result.settings.renderMode, rules, counts, outcome };
}

/** Prints what `judgeM6` returned. */
export function printM6(verdict) {
    const { counts } = verdict;

    console.log(
        `bench: verdict for the list of milestone M6, at ${verdict.instances} instances, ours with renderMode ${verdict.renderMode}`,
    );
    for (const rule of verdict.rules) {
        console.log(`  ${rule.text}`);
        print(
            rule.rows.map((row) => [row.renderer, row.rig, row.outcome, row.detail]),
            [0, 1, 2, 3],
        );
    }
    console.log(
        `bench: verdict of M6: ${verdict.outcome}. ${counts.pass} rows pass, ${counts.fail} fail, ` +
            `${counts.undecided} are undecided and ${counts.unmeasured} were not measured`,
    );
}
