import type { MarrowSpine } from 'pixi-marrow';
import { SYMBOL_IDS, SYMBOLS } from '../../previews/reel-round';
import { testInfo } from '../catalog';
import { defineTest } from '../lab';
import { phase, placeGrid } from '../place';
import { durationOf, frameOf, makeSkeleton, updateAll } from '../skeletons';

/*
 * How many slot symbols the device plays at the rate of its screen. The symbols of the Bzzz set
 * take turns, each at another point of its idle loop, on a grid that fills the screen. The
 * runner makes the scene hold more of them every few seconds until the frames drop.
 */

const RIGS = SYMBOL_IDS.map((id) => SYMBOLS[id].file);

export default defineTest({
    ...testInfo('how-many'),
    rigs: RIGS,
    build(context) {
        const symbols: MarrowSpine[] = [];
        const rigOf = (index: number): string => RIGS[index % RIGS.length] ?? 'animation_a';
        const resize = (count: number): void => {
            while (symbols.length < count) {
                const index = symbols.length;
                const symbol = makeSkeleton(context, rigOf(index));

                symbol.play('idle', { loop: true });
                symbol.update(phase(index) * durationOf(symbol, 'idle'));
                symbols.push(symbol);
            }
            while (symbols.length > count) symbols.pop()?.destroy();
            placeGrid(symbols, (index) => frameOf(context, rigOf(index)), context.width, context.height);
        };

        resize(context.count);

        return { step: (seconds) => updateAll(symbols, seconds), resize };
    },
});
