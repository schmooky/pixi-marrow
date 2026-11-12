#!/usr/bin/env node
/**
 * The `pixi-marrow` command line tool: `pixi-marrow info <skeleton>`,
 * `pixi-marrow typegen <skeleton>` and `pixi-marrow outlines <atlas>`. The work is done by
 * runCli from pixi-marrow/optimize.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { runCli } from '../dist/optimize.js';

/** Errors of the file system that are about the paths the user gave. They need no stack. */
const FILE_ERRORS = ['ENOENT', 'EACCES', 'EISDIR', 'ENOTDIR', 'EPERM'];

try {
    process.exitCode = await runCli(process.argv.slice(2), {
        // a copy, because Node hands out small files as views into a shared pool
        read: (path) => (path.endsWith('.json') ? readFileSync(path, 'utf8') : new Uint8Array(readFileSync(path))),
        write: (path, text) => writeFileSync(path, text),
        print: (line) => console.log(line),
        printError: (line) => console.error(line),
    });
} catch (error) {
    if (!(error instanceof Error) || !FILE_ERRORS.includes(error.code)) throw error;
    console.error(`pixi-marrow: ${error.message}`);
    process.exitCode = 1;
}
