# Deploy the site

The site is static. `pnpm site:build` writes it to `apps/site/dist`, and a web server sends those files. This file holds the server configuration that the site needs. The owner of the server applies it. Nothing in the repo does.

## What is wrong today

On 15 November 2026 the live server answers every unknown address with the home page and status 200. So `/robots.txt`, `/sitemap-index.xml`, `/llms.txt` and a mistyped address all return the HTML of the landing page. A search engine reads that as many copies of one page. The server also sends no compression, no cache headers and no HSTS header.

The build now writes `robots.txt`, `sitemap-index.xml`, `llms.txt`, `llms-full.txt`, one `.md` file per docs page and `404.html`. They help only when the server sends real files and a real 404.

## Build

1. Clone the repo with its full history. The build reads the date of each page from git, and a shallow clone gives every page the same date.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm site:build`.
4. Point the server at `apps/site/dist`.

Without git the build still passes. The pages then show no date, and the sitemap has no `lastmod`.

## Caddy configuration

Replace the site block of the Caddyfile with this one. Change the path after `root` to the folder that holds the built site.

```caddyfile
pixi-marrow.schmooky.dev {
	root * /srv/pixi-marrow/dist
	encode zstd gzip

	header Strict-Transport-Security "max-age=31536000; includeSubDomains"
	header X-Content-Type-Options "nosniff"

	@hashed path /_astro/*
	header @hashed Cache-Control "public, max-age=31536000, immutable"

	@rigs path /rigs/*
	header @rigs Cache-Control "public, max-age=604800"

	@pages not path /_astro/* /rigs/*
	header @pages Cache-Control "public, max-age=0, must-revalidate"

	@markdown path *.md
	header @markdown Content-Type "text/markdown; charset=utf-8"

	try_files {path} {path}/index.html =404
	file_server

	handle_errors {
		header Strict-Transport-Security "max-age=31536000; includeSubDomains"
		header Cache-Control "no-store"
		@missing expression `{err.status_code} == 404`
		handle @missing {
			rewrite * /404.html
			file_server
		}
		handle {
			respond "{err.status_code} {err.status_text}"
		}
	}
}
```

What each part does:

| Part | Effect |
|---|---|
| `try_files {path} {path}/index.html =404` | The server sends a file that exists, or the `index.html` of a folder. Any other address is an error 404. |
| `handle_errors` | An error 404 sends `404.html` with status 404. The page is not the home page. |
| `encode zstd gzip` | The server compresses text files. The landing page loads about 420 KB of JavaScript before compression. |
| `/_astro/*` | The names of these files hold a hash of their content. A browser can keep them for a year. |
| `/rigs/*` | The names of the demo skeletons and their images do not change. A browser keeps them for a week. |
| All other files | A browser asks the server each time, so a new deploy shows at once. |
| `Strict-Transport-Security` | A browser uses HTTPS for this host for a year. |

Check the file with `caddy validate --config <path of the Caddyfile>` before you reload Caddy. Nobody ran this block on a server yet.

Remove any older line that sends unknown addresses to `/index.html`, such as `try_files {path} /index.html`. That line is the cause of the status 200.

The HSTS header names `includeSubDomains`. Remove that word if another host under the same name must stay on plain HTTP.

## Check after the deploy

Run these commands against the live site:

```bash
curl -sI https://pixi-marrow.schmooky.dev/no-such-page/ | head -n 1
curl -sI https://pixi-marrow.schmooky.dev/robots.txt | grep -i content-type
curl -s https://pixi-marrow.schmooky.dev/sitemap-index.xml | head -c 200
curl -sI https://pixi-marrow.schmooky.dev/start.md | grep -i content-type
curl -sI -H "Accept-Encoding: zstd, gzip" https://pixi-marrow.schmooky.dev/ | grep -i -E "content-encoding|strict-transport|cache-control"
curl -sI https://pixi-marrow.schmooky.dev/rigs/symbols.atlas | grep -i cache-control
```

The results must be:

1. The first line is `HTTP/2 404`.
2. `robots.txt` has the type `text/plain`.
3. The sitemap starts with `<?xml`.
4. `start.md` has the type `text/markdown`.
5. The home page has a `content-encoding`, a `strict-transport-security` and a `cache-control` header.
6. The atlas has `max-age=604800`.

Add the site to Google Search Console and Bing Webmaster Tools only after the first check passes. Then submit `https://pixi-marrow.schmooky.dev/sitemap-index.xml` there.

## What the build makes for search engines

| File | Source |
|---|---|
| `sitemap-index.xml`, `sitemap-0.xml` | Every built page that does not carry `noindex`, with the date of its last commit. |
| `robots.txt` | `src/pages/robots.txt.ts`. It allows every crawler and names the sitemap. |
| `llms.txt`, `llms-full.txt`, `<route>.md` | `src/lib/content.ts` makes them from the MDX sources on every build. |
| `404.html` | `src/pages/404.astro`. |
| `og.png`, `favicon.ico`, `apple-touch-icon.png`, `icon-512.png` | Static files in `public`, drawn from the mark in `favicon.svg`. |

The titles and descriptions for search results are in `src/lib/seo.ts`, one entry per route. A new MDX page under `src/pages` with a `title` and a `description` needs no other change. The sitemap, the llms files and its Markdown twin pick it up. Add an entry to `src/lib/seo.ts` when its title must name Spine and PixiJS in at most 60 characters.
