import { SYMBOL_IDS, SYMBOLS } from '../../previews/reel-round';
import { testInfo } from '../catalog';
import { defineTest } from '../lab';
import { phase, placeGrid } from '../place';
import { durationOf, frameOf, makeSkeleton, updateAll } from '../skeletons';

/*
 * Symbols at rest, as most symbols of a slot game are most of the time. Every symbol lands and
 * stands past the end of its landing. Then one after another plays its win once, so a few move
 * while the others stand still. The idle cache draws a symbol that stands still as one image,
 * which costs memory for its texture. This test asks whether the time it saves pays on a phone.
 */

/** Frames between two starts of a win. */
const WIN_EVERY = 12;
/** Seconds a symbol stands past the end of its landing at the start, at least. */
const PAST_END = 0.25;
const RIGS = SYMBOL_IDS.map((id) => SYMBOLS[id].file);

export default defineTest({
    ...testInfo('rest'),
    rigs: RIGS,
    sides: [
        { name: 'live', options: {} },
        { name: 'idle cache', options: { idleCache: 'auto' } },
        { name: 'bake', options: { bake: 'auto' } },
    ],
    build(context) {
        const rigs = Array.from({ length: context.count }, (_, index) => RIGS[index % RIGS.length] ?? 'animation_a');
        const symbols = rigs.map((rig, index) => {
            const symbol = makeSkeleton(context, rig);
            symbol.play('landing');
            symbol.update(durationOf(symbol, 'landing') + PAST_END + phase(index));

            return symbol;
        });
        let frame = 0;

        placeGrid(symbols, (index) => frameOf(context, rigs[index] ?? 'animation_a'), context.width, context.height);

        return {
            step(seconds) {
                if (frame % WIN_EVERY === 0) symbols[(frame / WIN_EVERY) % symbols.length]?.play('win');
                frame++;
                updateAll(symbols, seconds);
            },
        };
    },
});
