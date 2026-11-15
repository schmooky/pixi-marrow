import type { APIRoute } from 'astro';

/*
 * `/robots.txt`: every crawler may read every page. The crawlers of search engines and of answer
 * engines each get a group of their own, so that a reader of the file sees the choice was made.
 */

const CRAWLERS = [
    'GPTBot',
    'OAI-SearchBot',
    'ChatGPT-User',
    'ClaudeBot',
    'Claude-SearchBot',
    'Claude-User',
    'PerplexityBot',
    'Perplexity-User',
    'Google-Extended',
    'CCBot',
    'Bingbot',
];

export const GET: APIRoute = ({ site }) => {
    const groups = ['*', ...CRAWLERS].map((agent) => `User-agent: ${agent}\nAllow: /\n`);
    const sitemap = `Sitemap: ${new URL('/sitemap-index.xml', site).href}\n`;

    return new Response([...groups, sitemap].join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
