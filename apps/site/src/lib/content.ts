import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { apiEntries } from './api-reference';
import { pageRoutes, SITE_ROOT } from './routes';
import { INSTALL, ORIGIN } from './seo';
import { PAGES, SECTIONS, SITE } from './site';
import { snippet } from './snippet';

/*
 * The docs as plain Markdown, made from the MDX sources while the site builds. `llms.txt` lists
 * the pages, `llms-full.txt` holds all of them, and each page has a Markdown twin at its route
 * with `.md` in place of the last slash. Nobody keeps these files by hand. A new MDX page under
 * `src/pages` with a `title` and a `description` shows in all three with no other change.
 */

/** A page of the docs, read from its MDX file. */
export interface DocPage {
    /** The route of the page, as `/guide/play/`. */
    route: string;
    /** The source file, relative to the site folder. */
    file: string;
    title: string;
    description: string;
    /** The part of the docs that lists the page, or `More` for a page that the navigation does not list. */
    section: string;
    /** The MDX text after the frontmatter. */
    body: string;
}

/** The part for pages that the navigation of `site.ts` does not list. */
const OTHER = 'More';

/** The value of a frontmatter line, without the quotes YAML allows around it. */
function unquote(value: string): string {
    const text = value.trim();
    const quote = text[0];

    if ((quote === '"' || quote === "'") && text.endsWith(quote) && text.length > 1) {
        const inner = text.slice(1, -1);

        return quote === '"' ? inner.replace(/\\"/g, '"') : inner.replace(/''/g, "'");
    }

    return text;
}

/** The frontmatter of an MDX file as plain keys, and the text after it. */
function split(text: string): { data: Record<string, string>; body: string } {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    const data: Record<string, string> = {};

    if (match === null) return { data, body: text };
    for (const line of (match[1] ?? '').split(/\r?\n/)) {
        const at = line.indexOf(':');

        if (at > 0 && !line.startsWith(' ')) data[line.slice(0, at).trim()] = unquote(line.slice(at + 1));
    }

    return { data, body: text.slice(match[0].length) };
}

let pages: DocPage[] | undefined;

/** The pages of the docs: those of the navigation in its order, then the others by route. */
export function docPages(): DocPage[] {
    if (pages !== undefined) return pages;
    const found: DocPage[] = [];

    for (const [route, file] of pageRoutes()) {
        if (!/\.mdx?$/.test(file)) continue;
        const { data, body } = split(readFileSync(join(SITE_ROOT, file), 'utf8'));

        if (data.title === undefined || data.robots === 'noindex') continue;
        const listed = PAGES.find((page) => page.href === route);

        found.push({
            route,
            file,
            title: data.title,
            description: data.description ?? listed?.description ?? '',
            section: listed?.section ?? data.section ?? OTHER,
            body,
        });
    }
    const place = (page: DocPage): number => {
        const index = PAGES.findIndex((listed) => listed.href === page.route);

        return index < 0 ? PAGES.length : index;
    };

    pages = found.sort((a, b) => place(a) - place(b) || a.route.localeCompare(b.route));

    return pages;
}

/** The docs page at a route, when the route is one. */
export const docPage = (route: string): DocPage | undefined => docPages().find((page) => page.route === route);

/** The parts of the docs that have pages, each with its pages in reading order. */
function docSections(): { section: string; pages: DocPage[] }[] {
    const all = docPages();
    const names = [
        ...SECTIONS,
        ...new Set(all.map((page) => page.section).filter((name) => !SECTIONS.some((known) => known === name))),
    ];

    return names
        .map((section) => ({ section, pages: all.filter((page) => page.section === section) }))
        .filter((part) => part.pages.length > 0);
}

/** The address of the Markdown twin of a route: `/guide/play.md` for `/guide/play/`. */
export const markdownPath = (route: string): string => `${route.replace(/\/$/, '')}.md`;

/** The value of an attribute of a component tag, written as a string or as a string in braces. */
function attribute(tag: string, name: string): string | undefined {
    const match = new RegExp(
        `\\b${name}=(?:"([^"]*)"|'([^']*)'|\\{\\s*(?:"([^"]*)"|'([^']*)'|\`([^\`]*)\`|([\\w.]+))\\s*\\})`,
    ).exec(tag);

    return match?.slice(1).find((value) => value !== undefined);
}

/** What stands in Markdown for a component: the code of a snippet, or the caption of a drawing. */
function component(tag: string, name: string, file: string, imports: Map<string, string>): string {
    if (name === 'Snippet') {
        const from = imports.get(attribute(tag, 'source') ?? '');
        const regions = attribute(tag, 'regions');

        if (from === undefined || regions === undefined) return '';
        const source = readFileSync(join(SITE_ROOT, dirname(file), from), 'utf8');

        return `\`\`\`ts\n${snippet(source, ...regions.split(' '))}\n\`\`\``;
    }
    const caption = attribute(tag, 'caption') ?? attribute(tag, 'alt') ?? attribute(tag, 'title');

    if (caption === undefined) return '';
    const kind = name === 'Diagram' ? 'Diagram' : name === 'Preview' ? 'Live preview' : name;

    return `> ${kind}: ${caption}`;
}

let facts: unknown;

/** The value of `{facts.a.b}` on a page: a number of `scripts/facts.json`, which the pages import. */
function fact(path: string): string {
    facts ??= JSON.parse(readFileSync(join(SITE_ROOT, '../../scripts/facts.json'), 'utf8'));
    let at: unknown = facts;

    for (const key of path.split('.')) {
        at = typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[key] : undefined;
    }
    if (typeof at !== 'string' && typeof at !== 'number') throw new Error(`scripts/facts.json has no value "${path}".`);

    return String(at);
}

/** MDX prose as Markdown: no imports, no comments, and each component as its code or its caption. */
function prose(text: string, file: string, imports: Map<string, string>): string {
    return text
        .replace(/^import\s[^\n]*\n?/gm, '')
        .replace(/^export\s[^\n]*\n?/gm, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/<([A-Z]\w*)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g, (tag, name: string) =>
            component(tag, name, file, imports),
        )
        .replace(/\{facts\.([\w.]+)\}/g, (_, path: string) => fact(path))
        .replace(/\]\(\/(?!\/)/g, `](${ORIGIN}/`);
}

/** The body of a docs page as Markdown, without its title. Links to the site are absolute. */
function bodyOf(page: DocPage): string {
    const imports = new Map<string, string>();

    for (const match of page.body.matchAll(/^import\s+(\w+)\s+from\s+['"]([^'"]+?)\?raw['"]/gm)) {
        imports.set(match[1] ?? '', match[2] ?? '');
    }

    // a code fence keeps its text as it is: only the prose between two fences changes
    return page.body
        .split(/(^```[\s\S]*?^```[^\n]*$)/m)
        .map((part) => (part.startsWith('```') ? part : prose(part, page.file, imports)))
        .join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** A docs page as a Markdown file of its own. */
export function pageMarkdown(page: DocPage): string {
    return `# ${page.title}\n\n> ${page.description}\n\nSource: ${ORIGIN}${page.route}\n\n${bodyOf(page)}\n`;
}

/** What `llms.txt` and `llms-full.txt` both start with: what the project is, and its facts. */
function summary(): string {
    return [
        `# ${SITE.name}`,
        '',
        '> pixi-marrow is a Spine runtime for PixiJS v8. It plays Spine 4.1, 4.2 and 4.3 skeletons on WebGL2 and WebGPU, with its own pose core and its own render path. It is an alternative to the official runtime `@esotericsoftware/spine-pixi-v8`, and it does not ship `spine-core`.',
        '',
        '## Key facts',
        '',
        `- Version: ${SITE.version}, a pre-release on the \`next\` tag of npm.`,
        `- Install: \`${INSTALL}\``,
        '- Spine versions: 4.1, 4.2 and 4.3, as JSON or binary exports. Spine 3.8 and 4.0 do not load.',
        '- PixiJS: version 8, from 8.23. `pixi.js` is the one required peer dependency.',
        '- Renderers: WebGL2 and WebGPU. Canvas 2D and WebGL1 do not work.',
        '- Entry points: `pixi-marrow` (the display object `MarrowSpine`), `pixi-marrow/core` (import and pose without Pixi, runs in Node), `pixi-marrow/optimize`, `pixi-marrow/debug`, `pixi-marrow/bake` and `pixi-marrow/perf`.',
        '- Licence: the Spine Runtimes License. Each user needs their own Spine Editor licence, as for the official runtimes.',
        `- Repository: ${SITE.repository}`,
        `- Package: ${SITE.npm}`,
        '',
    ].join('\n');
}

/** The text of `llms.txt`: the summary, then each docs page with its description, by part. */
export function llmsIndex(): string {
    const lines = [summary(), `All pages in one file: ${ORIGIN}/llms-full.txt`, ''];

    for (const { section, pages: list } of docSections()) {
        lines.push(`## ${section}`, '');
        for (const page of list)
            lines.push(`- [${page.title}](${ORIGIN}${markdownPath(page.route)}): ${page.description}`);
        lines.push('');
    }
    lines.push(
        '## Optional',
        '',
        `- [Lab](${ORIGIN}/lab/): tests that play Spine scenes on the device that opens them, and how they measure.`,
        `- [Playground](${ORIGIN}/playground/): plays the Spine files that a visitor drops on it.`,
        `- [Changelog](${ORIGIN}/changelog.md): what each version changed.`,
        ...apiEntries().map(
            (entry) =>
                `- [API of ${entry.name}](${ORIGIN}/api/${entry.slug}.md): every export of the entry \`${entry.name}\`.`,
        ),
        '',
    );

    return lines.join('\n');
}

/** The text of `llms-full.txt`: the summary, then every docs page as Markdown, by part. */
export function llmsFull(): string {
    const parts = [summary()];

    for (const { section, pages: list } of docSections()) {
        for (const page of list) parts.push(`---\n\nSection: ${section}\n\n${pageMarkdown(page)}`);
    }

    return parts.join('\n');
}
