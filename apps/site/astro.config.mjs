import mdx from '@astrojs/mdx';
import { defineConfig } from 'astro/config';

export default defineConfig({
    // where the built site is served: the canonical link of every page starts with it
    site: 'https://pixi-marrow.schmooky.dev',
    trailingSlash: 'always',
    integrations: [mdx()],
    // code surfaces are dark, as the previews are
    markdown: { shikiConfig: { theme: 'github-dark-dimmed' } },
    devToolbar: { enabled: false },
    vite: {
        // the site, pixi-marrow and pixi-silk must share one copy of Pixi
        resolve: { dedupe: ['pixi.js'] },
        // A preview is imported when its frame comes into view. The dev server finds pixi-silk only
        // then, bundles it and reloads the page once. Naming both here bundles them at the start
        optimizeDeps: { include: ['pixi.js', 'pixi-silk'] },
    },
});
