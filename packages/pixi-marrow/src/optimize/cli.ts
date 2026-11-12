import { MarrowError } from '../base/errors';
import { importAtlas } from '../formats/atlas';
import { importSkeleton } from '../formats/import';
import { buildAtlasOutlines, type PagePixels, summarizeOutlines } from '../geometry/outlines';
import { describeSkeleton } from '../model/info';
import type { AtlasOutlines } from '../model/outlines';
import { decodePng } from './png';
import { generateNames, typeNameFor } from './typegen';

/** What the command line tool needs from its host. The `pixi-marrow` binary passes Node's file system. */
export interface CliHost {
    /** Reads a file. Text for `.json`, bytes for everything else. */
    read(path: string): string | Uint8Array;
    /** Writes a text file. */
    write(path: string, text: string): void;
    /** Prints a line to standard output. */
    print(line: string): void;
    /** Prints a line to standard error. */
    printError(line: string): void;
}

const USAGE = [
    'usage:',
    '  pixi-marrow info <skeleton>',
    '      Print the names, counts and features of a skeleton as JSON.',
    '  pixi-marrow typegen <skeleton> [--out <file>] [--name <TypeName>]',
    '      Write a TypeScript type that lists every name of a skeleton.',
    '  pixi-marrow outlines <atlas> [--out <file>]',
    '      Write the tight outlines and opaque rectangles of an atlas as JSON, and print what they save.',
    '      Without --out the file lands next to the atlas, as <name>.outlines.json.',
    '',
    '<skeleton> is a .json or .skel file exported from Spine 4.1, 4.2 or 4.3.',
    '<atlas> is a .atlas file. Its page images are PNG files in the same folder.',
].join('\n');

/** The value after `flag` in `args`, or undefined. */
function option(args: readonly string[], flag: string): string | undefined {
    const at = args.indexOf(flag);

    return at === -1 ? undefined : args[at + 1];
}

/** The path of a page image: its name in the atlas is relative to the folder of the atlas. */
function pagePath(atlasPath: string, pageName: string): string {
    return atlasPath.slice(0, Math.max(atlasPath.lastIndexOf('/'), atlasPath.lastIndexOf('\\')) + 1) + pageName;
}

/** Where the outlines of an atlas are written by default: `hero.atlas` gives `hero.outlines.json`. */
function outlinesPath(atlasPath: string): string {
    return `${atlasPath.replace(/\.atlas$/, '')}.outlines.json`;
}

/** One region per line: small enough to ship, and a change shows as one line in a diff. */
function outlinesJson(outlines: AtlasOutlines): string {
    const { regions, ...head } = outlines;
    const lines = regions.map((region) => JSON.stringify(region));

    return `${JSON.stringify(head).slice(0, -1)},"regions":[\n${lines.join(',\n')}\n]}\n`;
}

async function readPage(host: CliHost, path: string, name: string): Promise<PagePixels> {
    const bytes = host.read(path);

    if (typeof bytes === 'string') {
        throw new MarrowError('invalid-data', `The page image "${name}" was read as text.`, {
            fix: 'Name a PNG file as the page image in the atlas.',
        });
    }

    return decodePng(bytes, name);
}

async function runOutlines(args: readonly string[], file: string, host: CliHost): Promise<number> {
    const text = host.read(file);
    const atlas = importAtlas(typeof text === 'string' ? text : new TextDecoder().decode(text));
    const pages: PagePixels[] = [];

    for (const page of atlas.pages) pages.push(await readPage(host, pagePath(file, page.name), page.name));
    const outlines = buildAtlasOutlines(atlas, pages);
    const out = option(args, '--out') ?? outlinesPath(file);

    host.write(out, outlinesJson(outlines));
    host.print(JSON.stringify({ file: out, ...summarizeOutlines(atlas, outlines) }, null, 2));

    return 0;
}

async function runSkeleton(
    command: 'info' | 'typegen',
    args: readonly string[],
    file: string,
    host: CliHost,
): Promise<number> {
    const info = describeSkeleton(await importSkeleton(host.read(file)));

    if (command === 'info') {
        host.print(JSON.stringify(info, null, 2));

        return 0;
    }
    const source = generateNames(info, { typeName: option(args, '--name') ?? typeNameFor(file), source: file });
    const out = option(args, '--out');

    if (out === undefined) host.print(source);
    else host.write(out, source);

    return 0;
}

async function run(args: readonly string[], host: CliHost): Promise<number> {
    const [command, file] = args;

    if (file !== undefined && !file.startsWith('--')) {
        if (command === 'info' || command === 'typegen') return runSkeleton(command, args, file, host);
        if (command === 'outlines') return runOutlines(args, file, host);
    }
    host.printError(USAGE);

    return 2;
}

/**
 * Runs the `pixi-marrow` command line tool. Returns the exit code: 0 on success, 1 when a
 * skeleton, an atlas or a page image cannot be read, 2 when the arguments are wrong.
 *
 * @example
 * const code = await runCli(['typegen', 'hero.skel', '--out', 'hero.names.ts'], host);
 * await runCli(['outlines', 'art/hero.atlas'], host); // writes art/hero.outlines.json
 */
export async function runCli(args: readonly string[], host: CliHost): Promise<number> {
    try {
        return await run(args, host);
    } catch (error) {
        if (!(error instanceof MarrowError)) throw error;
        host.printError(error.message);

        return 1;
    }
}
