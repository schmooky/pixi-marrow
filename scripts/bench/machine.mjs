/**
 * What a run of the bench says about where it ran: the machine, its power source, the browser
 * and the versions of the runtimes on both sides.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';

/** The commit the numbers belong to, with a mark when the working tree differs from it. */
function gitState(root) {
    const git = (...command) =>
        execFileSync('git', command, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

    try {
        return `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain') ? ', with local changes' : ''}`;
    } catch {
        return 'unknown';
    }
}

/**
 * What a Mac draws its power from, or an empty string where that cannot be told. On battery a
 * machine may run its CPU and its GPU slower.
 */
function powerSource() {
    if (platform() !== 'darwin') return '';
    try {
        const text = execFileSync('/usr/bin/pmset', ['-g', 'batt'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });

        return /'([^']+)'/.exec(text)?.[1] ?? '';
    } catch {
        return '';
    }
}

/** True when git ignores a path of the repo. False when it does not, or when git cannot tell. */
export function ignoredByGit(root, path) {
    try {
        execFileSync('git', ['check-ignore', '-q', path], { cwd: root, stdio: 'ignore' });

        return true;
    } catch {
        return false;
    }
}

/** The machine a run is on. `chrome` is the version of the browser that was started. */
export function describeMachine(chrome) {
    const cpu = cpus();

    return {
        cpu: cpu[0]?.model ?? 'unknown',
        cores: cpu.length,
        memoryGB: Math.round(totalmem() / 2 ** 30),
        os: `${platform()} ${release()} ${arch()}`,
        power: powerSource(),
        node: process.version,
        chrome,
    };
}

/** The versions of pixi-marrow, with its commit, and of the two official Pixi runtimes. */
export function describeVersions(root) {
    const version = (path) => JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8')).version;

    return {
        'pixi-marrow': `${version('packages/pixi-marrow')}, git ${gitState(root)}`,
        'spine-pixi-v8 for 4.2': version('packages/pixi-marrow/node_modules/spine-pixi-4.2'),
        'spine-pixi-v8 for 4.3': version('packages/pixi-marrow/node_modules/spine-pixi-4.3'),
    };
}
