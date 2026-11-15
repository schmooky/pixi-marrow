import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RULES, RULES_DOCS } from '../../src/diagnose';
import { ruleOf } from '../../src/diagnose/hits';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('the catalogue of the performance rules', () => {
    it('has the ids MARROW001 to MARROW025 in order, each with its docs address', () => {
        expect(RULES).toHaveLength(25);
        RULES.forEach((rule, index) => {
            expect(rule.id).toBe(`MARROW${String(index + 1).padStart(3, '0')}`);
            expect(rule.docs).toBe(`${RULES_DOCS}#${rule.id.toLowerCase()}`);
            expect(rule.slug).toMatch(/^[a-z0-9-]+$/);
            expect(ruleOf(rule.id)).toBe(rule);
        });
        expect(new Set(RULES.map((rule) => rule.slug)).size).toBe(RULES.length);
        expect(() => ruleOf('MARROW999')).toThrow('MARROW999');
    });

    it('keeps the id MARROW026 retired: no rule has it, and the docs page keeps its heading', () => {
        const page = read('../../../../apps/site/src/pages/performance/rules.mdx');

        expect(() => ruleOf('MARROW026')).toThrow('MARROW026');
        expect(page).toContain('\n## Retired rules\n');
        expect(page).toContain('\n### MARROW026\n');
        expect(page).not.toContain('\n## MARROW026\n');
    });

    it('is the data of perf-rules.json, which the package ships', () => {
        const shipped = JSON.parse(read('../../perf-rules.json'));

        expect(shipped).toMatchObject({ kind: 'pixi-marrow/perf-rules', version: 1, docs: RULES_DOCS });
        expect(shipped.rules).toEqual(RULES);
    });

    it('names a source file that exists for every rule of the runtime', () => {
        for (const rule of RULES) {
            if (rule.source.startsWith('pixi.js')) continue;
            expect(() => read(`../../${rule.source}`), rule.id).not.toThrow();
        }
    });

    it('has a heading on the docs page for every rule', () => {
        const page = read('../../../../apps/site/src/pages/performance/rules.mdx');

        for (const rule of RULES) expect(page).toContain(`\n## ${rule.id}\n`);
    });

    it('keeps Pixi out of the modules that the command line tool loads', () => {
        for (const file of ['static', 'order', 'skeleton-rules', 'hits', 'rules-data', 'types']) {
            const source = read(`../../src/diagnose/${file}.ts`);

            expect(source, file).not.toMatch(/from '(pixi\.js|\.\.\/(api|render)\/[^']*)'/);
        }
    });
});
