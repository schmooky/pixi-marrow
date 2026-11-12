import { beforeAll, describe, expect, it } from 'vitest';
import { createPoseEngine, importSkeleton, type SkeletonModel } from '../../src/core';
import { loadPoseRig } from './pose-official';
import { attachmentLabels, besideAnother, engineSubject, officialSubject, runScript } from './pose-run';
import { SCRIPT_FAMILIES } from './pose-scripts';
import type { OfficialPoseRig } from './pose-shared';
import { listPoseRigs } from './pose-synthetic';

/*
 * Pose parity: a pose engine gives exactly the pose the official core of the file's version gives
 * for the same calls. The local pose is the animated one, before constraints. The world
 * transforms have every constraint solved: IK, transform and path constraints, physics and
 * sliders. The slot values and the draw order are those that are drawn, after the sliders.
 * It runs on every fixture and on the rigs made for what the fixtures do not have.
 *
 * After every call the stamps of the pose state must have reported what the call changed.
 */

/** The families that run a second time, next to another engine of the same model. */
const BESIDE = ['keys', 'still bones'];
/** Of the scripts for rest, those with two tracks run next to another engine too. */
const BESIDE_REST = /track/;

describe.each(listPoseRigs())('$id', (source) => {
    let rig: OfficialPoseRig;
    let model: SkeletonModel;
    let labels: ReturnType<typeof attachmentLabels>;

    beforeAll(async () => {
        const files = source.read();

        rig = loadPoseRig(source.version, files);
        model = await importSkeleton(files.skeleton);
        labels = attachmentLabels(model);
    });

    it.each(SCRIPT_FAMILIES)('poses like the official core: $name', { timeout: 30_000 }, async (family) => {
        for (const script of family.scripts(rig.info, `${source.version}/${source.rig}`)) {
            const engine = await createPoseEngine(model);
            const failure = runScript(
                script,
                engineSubject(engine, labels.ofObject),
                officialSubject(rig.createDriver(), labels.ofRef),
            );

            if (failure !== null) expect.fail(`${source.id}, ${failure}`);
        }
    });

    /*
     * An engine may keep things between updates: the key it found last, the work of a path, a pose
     * at rest. The scripts that reach those run again here, while a second engine of the same
     * model plays in another phase between the updates of the first.
     */
    it('poses like the official core next to a second engine of the model', { timeout: 30_000 }, async () => {
        const scripts = SCRIPT_FAMILIES.flatMap((family) => {
            const all = family.scripts(rig.info, `${source.version}/${source.rig}`);

            if (family.name === 'rest') return all.filter(({ name }) => BESIDE_REST.test(name));

            return BESIDE.includes(family.name) ? all : [];
        });

        expect(scripts.length).toBeGreaterThan(8);
        for (const script of scripts) {
            const engine = await createPoseEngine(model);
            const other = await createPoseEngine(model);
            const failure = runScript(
                script,
                besideAnother(engineSubject(engine, labels.ofObject), other, rig.info.animations.length),
                officialSubject(rig.createDriver(), labels.ofRef),
            );

            if (failure !== null) expect.fail(`${source.id}, ${failure}`);
        }
    });
});
