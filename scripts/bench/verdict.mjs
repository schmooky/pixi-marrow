/**
 * The verdict of the A/B bench: the list that says when the batched render mode of milestone M5
 * is done, judged rule by rule from the numbers of one run.
 *
 * The list, for 200 instances on WebGL2 and WebGPU with the default options:
 *
 *   - rigs without a clip need no more draw calls than the official runtime
 *   - speedy-ess and sack-pro take less time per frame than the official runtime
 *   - coin-pro takes no longer per frame than the official runtime
 *   - tank-pro and raptor-pro do not get slower than they are in the mesh mode
 *   - the pixel check passes in both modes, which `pnpm check:render` decides and this bench does not
 *
 * A row is one rule for one renderer and rig. Its outcome is `pass`, `fail`, `undecided` or
 * `not measured`. A time is compared over the runs of a block. When the runs of the two sides
 * overlap, the difference is inside the spread and the row is undecided, never a pass. Draw calls
 * are counted, so they have no spread.
 *
 * The rule about the mesh mode compares ours with ours once more, with the mesh mode asked for by
 * name, in the same seconds. Where the runtime reports that the default options drew in the mesh
 * mode, both sides are one mode and the rule holds by that fact. The ratio it prints is then the
 * noise of the run. What the mesh mode was at an earlier commit is not measured here: times of
 * two runs differ by more than the modes do.
 */
import { ms, overlap, print, spread } from './table.mjs';

/** The instance count the list names. */
const VERDICT_INSTANCES = 200;
/** The renderers the list names. */
const VERDICT_RENDERERS = ['webgl', 'webgpu'];

/** A test for the rigs with one of some names, in any Spine version. */
const named = (...names) => {
    const applies = (rig) => names.some((name) => rig.id.endsWith(`/${name}`));

    applies.names = names;

    return applies;
};

/** Draw calls per frame as text: a whole number, or one decimal where the count moves between frames. */
const calls = (value) => (Number.isInteger(value) ? `${value}` : value.toFixed(1));

/** The rule about draw calls: the mean per frame of ours against the official one. */
function judgeDraws({ ours, official }) {
    if (!ours || !official) return { outcome: 'not measured', detail: 'a side has no numbers' };
    const [a, b] = [ours.drawsMean.median, official.drawsMean.median];

    return { outcome: a <= b ? 'pass' : 'fail', detail: `ours ${calls(a)} draw calls per frame, official ${calls(b)}` };
}

/**
 * A rule about the time of a frame: `a` must take less than `b`. The medians over the runs are
 * compared, and runs that overlap decide nothing.
 *
 * @param other What `b` is called in the text.
 */
function judgeFrame(a, b, other) {
    if (!a || !b) return { outcome: 'not measured', detail: 'a side has no numbers' };
    const share = a.frame.median / b.frame.median;
    const detail =
        `frame ${ms(a.frame.median)} +-${spread(a.frame)} ms, ${other} ${ms(b.frame.median)} +-${spread(b.frame)} ms, ` +
        `ratio ${share.toFixed(2)}`;

    // one run has no spread, so it cannot say that a difference is outside of it
    if (a.runs < 2 || b.runs < 2)
        return { outcome: 'undecided', detail: `${detail}. One run has no spread to judge by` };
    if (overlap(a.frame, b.frame)) return { outcome: 'undecided', detail: `${detail}. The runs of the two overlap` };

    return { outcome: share < 1 ? 'pass' : 'fail', detail };
}

/** The rule about the mesh mode, see the head of this file. */
function judgeMesh({ ours, mesh }, settings) {
    if (!mesh) {
        const why =
            settings.renderMode === 'mesh'
                ? 'ours was asked for the mesh mode by name, so there is nothing to compare it with'
                : 'ours in the mesh mode did not run as a third side';

        return { outcome: 'not measured', detail: why };
    }
    const timed = judgeFrame(ours, mesh, 'mesh mode');

    if (ours?.ours?.renderMode !== 'mesh') return timed;

    return {
        outcome: 'pass',
        detail: `the default options drew in the mesh mode, so both sides are one mode. ${timed.detail}: that is the noise of this run`,
    };
}

/**
 * The rules of the list. `applies` says which rigs a rule is about, and `judge` gets the numbers
 * of one rig at the instance count of the verdict: the combined runs of `ours`, `official` and
 * `mesh`.
 */
