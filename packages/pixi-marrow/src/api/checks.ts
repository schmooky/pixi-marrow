import { MarrowError } from '../base/errors';
import { closestName, unknownName } from '../base/names';
import type { PhysicsMode } from '../pose/engine';
import type { RenderMode } from '../render/mode';

/** The physics modes, as the official `Physics` names them. */
const PHYSICS_MODES: readonly PhysicsMode[] = ['none', 'reset', 'update', 'pose'];

/** The values of the `renderMode` option. */
const RENDER_MODES: readonly RenderMode[] = ['auto', 'mesh', 'batched'];

/**
 * The index of the item with a name. Throws the {@link MarrowError} of an unknown name, which
 * lists the names and the closest one.
 *
 * @param kind What the items are, for the message: `animation` or `skin`.
 *
 * @example
 * const index = namedIndex('animation', model.animations, 'idle');
 */
export function namedIndex(kind: string, items: readonly { name: string }[], name: string): number {
    for (let i = 0; i < items.length; i++) {
        if (items[i]?.name === name) return i;
    }

    throw unknownName(
        kind,
        name,
        items.map((item) => item.name),
    );
}

/**
 * A physics mode, or the {@link MarrowError} that lists the modes for any other value.
 *
 * @example
 * engine.physics = physicsMode('pose');
 */
export function physicsMode(mode: unknown): PhysicsMode {
    const found = PHYSICS_MODES.find((valid) => valid === mode);

    if (found !== undefined) return found;

    throw new MarrowError('invalid-data', `"${String(mode)}" is not a physics mode.`, {
        fix: `Set one of: ${PHYSICS_MODES.join(', ')}.`,
        validNames: PHYSICS_MODES,
        closest: closestName(String(mode), PHYSICS_MODES) ?? 'update',
    });
}

/**
 * A render mode, or the {@link MarrowError} that lists the modes for any other value.
 *
 * @example
 * view.renderMode = renderMode(options.renderMode ?? 'auto');
 */
export function renderMode(mode: unknown): RenderMode {
    const found = RENDER_MODES.find((valid) => valid === mode);

    if (found !== undefined) return found;

    throw new MarrowError('invalid-data', `"${String(mode)}" is not a render mode.`, {
        fix: `Set one of: ${RENDER_MODES.join(', ')}.`,
        validNames: RENDER_MODES,
        closest: closestName(String(mode), RENDER_MODES) ?? 'auto',
    });
}

/**
 * A number that is not NaN and not infinite, or the {@link MarrowError} that names the method
 * and the argument that got another value.
 *
 * @example
 * engine.physicsTranslate(finiteArgument('physicsTranslate', 'x', x), finiteArgument('physicsTranslate', 'y', y));
 */
export function finiteArgument(method: string, name: string, value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new MarrowError('invalid-data', `${method} got ${String(value)} for ${name}.`, {
            fix: 'Pass a finite number.',
        });
    }

    return value;
}
