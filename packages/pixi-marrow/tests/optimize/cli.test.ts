import { describe, expect, it } from 'vitest';
import { type CliHost, runCli } from '../../src/optimize/cli';
import { listFixtures, readFixture } from '../parity/fixtures';

/** A host that serves one fixture under any path and records what the tool prints and writes. */
function fakeHost(id: string): CliHost & { out: string[]; errors: string[]; files: Map<string, string> } {
    const fixture = listFixtures().find((candidate) => candidate.id === id);

    if (!fixture) throw new Error(`no fixture ${id}`);
    const out: string[] = [];
    const errors: string[] = [];
    const files = new Map<string, string>();

    return {
        out,
        errors,
        files,
        read: () => readFixture(fixture).skeleton,
        write: (path, text) => files.set(path, text),
        print: (line) => out.push(line),
        printError: (line) => errors.push(line),
    };
}

describe('runCli', () => {
    it('prints a description of a skeleton as JSON', async () => {
        const host = fakeHost('4.2/spineboy-pro.skel');

        expect(await runCli(['info', 'spineboy-pro.skel'], host)).toBe(0);
        const info = JSON.parse(host.out.join('\n'));

        expect(info.version).toBe('4.2');
        expect(info.counts.bones).toBe(67);
        expect(info.animations.map((animation: { name: string }) => animation.name)).toContain('run');
    });

    it('prints generated names, with a type name taken from the file name', async () => {
        const host = fakeHost('4.3/spineboy-pro.json');

        expect(await runCli(['typegen', 'art/spineboy-pro.json'], host)).toBe(0);
        expect(host.out.join('\n')).toContain('export type SpineboyProNames = {');
        expect(host.out.join('\n')).toContain('"run"');
    });

    it('writes generated names to a file with the given type name', async () => {
        const host = fakeHost('4.1/spineboy-pro.skel');

        expect(await runCli(['typegen', 'hero.skel', '--name', 'Hero', '--out', 'hero.names.ts'], host)).toBe(0);
        expect(host.out).toEqual([]);
        expect(host.files.get('hero.names.ts')).toContain('export type Hero = {');
    });

    it('prints the usage and returns 2 for wrong arguments', async () => {
        for (const args of [[], ['info'], ['bake', 'hero.skel'], ['typegen', '--out']]) {
            const host = fakeHost('4.2/spineboy-pro.skel');

            expect(await runCli(args, host)).toBe(2);
            expect(host.errors.join('\n')).toContain('usage:');
        }
    });

    it('prints the error and returns 1 for a file that is not a skeleton', async () => {
        const host = fakeHost('4.2/spineboy-pro.skel');

        host.read = () => '{"not":"a skeleton"}';
        expect(await runCli(['info', 'broken.json'], host)).toBe(1);
        expect(host.errors.join('\n')).toContain('[pixi-marrow:invalid-data]');
    });

    it('lets errors that are not about the skeleton through', async () => {
        const host = fakeHost('4.2/spineboy-pro.skel');

        host.read = () => {
            throw new Error('disk on fire');
        };
        await expect(runCli(['info', 'hero.skel'], host)).rejects.toThrow('disk on fire');
    });
});
