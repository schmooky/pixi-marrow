import { unknownName } from '../base/names';
import type { SkeletonModel, SkinData } from '../model/model';

/**
 * Why the animations of a model cannot be baked while a skin is active, or null when they can.
 * An active physics constraint or slider poses the bones from more than the time of the
 * animation. Physics depends on the frames before, a slider on a bone or on its own time. Such a
 * skeleton is played by the pose engine. A constraint that needs a skin is active while one
 * of the active skins lists it.
 *
 * @param skin The active skin, or undefined for none.
 *
 * @example
 * const reason = bakeBlocker(model, model.skins[0]);
 * if (reason !== null) console.warn(`not baked: ${reason}`);
 */
export function bakeBlocker(model: SkeletonModel, skin: SkinData | undefined): string | null {
    const { constraints } = model;

    for (let i = 0; i < constraints.length; i++) {
        const constraint = constraints[i];

        if (constraint === undefined || (constraint.type !== 'physics' && constraint.type !== 'slider')) continue;
        if (constraint.skinRequired && !(skin?.constraints.includes(i) ?? false)) continue;

        return `the ${constraint.type === 'slider' ? 'slider' : 'physics constraint'} "${constraint.name}" is active`;
    }

    return null;
}

/**
 * The index of an animation, by its index or its name. Throws the `MarrowError` of an unknown
 * name, which lists the names of the animations.
 *
 * @example
 * const index = animationIndex(model, 'run');
 */
export function animationIndex(model: SkeletonModel, animation: number | string): number {
    const { animations } = model;

    if (typeof animation === 'number' && Number.isInteger(animation) && animations[animation] !== undefined) {
        return animation;
    }
    const index = animations.findIndex(({ name }) => name === animation);

    if (index < 0) {
        throw unknownName(
            'animation',
            String(animation),
            animations.map(({ name }) => name),
        );
    }

    return index;
}

/**
 * The indices of skins, by name. Throws the `MarrowError` of an unknown name, which lists the
 * names of the skins.
 *
 * @example
 * const skins = skinIndices(model, ['base', 'armor']);
 */
export function skinIndices(model: SkeletonModel, names: readonly string[]): number[] {
    return names.map((name) => {
        const index = model.skins.findIndex((skin) => skin.name === name);

        if (index < 0) {
            throw unknownName(
                'skin',
                name,
                model.skins.map((skin) => skin.name),
            );
        }

        return index;
    });
}
