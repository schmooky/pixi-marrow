import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importAtlas } from '../../src/formats/atlas';
import { buildAtlasOutlines, readAtlasOutlines, summarizeOutlines } from '../../src/geometry/outlines';
import { type CliHost, runCli } from '../../src/optimize/cli';
import { listAtlasFixtures, loadAtlasFixture } from '../geometry/outline-checks';
import { encodePng } from './png-encoder';

type RecordingHost = CliHost & { out: string[]; errors: string[]; files: Map<string, string>; reads: string[] };

/** A host that records what the tool reads, prints and writes. */
function hostOf(read: (path: string) => string | Uint8Array): RecordingHost {
    const out: string[] = [];
    const errors: string[] = [];
    const files = new Map<string, string>();
    const reads: string[] = [];

    return {
        out,
        errors,
        files,
        reads,
        read: (path) => {
            reads.push(path);

            return read(path);
        },
        write: (path, text) => files.set(path, text),
        print: (line) => out.push(line),
        printError: (line) => errors.push(line),
    };
}

/** A host on the real files, as the `pixi-marrow` binary gives one. */
const diskHost = (): RecordingHost =>
    hostOf((path) => (path.endsWith('.json') ? readFileSync(path, 'utf8') : new Uint8Array(readFileSync(path))));

/** An atlas of one page with one region, and its page: 8x8 pixels with an opaque block of 4x4 in the middle. */
const ATLAS_TEXT = 'page.png\nsize: 8, 8\nfilter: Linear, Linear\nblock\nbounds: 0, 0, 8, 8\n';
const samples = Uint8Array.from({ length: 8 * 8 * 4 }, (_, i) => {
    const x = (i >> 2) % 8;
    const y = i >> 5;

    return x >= 2 && x < 6 && y >= 2 && y < 6 ? 255 : 0;
});
const PAGE = encodePng({ width: 8, height: 8, colorType: 6, samples, filters: [4] });

/** A host with the small atlas under any folder. */
const smallHost = (page: string | Uint8Array = PAGE): RecordingHost =>
    hostOf((path) => (path.endsWith('.atlas') || path.endsWith('.txt') ? new TextEncoder().encode(ATLAS_TEXT) : page));

function fixture(id: string) {
    const found = listAtlasFixtures().find((candidate) => candidate.id === id);

    if (found === undefined) throw new Error(`no fixture ${id}. Run: pnpm fixtures`);

    return found;
}

