import type { APIRoute } from 'astro';
import { llmsFull } from '../lib/content';

/** `/llms-full.txt`: every docs page as Markdown in one file, made from the MDX sources. */
export const GET: APIRoute = () =>
    new Response(llmsFull(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
