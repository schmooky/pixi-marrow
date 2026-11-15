import type { APIRoute, GetStaticPaths } from 'astro';
import { type DocPage, docPages, markdownPath, pageMarkdown } from '../lib/content';

/** One Markdown file per docs page: `/guide/play.md` is the twin of `/guide/play/`. */
export const getStaticPaths: GetStaticPaths = () =>
    docPages().map((page) => ({
        params: { page: markdownPath(page.route).slice(1, -'.md'.length) },
        props: { page },
    }));

export const GET: APIRoute = ({ props }) =>
    new Response(pageMarkdown(props.page as DocPage), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
