import { testInfo } from '../catalog';
import { defineTest } from '../lab';
import { phase, placeGrid } from '../place';
import { durationOf, frameOf, makeSkeleton, updateAll } from '../skeletons';

/*
 * Many copies of one rig. The batched mode draws them in one call with vertices placed on the
 * CPU. GPU skinning places them in the vertex shader, and instancing draws the copies that
 * follow each other in one call. On the desktop of the repository instancing beat drawing
 * alone, and matched the batched mode for small rigs. This test asks the same of a phone.
 */

const RIG = 'animation_bee';
const GPU = { renderMode: 'mesh', skinning: 'gpu' } as const;

export default defineTest({
    ...testInfo('crowd'),
    rigs: [RIG],
    sides: [
        { name: 'CPU batched', options: {} },
        { name: 'CPU mesh', options: { renderMode: 'mesh' } },
        { name: 'GPU alone', options: { ...GPU, instancing: 'off' } },
        { name: 'GPU instanced', options: { ...GPU, instancing: 'auto' } },
    ],
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
