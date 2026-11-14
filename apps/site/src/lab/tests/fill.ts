import { testInfo } from '../catalog';
import { defineTest } from '../lab';
import { phase, placeCover } from '../place';
import { durationOf, frameOf, makeSkeleton, updateAll } from '../skeletons';

/*
 * A scene that the GPU fills many times over. A region is a quad, and much of a quad can be
 * transparent. A tight mesh draws the outline of the opaque part instead, with more vertices.
 * On the desktop of the repository that saved 3 to 12 percent of the render time in such a
 * scene. A phone GPU fills fewer pixels a second, so it may gain more.
 */

const RIG = 'animation_bee_big';

export default defineTest({
    ...testInfo('fill'),
    rigs: [RIG],
    sides: [
        { name: 'default', options: {} },
        { name: 'tight on', options: { tightMesh: 'on' } },
        { name: 'tight off', options: { tightMesh: 'off' } },
    ],
    build(context) {
        const bees = Array.from({ length: context.count }, (_, index) => {
            const bee = makeSkeleton(context, RIG);
            bee.play('feature', { loop: true });
            bee.update(phase(index) * durationOf(bee, 'feature'));

            return bee;
        });

        placeCover(bees, frameOf(context, RIG), context.width, context.height);

        return { step: (seconds) => updateAll(bees, seconds) };
    },
});
