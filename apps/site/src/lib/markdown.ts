/*
 * A small Markdown renderer for text that the build reads from the repo: the changelog of the
 * package and the JSDoc of its declarations. It knows headings, paragraphs, lists inside lists,
 * code fences, code spans, links, bold text and the `{@link}` tag of JSDoc. It escapes all other
 * text, so a `<` of a type never becomes a tag.
 */

/** A heading that {@link renderMarkdown} found, as the layout of the docs lists it. */
export interface Heading {
    depth: number;
    slug: string;
    text: string;
}

/** What {@link renderMarkdown} can be told. */
export interface MarkdownOptions {
    /** The address for the name in a `{@link Name}` tag, or undefined when the name has no page. */
    link?: (name: string) => string | undefined;
    /** Added to the depth of each heading, so that `##` of a file can be a `<h2>` or lower. */
    shift?: number;
    /** The id of a heading from its text. Without it a heading has no id. */
    slug?: (text: string, depth: number) => string | undefined;
}

/** Text as HTML text: the characters that HTML reads as markup are escaped. */
function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** One line of Markdown as HTML: code spans, links, bold text and `{@link}` tags. */
function inlineMarkdown(text: string, options: MarkdownOptions = {}): string {
    const kept: string[] = [];
    const keep = (html: string): string => `\uE000${kept.push(html) - 1}\uE000`;
    const marked = text
        .replace(/\[((?:[^\]\\]|\\.)+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) =>
            keep(`<a href="${escapeHtml(href)}">${inlineMarkdown(label, options)}</a>`),
        )
        .replace(/\{@link\s+([^}|\s]+)(?:\s*\|\s*|\s+)?([^}]*)\}/g, (_, name: string, label: string) => {
            const href = options.link?.(name);
            const shown = `<code>${escapeHtml(label.trim() === '' ? name : label.trim())}</code>`;

            return keep(href === undefined ? shown : `<a href="${escapeHtml(href)}">${shown}</a>`);
        })
        .replace(/`([^`]+)`/g, (_, code: string) => keep(`<code>${escapeHtml(code)}</code>`));

    return escapeHtml(marked)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\uE000(\d+)\uE000/g, (_, index: string) => kept[Number(index)] ?? '');
}

/** The text of one line of Markdown without its marks, for a list of headings. */
function plain(text: string): string {
    return text
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[`*]/g, '')
        .trim();
}

const ITEM = /^(\s*)[-*]\s+(.*)$/;
const indentOf = (line: string): number => line.search(/\S/);

/**
 * Markdown as HTML, with the headings that it holds.
 *
 * @param text The Markdown text.
 * @param options How to link names and how to name headings.
 */
export function renderMarkdown(text: string, options: MarkdownOptions = {}): { html: string; headings: Heading[] } {
    const headings: Heading[] = [];

    return { html: blocks(text.replace(/\r\n/g, '\n').split('\n'), options, headings), headings };
}

/** What the block readers share: the lines of the text, the options and the headings found so far. */
interface Reading {
    lines: string[];
    options: MarkdownOptions;
    headings: Heading[];
}

/** A block that a reader found: its HTML, and the index of the first line after it. */
interface Block {
    html: string;
    next: number;
}

const isFence = (line: string): boolean => line.trim().startsWith('```');
const isHeading = (line: string): boolean => /^#{1,6}\s/.test(line);

/** A code fence that starts at a line, or undefined. */
function fence({ lines }: Reading, at: number): Block | undefined {
    if (!isFence(lines[at] ?? '')) return undefined;
    const end = lines.findIndex((other, index) => index > at && isFence(other));
    const last = end < 0 ? lines.length : end;

    return { html: `<pre><code>${escapeHtml(lines.slice(at + 1, last).join('\n'))}</code></pre>`, next: last + 1 };
}

/** A heading on a line, or undefined. */
function heading({ lines, options, headings }: Reading, at: number): Block | undefined {
    const found = /^(#{1,6})\s+(.*)$/.exec(lines[at] ?? '');

    if (found === null) return undefined;
    const depth = Math.min(6, (found[1] ?? '').length + (options.shift ?? 0));
    const label = plain(found[2] ?? '');
    const slug = options.slug?.(label, depth);
    const id = slug === undefined ? '' : ` id="${escapeHtml(slug)}"`;

    if (slug !== undefined) headings.push({ depth, slug, text: label });

    return { html: `<h${depth}${id}>${inlineMarkdown(found[2] ?? '', options)}</h${depth}>`, next: at + 1 };
}

/** True when the line at an index still belongs to a list item whose mark has the given indent. */
function inItem(lines: string[], at: number, indent: number): boolean {
    const line = lines[at] ?? '';

    if (line.trim() !== '') return indentOf(line) > indent;
    // an empty line stays in the item when the next line with text lies deeper than the mark
    const after = lines.slice(at).find((other) => other.trim() !== '');

    return after !== undefined && indentOf(after) > indent;
}

/** A list that starts at a line, or undefined. An item holds the lines that lie deeper than its mark. */
function list(reading: Reading, at: number): Block | undefined {
    const { lines } = reading;

    if (!ITEM.test(lines[at] ?? '')) return undefined;
    const indent = indentOf(lines[at] ?? '');
    const items: string[] = [];
    let next = at;

    for (;;) {
        const first = ITEM.exec(lines[next] ?? '');

        if (first === null || indentOf(lines[next] ?? '') !== indent) break;
        const body = [first[2] ?? ''];

        for (next++; next < lines.length && inItem(lines, next, indent); next++) {
            const line = lines[next] ?? '';

            body.push(line.slice(Math.min(indent + 2, Math.max(0, indentOf(line)))));
        }
        items.push(`<li>${item(body, reading)}</li>`);
    }

    return { html: `<ul>${items.join('')}</ul>`, next };
}

/** The paragraph that starts at a line: the lines up to an empty line or another kind of block. */
function paragraph({ lines, options }: Reading, at: number): Block {
    const end = lines.findIndex(
        (line, index) => index > at && (line.trim() === '' || ITEM.test(line) || isHeading(line) || isFence(line)),
    );
    const next = end < 0 ? lines.length : end;
    const text = lines
        .slice(at, next)
        .map((line) => line.trim())
        .join(' ');

    return { html: `<p>${inlineMarkdown(text, options)}</p>`, next };
}

function blocks(lines: string[], options: MarkdownOptions, headings: Heading[]): string {
    const reading: Reading = { lines, options, headings };
    const out: string[] = [];
    let at = 0;

    while (at < lines.length) {
        if ((lines[at] ?? '').trim() === '') {
            at++;
            continue;
        }
        const block = fence(reading, at) ?? heading(reading, at) ?? list(reading, at) ?? paragraph(reading, at);

        out.push(block.html);
        at = block.next;
    }

    return out.join('\n');
}

/** The content of a list item. An item of one paragraph has no `<p>` around its text. */
function item(lines: string[], reading: Reading): string {
    const html = blocks(lines, reading.options, reading.headings);
    const single = /^<p>([\s\S]*?)<\/p>/.exec(html);

    if (single === null) return html;

    return (single[1] ?? '') + html.slice(single[0].length);
}