const RULES = [
    {
        id: 'draws',
        text: 'rigs without a clip need no more draw calls than the official runtime',
        applies: (rig) => !rig.features.includes('clipping'),
        judge: judgeDraws,
    },
    {
        id: 'faster',
        text: 'speedy-ess and sack-pro take less time per frame than the official runtime',
        applies: named('speedy-ess', 'sack-pro'),
        judge: ({ ours, official }) => judgeFrame(ours, official, 'official'),
    },
    {
        id: 'no-longer',
        text: 'coin-pro takes no longer per frame than the official runtime',
        applies: named('coin-pro'),
        judge: ({ ours, official }) => judgeFrame(ours, official, 'official'),
    },
    {
        id: 'mesh',
        text: 'tank-pro and raptor-pro do not get slower than they are in the mesh mode',
        applies: named('tank-pro', 'raptor-pro'),
        judge: judgeMesh,
    },
];

/** True for a rig whose rule needs ours in the mesh mode as a third side of the A/B mode. */
export const needsMesh = (rig) => RULES.find((rule) => rule.id === 'mesh').applies(rig);

/** The rows of one rule for one renderer. `rigs` are the rigs that renderer measured, or null. */
function rowsOf(rule, renderer, rigs, settings) {
    const row = (rig, judged) => ({ renderer, rig, ...judged });

    if (rigs === null) return [row('every rig', { outcome: 'not measured', detail: 'the renderer did not run' })];
    const rows = [];

    for (const rig of rigs.filter(rule.applies)) {
        const group = rig.summary?.find((entry) => entry.instances === VERDICT_INSTANCES);

        rows.push(
            row(
                rig.id,
                group
                    ? rule.judge(group, settings)
                    : { outcome: 'not measured', detail: `the run has no block of ${VERDICT_INSTANCES} instances` },
            ),
        );
    }
    // a rule that names its rigs wants each of them in the run
    for (const name of rule.applies.names ?? []) {
        if (!rigs.some((rig) => rig.id.endsWith(`/${name}`))) {
            rows.push(row(name, { outcome: 'not measured', detail: 'the rig is not in this run' }));
        }
    }

    return rows;
}

/**
 * Judges the list from the result of an A/B run.
 *
 * @param result What the bench writes to its JSON file: `settings` and per renderer the rigs
 * with their `summary`.
 * @returns The rules with their rows, and the `outcome` of the whole list: `fail` when a row
 * fails, else `undecided` when a row is undecided or was not measured, else `pass`.
 */
export function judgeVerdict(result) {
    const { settings } = result;
    const rules = RULES.map((rule) => ({
        id: rule.id,
        text: rule.text,
        rows: VERDICT_RENDERERS.flatMap((renderer) => {
            const entry = result.renderers.find((it) => it.renderer === renderer);

            return rowsOf(rule, renderer, entry ? entry.rigs : null, settings);
        }),
    }));

    // the list is about what an application gets without an option
    if (settings.renderMode !== 'auto') {
        rules.push({
            id: 'defaults',
            text: 'the list is about the default options',
            rows: [
                {
                    renderer: 'both',
                    rig: 'every rig',
                    outcome: 'not measured',
                    detail: `this run asked for renderMode ${settings.renderMode} by name`,
                },
            ],
        });
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

    return { instances: VERDICT_INSTANCES, renderMode: settings.renderMode, rules, counts, outcome };
}

/** Prints what `judgeVerdict` returned. */
export function printVerdict(verdict) {
    const { counts } = verdict;

    console.log(
        `bench: verdict for the list of milestone M5, at ${verdict.instances} instances, ours with renderMode ${verdict.renderMode}`,
    );
    for (const rule of verdict.rules) {
        console.log(`  ${rule.text}`);
        print(
            rule.rows.map((row) => [row.renderer, row.rig, row.outcome, row.detail]),
            [0, 1, 2, 3],
        );
    }
    console.log('  the pixel check passes in both modes');
    console.log('    not judged here: run pnpm check:render');
    console.log(
        `bench: verdict: ${verdict.outcome}. ${counts.pass} rows pass, ${counts.fail} fail, ` +
            `${counts.undecided} are undecided and ${counts.unmeasured} were not measured`,
    );
}
