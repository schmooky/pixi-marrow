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
    '  pixi-marrow outlines <atlas> [--out <file>] [--pages <dir>]',
    '      Write the tight outlines and opaque rectangles of an atlas as JSON, and print what they save.',
    '      Without --out the file lands next to the atlas, as <name>.outlines.json.',
    '      The tool reads PNG only. For an atlas with WebP or AVIF pages, --pages names the folder',
    '      with the PNG sources of the pages: hero.webp is read from <dir>/hero.png.',
    '',
    '<skeleton> is a .json or .skel file exported from Spine 4.1, 4.2 or 4.3.',
    '<atlas> is a .atlas file. Its page images are PNG files in the same folder, or in --pages <dir>.',
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

/** The name of a file without its folders and its extension: `art/hero@2x.webp` gives `hero@2x`. */
function baseName(path: string): string {
    const file = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
    const dot = file.lastIndexOf('.');

    return dot <= 0 ? file : file.slice(0, dot);
}

/** The names of the image formats that a page can be named as and that the tool does not read. */
const FORMATS: Readonly<Record<string, string>> = { webp: 'WebP', avif: 'AVIF' };

/** The image format that bytes hold when it is one the tool does not read, or undefined. */
function otherFormat(bytes: Uint8Array): string | undefined {
    const tag = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));

    if (tag(0) === 'RIFF' && tag(8) === 'WEBP') return 'WebP';
    if (tag(4) === 'ftyp') return tag(8).startsWith('avi') ? 'AVIF' : 'HEIF';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'JPEG';

    return undefined;
}

/** The error for a page image in a format the tool does not read. It tells of `--pages`. */
function notPng(name: string, format: string, atlas: string): MarrowError {
    return new MarrowError(
        'invalid-data',
        `The page image "${name}" is ${format}, not PNG. pixi-marrow outlines reads PNG only.`,
        {
            fix: `Pass the folder with the PNG sources of the pages, at the size the atlas states: pixi-marrow outlines ${atlas} --pages <dir>. The tool reads "${name}" from <dir>/${baseName(name)}.png.`,
        },
    );
}

/** The pixels of one page: from the PNG next to the atlas, or from the PNG of the same base name in `--pages`. */
async function readPage(
    host: CliHost,
    atlasPath: string,
    name: string,
    pages: string | undefined,
): Promise<PagePixels> {
    const path =
        pages === undefined ? pagePath(atlasPath, name) : `${pages.replace(/[/\\]+$/, '')}/${baseName(name)}.png`;
    const extension = /\.(webp|avif|jpe?g)$/i.exec(name)?.[1];

    // a page that is named as another format is not read at all without --pages
    if (pages === undefined && extension !== undefined)
        throw notPng(name, FORMATS[extension.toLowerCase()] ?? 'JPEG', atlasPath);
    let bytes: string | Uint8Array;

    try {
        bytes = host.read(path);
    } catch (error) {
        if (pages === undefined) throw error;
        throw new MarrowError(
            'invalid-data',
            `The PNG source of the page "${name}" was not read from ${path}: ${error instanceof Error ? error.message : String(error)}`,
            { fix: `Put the PNG that the page "${name}" was made from into ${pages}, as ${baseName(name)}.png.` },
        );
    }
    if (typeof bytes === 'string') {
        throw new MarrowError('invalid-data', `The page image "${name}" was read as text.`, {
            fix: 'Name a PNG file as the page image in the atlas.',
        });
    }
    const format = otherFormat(bytes);

    if (format !== undefined) throw notPng(name, format, atlasPath);

    return decodePng(bytes, name);
}

async function runOutlines(args: readonly string[], file: string, host: CliHost): Promise<number> {
    const text = host.read(file);
    const atlas = importAtlas(typeof text === 'string' ? text : new TextDecoder().decode(text));
    const pages: PagePixels[] = [];
    const folder = option(args, '--pages');

    for (const page of atlas.pages) pages.push(await readPage(host, file, page.name, folder));
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
 * await runCli(['outlines', 'dist/hero.webp.atlas', '--pages', 'raw'], host); // reads raw/hero.png
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
