import type { APIRoute } from 'astro';
import { llmsIndex } from '../lib/content';

/** `/llms.txt`: what the project is, its facts, and a link to each docs page as Markdown. */
export const GET: APIRoute = () =>
    new Response(llmsIndex(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
