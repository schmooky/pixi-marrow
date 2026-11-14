import { testInfo } from '../catalog';
import { defineTest } from '../lab';
import { phase, placeGrid } from '../place';
import { durationOf, frameOf, makeSkeleton, updateAll } from '../skeletons';

/*
 * Many copies of one rig, each at another point of its loop. The batched mode, the default for
 * a small rig, draws them in one draw call with the vertices placed on the CPU.
 */

const RIG = 'animation_bee';

export default defineTest({
    ...testInfo('crowd'),
    rigs: [RIG],
    build(context) {
        const bees = Array.from({ length: context.count }, (_, index) => {
            const bee = makeSkeleton(context, RIG);
            bee.play('idle', { loop: true });
            bee.update(phase(index) * durationOf(bee, 'idle'));

            return bee;
        });
        const frame = frameOf(context, RIG);

        placeGrid(bees, () => frame, context.width, context.height);

        return { step: (seconds) => updateAll(bees, seconds) };
    },
});
