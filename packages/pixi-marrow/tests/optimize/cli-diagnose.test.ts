import { Sprite } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { RULES, serializeTree } from '../../src/diagnose';
import { type CliHost, runCli } from '../../src/optimize/cli';
import { cleanUp, spine, stageOf } from '../diagnose/scene';

/** A host that serves one text under any path and records what the tool prints. */
function textHost(text: string): CliHost & { out: string[]; errors: string[] } {
    const out: string[] = [];
    const errors: string[] = [];

    return {
        out,
        errors,
        read: () => text,
        write: () => undefined,
        print: (line) => out.push(line),
        printError: (line) => errors.push(line),
    };
}

afterEach(cleanUp);

describe('pixi-marrow rules', () => {
    it('prints every rule with its fix and its docs address', async () => {
        const host = textHost('');

        expect(await runCli(['rules'], host)).toBe(0);
        expect(host.out).toHaveLength(RULES.length);
        expect(host.out[0]).toMatch(/^MARROW001 {2}warn {2}A display object above a batched skeleton moves\n {4}Fix: /);
        expect(host.out[0]).toContain('https://pixi-marrow.schmooky.dev/performance/rules/#marrow001');
    });

    it('prints the rules as JSON with --json', async () => {
        const host = textHost('');

        expect(await runCli(['rules', '--json'], host)).toBe(0);
        expect(JSON.parse(host.out.join('\n'))).toEqual(RULES);
    });
});

describe('pixi-marrow diagnose', () => {
    async function dump(): Promise<string> {
        const owl = '4.2/owl-pro.skel';

        return JSON.stringify(
            serializeTree(stageOf(await spine(owl), new Sprite({ label: 'badge' }), await spine(owl))),
        );
    }

    it('prints one line per cause of cost of a tree dump', async () => {
        const host = textHost(await dump());

        expect(await runCli(['diagnose', 'tree.json'], host)).toBe(0);
        expect(host.out[0]).toBe('2 skeletons, 2 drawn, 2 causes of cost');
        expect(host.out[1]).toMatch(/^\[pixi-marrow:MARROW004\] "stage\/MarrowSpine\[1\]" "stage\/badge"/);
        expect(host.out[2]).toMatch(/^\[pixi-marrow:MARROW020\] /);
    });

    it('prints the diagnosis as JSON with --json, and reads a dump that came as bytes', async () => {
        const text = await dump();
        const host = textHost(text);

        host.read = () => new TextEncoder().encode(text);
        expect(await runCli(['diagnose', 'tree.bin', '--json'], host)).toBe(0);
        const result = JSON.parse(host.out.join('\n'));

        expect(result.skeletons).toBe(2);
        expect(result.hits.map((hit: { id: string }) => hit.id)).toEqual(['MARROW004', 'MARROW020']);
    });

    it.each([
        ['not JSON', 'is not JSON'],
        ['{"kind":"something else"}', 'is no tree dump'],
        ['{"kind":"pixi-marrow/tree","version":2,"pixi":"8.23.0","root":{"children":[]}}', 'is no tree dump'],
        ['null', 'is no tree dump'],
    ])('fails with a fix for a file that holds %s', async (text, message) => {
        const host = textHost(text);

        expect(await runCli(['diagnose', 'tree.json'], host)).toBe(1);
        expect(host.errors.join('\n')).toContain(message);
        expect(host.errors.join('\n')).toContain('__PIXI_MARROW__.tree()');
    });

    it('prints the usage without a file, with both commands in it', async () => {
        const host = textHost('');

        expect(await runCli(['diagnose'], host)).toBe(2);
        expect(host.errors.join('\n')).toContain('pixi-marrow diagnose <tree.json> [--json]');
        expect(host.errors.join('\n')).toContain('pixi-marrow rules [--json]');
    });
});
