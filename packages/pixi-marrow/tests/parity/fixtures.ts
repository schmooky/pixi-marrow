import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type SpineVersion, sniffSkeleton } from '../../src/core';
import type { RigFiles } from './official';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const cacheDir = join(root, 'fixtures/.cache');
const localDir = join(root, 'fixtures/local');
/** The symbol rigs of the slot game Bzzz, which live in the repo with the leave of their owner. */
const gameDir = join(root, 'fixtures/bzzz');

/** One skeleton file the parity suite runs on, with the atlas that goes with it. */
export interface Fixture {
    /** Unique label, for example `4.2/spineboy-pro.skel`. */
    id: string;
    /** File name without extension. A rig has one JSON and one binary fixture per version. */
    rig: string;
    version: SpineVersion;
    format: 'json' | 'binary';
    skeletonPath: string;
    atlasPath: string;
}

interface ManifestEntry {
    version: SpineVersion;
    rig: string;
    json: { path: string };
    skel: { path: string };
    atlas: { path: string };
}

// The copy matters. Node hands out small files as views into a shared pool, and the official
// binary readers ignore a view's offset: they would read the pool from its start.
const readSkeleton = (path: string): string | Uint8Array =>
    extname(path) === '.json' ? readFileSync(path, 'utf8') : new Uint8Array(readFileSync(path));

/** The official example exports listed in fixtures/manifest.json. */
function officialFixtures(): Fixture[] {
    const manifest: { files: ManifestEntry[] } = JSON.parse(readFileSync(join(root, 'fixtures/manifest.json'), 'utf8'));

    return manifest.files.flatMap((entry) => {
        const cached = (path: string): string => {
            const file = join(cacheDir, entry.version, basename(path));

            if (!existsSync(file)) throw new Error(`${path} is not downloaded. Run: pnpm fixtures`);

            return file;
        };
        const atlasPath = cached(entry.atlas.path);
        const fixture = (format: Fixture['format'], path: string): Fixture => ({
            id: `${entry.version}/${basename(path)}`,
            rig: entry.rig,
            version: entry.version,
            format,
            skeletonPath: cached(path),
            atlasPath,
        });

        return [fixture('json', entry.json.path), fixture('binary', entry.skel.path)];
    });
}

/** The atlas next to a skeleton: same name, same name without `-pro` or `-ess`, or the only atlas there. */
function atlasNextTo(skeletonPath: string): string {
    const folder = dirname(skeletonPath);
    const stem = basename(skeletonPath, extname(skeletonPath));
    const named = [stem, stem.replace(/-(pro|ess)$/, '')].map((name) => join(folder, `${name}.atlas`));
    const all = readdirSync(folder).filter((name) => name.endsWith('.atlas'));
    const atlas = named.find((path) => existsSync(path)) ?? (all.length === 1 ? join(folder, `${all[0]}`) : undefined);

    if (atlas === undefined) throw new Error(`${skeletonPath} has no atlas next to it`);

    return atlas;
}

/** The rigs of a folder: every `.json` and `.skel` under it, at any depth. Their ids start with `label`. */
function folderFixtures(folder: string, label: string): Fixture[] {
    if (!existsSync(folder)) return [];

    return readdirSync(folder, { recursive: true, encoding: 'utf8' })
        .filter((file) => file.endsWith('.json') || file.endsWith('.skel'))
        .sort()
        .map((file) => {
            const skeletonPath = join(folder, file);
            const { version, format } = sniffSkeleton(readSkeleton(skeletonPath));

            return {
                id: `${label}/${file}`,
                rig: basename(file, extname(file)),
                version,
                format,
                skeletonPath,
                atlasPath: atlasNextTo(skeletonPath),
            };
        });
}

/** Every fixture: the official examples first, then the rigs of the game in the repo, then the local rigs. */
export function listFixtures(): Fixture[] {
    return [...officialFixtures(), ...folderFixtures(gameDir, 'bzzz'), ...folderFixtures(localDir, 'local')];
}

/** Reads a fixture from disk. */
export function readFixture(fixture: Fixture): RigFiles {
    return { skeleton: readSkeleton(fixture.skeletonPath), atlas: readFileSync(fixture.atlasPath, 'utf8') };
}
