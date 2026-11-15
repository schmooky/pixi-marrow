import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * The routes of the site, read from the files of `src/pages` while the site builds. A new page
 * file is a new route here with no other change. The sitemap, the llms files and the links of
 * the landing page all start from this list.
 */

/** The folder of the site: the one that holds `src/pages`. */
export const SITE_ROOT: string = existsSync(join(process.cwd(), 'src/pages'))
    ? process.cwd()
    : join(process.cwd(), 'apps/site');

const PAGE = /\.(astro|mdx|md)$/;

function walk(folder: string, found: string[]): string[] {
    for (const name of readdirSync(join(SITE_ROOT, folder)).sort()) {
        const path = `${folder}/${name}`;

        if (statSync(join(SITE_ROOT, path)).isDirectory()) walk(path, found);
        else if (PAGE.test(name)) found.push(path);
    }

    return found;
}

/** The route of a page file, as `/guide/play/` for `src/pages/guide/play.mdx`. */
function routeOf(file: string): string {
    const path = file
        .slice('src/pages'.length)
        .replace(PAGE, '')
        .replace(/\/index$/, '');

    return `${path}/`;
}

let routes: Map<string, string> | undefined;

/** Each route of a page with a fixed address, with its source file relative to the site folder. */
export function pageRoutes(): Map<string, string> {
    if (routes === undefined) {
        routes = new Map();
        // a file with a parameter in its name makes its routes at build time, and has none here
        for (const file of walk('src/pages', [])) if (!file.includes('[')) routes.set(routeOf(file), file);
    }

    return routes;
}

/** True when the build has a page at a route such as `/faq/`. */
export const routeExists = (route: string): boolean => pageRoutes().has(route);

/** The source file of the page at a route, relative to the site folder. */
export const sourceOf = (route: string): string | undefined => pageRoutes().get(route);
