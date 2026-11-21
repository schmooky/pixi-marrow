import { afterEach, describe, expect, it, vi } from 'vitest';
import { warnOptions, warnStray } from '../../src/api/no-effect';
import { resolvePerf } from '../../src/api/presets';
import { DOCS_SITE, MarrowError, ruleDocs } from '../../src/base/errors';
import { watchContext } from '../../src/render/context-watch';

/*
 * A warning and an error lead to a docs page: the text of a warning ends with the address, and
 * a `MarrowError` has it in `docs`.
 */

afterEach(() => {
    vi.restoreAllMocks();
});

/** The texts that `console.warn` got while `run` ran. */
function warnings(run: () => void): string[] {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    run();
    const texts = warn.mock.calls.map(([text]) => String(text));

    warn.mockRestore();

    return texts;
}

describe('the docs address of an error', () => {
    it('is the page of the code for the codes that have one page', () => {
        const docs = (code: ConstructorParameters<typeof MarrowError>[0]): string | undefined =>
            new MarrowError(code, 'Cause.', { fix: 'Fix.' }).docs;

        expect(docs('unsupported-version')).toBe(`${DOCS_SITE}good-to-know/#versions`);
        expect(docs('unknown-name')).toBe(`${DOCS_SITE}guide/play/#know-the-names`);
        expect(docs('not-registered')).toBe(`${DOCS_SITE}guide/assets/#load-with-pixi-assets`);
        expect(docs('not-loaded')).toBe(`${DOCS_SITE}guide/assets/#load-with-pixi-assets`);
        expect(docs('invalid-data')).toBeUndefined();
        expect(docs('destroyed')).toBeUndefined();
    });

    it('is the address the throw gives, when it gives one', () => {
        const error = new MarrowError('unknown-name', 'Cause.', { fix: 'Fix.', docs: ruleDocs('MARROW020') });

        expect(error.docs).toBe('https://pixi-marrow.schmooky.dev/performance/rules/#marrow020');
    });
});

describe('the docs address of a warning', () => {
    it('ends the warning for options without an effect: the rule for outlines, the settings for the others', () => {
        const [outlines] = warnings(() =>
            warnOptions({ outlinesState: 'off' }, resolvePerf(undefined, { tightMesh: 'on' }), false, 'auto'),
        );
        const [instancing] = warnings(() =>
            warnOptions({}, resolvePerf(undefined, { instancing: 'auto' }), false, 'auto'),
        );

        expect(outlines).toMatch(
            /^pixi-marrow: tightMesh: 'on' has no effect, .* https:\S+\/performance\/rules\/#marrow020$/,
        );
        expect(instancing).toMatch(
            /^pixi-marrow: instancing: 'auto' has no effect, .* https:\S+\/performance\/#the-settings$/,
        );
    });

    it('ends the warning for a container that follows a bone and is no child', () => {
        const [stray] = warnings(() => warnStray({}, { parent: null }, 'hand'));

        expect(stray).toMatch(/ https:\S+\/bones-and-placeholders\/#follow-a-bone$/);
    });

    it('ends the warning of a renderer that draws no skeleton', () => {
        const renderer = {
            type: 4,
            runners: { prerender: { add: () => undefined }, postrender: { add: () => undefined } },
        };
        const [text] = warnings(() => watchContext(renderer as never));

        expect(text).toBe(
            'pixi-marrow: this renderer draws no skeleton. Use WebGL2 or WebGPU. https://pixi-marrow.schmooky.dev/good-to-know/#limits',
        );
    });
});
