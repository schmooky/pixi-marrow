import { MarrowError } from '../base/errors';
import { importSkeleton } from '../formats/import';
import { describeSkeleton } from '../model/info';
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
    '',
    '<skeleton> is a .json or .skel file exported from Spine 4.1, 4.2 or 4.3.',
].join('\n');

/** The value after `flag` in `args`, or undefined. */
function option(args: readonly string[], flag: string): string | undefined {
    const at = args.indexOf(flag);

    return at === -1 ? undefined : args[at + 1];
}

async function run(args: readonly string[], host: CliHost): Promise<number> {
    const [command, file] = args;

    if ((command !== 'info' && command !== 'typegen') || file === undefined || file.startsWith('--')) {
        host.printError(USAGE);

        return 2;
    }
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

/**
 * Runs the `pixi-marrow` command line tool. Returns the exit code: 0 on success, 1 when the
 * skeleton cannot be read, 2 when the arguments are wrong.
 *
 * @example
 * const code = await runCli(['typegen', 'hero.skel', '--out', 'hero.names.ts'], host);
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
