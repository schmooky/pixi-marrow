import type { MarrowSpine, Track } from 'pixi-marrow';
import type { Controls } from './panel';

/** How the chips of a rig play its animations. */
export interface Playing {
    /** The animation that loops while no other one plays. */
    rest: string;
    /** True loops the animation of a pressed chip. False plays it once, and `rest` follows it. */
    loop: boolean;
}

/** The rows of a rig in a panel. */
export interface RigControls {
    /** Takes the rows of the rig out of the panel. */
    remove(): void;
}

/**
 * Adds the rows of a skeleton to a panel, built from what the rig holds: `Skin` when it has
 * more than one skin, and `Animation` with a chip for every animation. Nothing names an
 * animation here but `rest`.
 *
 * - An animation that moves bones plays once, and `rest` follows it. With `loop` it repeats.
 * - An animation that moves no bone changes a state, such as a blurred or a dimmed picture. It
 *   plays once and its last frame stays.
 *
 * The marked chip is the animation that plays. An animation that plays once keeps the mark
 * until it has ended, and then the chip of `rest` is marked again.
 */
export function rigControls(hero: MarrowSpine, { pick, chips }: Controls, { rest, loop }: Playing): RigControls {
    const animations = new Map(hero.info.animations.map((animation) => [animation.name, animation]));
    const skins = pick(
        'Skin',
        hero.info.skins,
        (name) => {
            hero.skin = name;
        },
        hero.skin,
    );
    /** The animation that plays once at the moment and is followed by `rest`, or null. */
    let once: string | null = null;
    const playing = chips(
        'Animation',
        [...animations.keys()],
        (name) => {
            const moves = animations.get(name)?.features.includes('bones') ?? false;

            once = null;
            if (name === rest || (loop && moves)) hero.play(name, { loop: true });
            else {
                hero.play(name);
                if (!moves) return;
                hero.queue(rest, { loop: true });
                once = name;
            }
        },
        rest,
    );
    // `rest` starts to mix in before the animation it follows has ended. The mark waits for that end
    const onStart = (track: Track): void => {
        if (once === null || track.animation !== rest) playing.select(track.animation);
    };
    const onComplete = (track: Track): void => {
        if (track.animation !== once) return;
        once = null;
        playing.select(rest);
    };

    hero.on('start', onStart);
    hero.on('complete', onComplete);

    return {
        remove() {
            hero.off('start', onStart);
            hero.off('complete', onComplete);
            skins.remove();
            playing.remove();
        },
    };
}

/**
 * Scales a skeleton and moves it, so that what it draws at the moment fills `share` of a scene
 * of the size `[width, height]` and stands in its middle.
 */
export function fit(hero: MarrowSpine, [width, height]: readonly [number, number], share: number): void {
    const bounds = hero.getLocalBounds();
    const scale = Math.min((width * share) / bounds.width, (height * share) / bounds.height);

    hero.scale.set(scale);
    hero.position.set(
        width / 2 - (bounds.x + bounds.width / 2) * scale,
        height / 2 - (bounds.y + bounds.height / 2) * scale,
    );
}
