import type { APIRoute, GetStaticPaths } from 'astro';
import { type ApiEntry, apiEntries, apiMarkdown } from '../../lib/api-reference';
import { ORIGIN } from '../../lib/seo';

/** One Markdown file per entry point of the package, for tools: `/api/core.md` next to `/api/core/`. */
export const getStaticPaths: GetStaticPaths = () =>
    apiEntries().map((entry) => ({ params: { entry: entry.slug }, props: { entry } }));

export const GET: APIRoute = ({ props }) =>
    new Response(apiMarkdown(props.entry as ApiEntry, ORIGIN), {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
