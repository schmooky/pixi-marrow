import { Rectangle } from 'pixi.js';
import type { MarrowSpine } from 'pixi-marrow';

/*
 * How a new skeleton of the playground starts: with which animation, which skin, and the box
 * of its setup pose that places it, centres it and catches its clicks.
 */

/** The animation a skeleton plays when it arrives: a loop named idle where there is one, else the first. */
export function firstAnimation(spine: MarrowSpine): string | null {
    const names = spine.info.animations.map((animation) => animation.name);

    return names.find((name) => /idle|loop/i.test(name)) ?? names[0] ?? null;
}

/** Skins a new skeleton tries besides its default one, at most. */
const SKINS_TRIED = 6;

/**
 * The box of the setup pose of a skeleton, and the skin it starts with: the one of the default
 * skin and the first few others that shows the largest box. A rig that dresses a character
 * from parts often has a default skin with a shadow alone. A skeleton that shows nothing at
 * all gets a box of 100 units.
 */
export function firstPicture(spine: MarrowSpine): { frame: Rectangle; skin: string | null } {
    const [, ...others] = spine.info.skins;
    let best: { frame: Rectangle; skin: string | null } = { frame: new Rectangle(-50, -100, 100, 100), skin: null };
    let bestArea = 1;

    for (const skin of [null, ...others.slice(0, SKINS_TRIED)]) {
        if (skin !== null) spine.skin = skin;
        spine.update(0);
        const box = spine.getLocalBounds().rectangle;

        // a skin must show clearly more than the default one to be picked
        if (box.width * box.height > bestArea * (skin === null ? 1 : 1.5)) {
            best = { frame: box.clone(), skin };
            bestArea = box.width * box.height;
        }
    }
    if (best.skin !== null) spine.skin = best.skin;
    else if (others.length > 0) spine.skin = spine.info.skins[0] ?? 'default';

    return best;
}
