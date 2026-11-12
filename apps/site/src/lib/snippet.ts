/**
 * The text of marked regions of a source file, for a code block on a page.
 *
 * A page imports a file of `src/snippets` or `src/previews` as text and shows regions of it. The
 * same file is type-checked against the built package, so a page cannot show code that does not
 * compile. A region is what stands between `// #region name` and the next `// #endregion`.
 *
 * @param source The text of the file.
 * @param regions The names of the regions, in the order they are shown. An empty line joins two.
 */
export function snippet(source: string, ...regions: string[]): string {
    return regions.map((name) => region(source, name)).join('\n\n');
}

function region(source: string, name: string): string {
    const lines = source.split('\n');
    const start = lines.findIndex((line) => line.trim() === `// #region ${name}`);
    const length = lines.slice(start + 1).findIndex((line) => line.trim() === '// #endregion');

    if (start < 0 || length < 0) throw new Error(`The source has no region "${name}".`);
    const body = lines.slice(start + 1, start + 1 + length);
    const indent = Math.min(...body.filter((line) => line.trim() !== '').map((line) => line.search(/\S/)));

    return body
        .map((line) => line.slice(indent))
        .join('\n')
        .trim();
}
