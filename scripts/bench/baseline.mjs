/**
 * The numbers of one run of the bench, kept small enough to live in the repo: per scene,
 * renderer and rig the times of both sides at the instance count of the verdict. A later run is
 * held against them.
 *
 * Such a comparison is between two days. The same build measured on two days differs by more
 * than the runs of one day do, so the verdict says where its baseline is from. To compare two
 * builds in the same hour, keep the build of the earlier one and measure it again with
 * `--dist`, see scripts/render/setup.mjs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** The numbers a baseline keeps of a side: each as the median, the smallest and the largest run. */
const TIMES = ['update', 'cpu', 'frame'];

/** What a combined side of a rig keeps in a baseline, or null for a side that did not run. */
function keep(side) {
    if (!side) return null;
    const round = (value) => Math.round(value * 1e4) / 1e4;
    const kept = { runs: side.runs, draws: side.draws };

    for (const key of TIMES) kept[key] = [round(side[key].median), round(side[key].min), round(side[key].max)];
    if (side.uploads) kept.uploads = round(side.uploads.median);
    if (side.uploadBytes) kept.uploadBytes = Math.round(side.uploadBytes.median);

    return kept;
}

/**
 * The baseline of a run: what `ab.mjs` wrote to its JSON file, reduced.
 *
 * @param instances The instance count to keep. A scene that ran with other counts keeps its largest.
 */
function extractBaseline(result, instances) {
    const scenes = {};

    for (const { renderer, rigs } of result.renderers) {
        for (const rig of rigs) {
            const counts = (rig.summary ?? []).map((group) => group.instances);
            const group = rig.summary?.find(
                (it) => it.instances === (counts.includes(instances) ? instances : Math.max(...counts)),
            );

            if (!group) continue;
            const scene = rig.scene ?? 'play';

            scenes[scene] ??= {};
            scenes[scene][renderer] ??= {};
            scenes[scene][renderer][rig.id] = {
                instances: group.instances,
                plays: rig.animation,
                ours: keep(group.ours),
                official: keep(group.official),
            };
        }
    }

    return {
        what: 'Numbers of one run of pnpm bench:ab, for the verdict of later runs. Times are ms: median, smallest and largest run.',
        date: result.date,
        command: result.command,
        build: result.build,
        machine: result.machine,
        versions: result.versions,
        runs: result.settings.runs,
        scenes,
    };
}

/** Writes the baseline of a run to a file, laid out as the formatter of the repo lays JSON out. */
export function writeBaseline(file, result, instances) {
    const text = JSON.stringify(extractBaseline(result, instances), null, 2);
    // a list of numbers goes on one line
    const lists = /\[\s+(-?[\d.e+-]+(?:,\s+-?[\d.e+-]+)*)\s+\]/g;

    writeFileSync(file, `${text.replace(lists, (_, numbers) => `[${numbers.replace(/\s+/g, ' ')}]`)}\n`);
}

/** Reads a baseline, or returns null when the file does not exist. */
export function readBaseline(file) {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/** A time of a baseline in the form the tables read: the median, the smallest and the largest run. */
export const runsOf = ([median, min, max]) => ({ median, min, max });
