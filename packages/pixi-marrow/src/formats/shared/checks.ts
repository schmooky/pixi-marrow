import { MarrowError } from '../../base/errors';
import type { SkeletonModel } from '../../model/model';

/**
 * Checks what every reader must refuse, whatever the format and the version, once a file is read.
 *
 * A timeline that animates the dark color of a slot needs a slot with a dark color. The official
 * readers take such a file and fail when the animation plays. This check fails at the import, with
 * the names of the animation and the slot.
 *
 * @example
 * return checkModel({ version: '4.3', ...header, bones, slots, events, constraints, skins, animations });
 */
export function checkModel(model: SkeletonModel): SkeletonModel {
    const { hasDark, names } = model.slots;

    for (const animation of model.animations) {
        for (const timeline of animation.timelines) {
            if (timeline.kind !== 'rgba2' && timeline.kind !== 'rgb2') continue;
            if (hasDark[timeline.target] === 1) continue;
            const slot = names[timeline.target] ?? String(timeline.target);

            throw new MarrowError(
                'invalid-data',
                `The animation "${animation.name}" animates the dark color of the slot "${slot}", which has none.`,
                {
                    fix: `In Spine, turn on "Tint black" for the slot "${slot}" or delete its two-color keys, then export again.`,
                },
            );
        }
    }

    return model;
}
