#!/usr/bin/env node
/**
 * The `pixi-marrow` command line tool: `pixi-marrow info <skeleton>` and
 * `pixi-marrow typegen <skeleton>`. The work is done by runCli from pixi-marrow/optimize.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { runCli } from '../dist/optimize.js';

process.exitCode = await runCli(process.argv.slice(2), {
    // a copy, because Node hands out small files as views into a shared pool
    read: (path) => (path.endsWith('.json') ? readFileSync(path, 'utf8') : new Uint8Array(readFileSync(path))),
    write: (path, text) => writeFileSync(path, text),
    print: (line) => console.log(line),
    printError: (line) => console.error(line),
});
