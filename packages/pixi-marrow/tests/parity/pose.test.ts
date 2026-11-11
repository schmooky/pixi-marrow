import { beforeAll, describe, expect, it } from 'vitest';
import { createPoseEngine, importSkeleton, type SkeletonModel } from '../../src/core';
import { loadPoseRig } from './pose-official';
import { attachmentLabels, engineSubject, officialSubject, runScript } from './pose-run';
import { SCRIPT_FAMILIES } from './pose-scripts';
import type { OfficialPoseRig } from './pose-shared';
import { listPoseRigs } from './pose-synthetic';

/*
 * Pose parity: a pose engine gives exactly the pose the official core of the file's version gives
 * for the same calls. Constraints are not part of this: the engine ignores them, and the official
 * numbers are the animated pose before constraints, with world transforms from bones alone.
 * It runs on every fixture and on a rig made for what the fixtures do not have.
 */
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
            const engine = await createPoseEngine(model, { constraints: 'ignore' });
            const failure = runScript(
                script,
                engineSubject(engine, labels.ofObject),
                officialSubject(rig.createDriver(), labels.ofRef),
            );

            if (failure !== null) expect.fail(`${source.id}, ${failure}`);
        }
    });
});