describe('runCli outlines', () => {
    it('writes the outlines of an atlas next to it and prints what they save', async () => {
        const spineboy = fixture('4.2/spineboy.atlas');
        const { atlas, pages } = await loadAtlasFixture(spineboy);
        const expected = buildAtlasOutlines(atlas, pages);
        const host = diskHost();
        const out = spineboy.path.replace(/\.atlas$/, '.outlines.json');

        expect(await runCli(['outlines', spineboy.path], host)).toBe(0);
        expect([...host.files.keys()]).toEqual([out]);
        expect(readAtlasOutlines(JSON.parse(host.files.get(out) ?? ''), atlas)).toEqual(expected);
        expect(JSON.parse(host.out.join('\n'))).toEqual({ file: out, ...summarizeOutlines(atlas, expected) });
        expect(host.errors).toEqual([]);
    });

    it('reads every page of an atlas with several pages', async () => {
        const dragon = fixture('4.2/dragon.atlas');
        const host = diskHost();

        expect(await runCli(['outlines', dragon.path, '--out', 'dragon.json'], host)).toBe(0);
        expect(host.reads.filter((path) => path.endsWith('.png'))).toHaveLength(5);
        expect(JSON.parse(host.out.join('\n'))).toMatchObject({ file: 'dragon.json', regions: 40, skippedPages: 0 });
    });

    it('writes one region per line, in a file that ends with a line break', async () => {
        const host = smallHost();

        expect(await runCli(['outlines', 'art/hero.atlas'], host)).toBe(0);
        expect(host.files.get('art/hero.outlines.json')).toBe(
            [
                '{"version":1,"margin":1,"opaqueMargin":1,"regions":[',
                '{"name":"block","rect":{"x":0,"y":0,"width":8,"height":8},"polygon":[1,1,7,1,7,7,1,7],"triangles":[0,1,2,0,2,3],"coverage":0.5625,"opaque":null}',
                ']}',
                '',
            ].join('\n'),
        );
        expect(JSON.parse(host.out.join('\n'))).toEqual({
            file: 'art/hero.outlines.json',
            regions: 1,
            outlined: 1,
            empty: 0,
            opaque: 0,
            skippedPages: 0,
            quadArea: 64,
            outlineArea: 36,
            savedArea: 28,
            savedShare: 0.4375,
        });
    });

    it('looks for the page images in the folder of the atlas', async () => {
        const cases = [
            ['art/hero.atlas', 'art/page.png', 'art/hero.outlines.json'],
            ['hero.atlas', 'page.png', 'hero.outlines.json'],
            ['C:\\art\\hero.atlas', 'C:\\art\\page.png', 'C:\\art\\hero.outlines.json'],
            ['/abs/dir.atlas/hero.atlas.txt', '/abs/dir.atlas/page.png', '/abs/dir.atlas/hero.atlas.txt.outlines.json'],
        ];

        for (const [atlasPath = '', pagePath, outPath] of cases) {
            const host = smallHost();

            expect(await runCli(['outlines', atlasPath], host)).toBe(0);
            expect(host.reads).toEqual([atlasPath, pagePath]);
            expect([...host.files.keys()]).toEqual([outPath]);
        }
    });

    it('writes where --out says, and takes an atlas the host read as text', async () => {
        const host = hostOf((path) => (path.endsWith('.atlas') ? ATLAS_TEXT : PAGE));

        expect(await runCli(['outlines', 'hero.atlas', '--out', 'build/outlines.json'], host)).toBe(0);
        expect([...host.files.keys()]).toEqual(['build/outlines.json']);
        expect(
            readAtlasOutlines(JSON.parse(host.files.get('build/outlines.json') ?? ''), importAtlas(ATLAS_TEXT)).regions,
        ).toHaveLength(1);
    });

    it('prints the error and returns 1 for a page image it cannot read', async () => {
        const notPng = smallHost(new TextEncoder().encode('not an image'));
        const text = smallHost('not an image');
        const wrongSize = smallHost(
            encodePng({ width: 4, height: 4, colorType: 6, samples: new Uint8Array(64), filters: [0] }),
        );

        expect(await runCli(['outlines', 'hero.atlas'], notPng)).toBe(1);
        expect(notPng.errors.join('\n')).toContain(
            '[pixi-marrow:invalid-data] The image "page.png" is not a valid PNG file',
        );
        expect(await runCli(['outlines', 'hero.atlas'], text)).toBe(1);
        expect(text.errors.join('\n')).toContain('The page image "page.png" was read as text.');
        expect(await runCli(['outlines', 'hero.atlas'], wrongSize)).toBe(1);
        expect(wrongSize.errors.join('\n')).toContain('has 4x4 pixels and the atlas states 8x8');
        for (const host of [notPng, text, wrongSize]) expect(host.files.size).toBe(0);
    });

    it('lets the error of a missing file through', async () => {
        const host = hostOf((path) => {
            if (path.endsWith('.png')) throw new Error(`ENOENT: ${path}`);

            return ATLAS_TEXT;
        });

        await expect(runCli(['outlines', 'art/hero.atlas'], host)).rejects.toThrow('ENOENT: art/page.png');
    });

    it('prints the usage and returns 2 without an atlas', async () => {
        for (const args of [['outlines'], ['outlines', '--out', 'x.json']]) {
            const host = smallHost();

            expect(await runCli(args, host)).toBe(2);
            expect(host.errors.join('\n')).toContain('pixi-marrow outlines <atlas> [--out <file>]');
            expect(host.reads).toEqual([]);
        }
    });
});
