# Deploy the site

The site is static. `pnpm site:build` writes it to `apps/site/dist`. The host is the Timeweb Cloud app platform, as a frontend app. The platform builds the site from `main` and serves the folder with its own web server.

## Build settings

- Build command: `pnpm run site:build`
- Folder to serve: `/apps/site/dist/`
- Node: 24

Clone the repository with its full history. The build reads the date of each page from git. A shallow clone gives every page the same date.

## Web server settings

The platform has no config file in the repository. You set these in the panel: open the app, then **Settings**, then **Web server settings**. A save starts a new deploy.

### 1. Turn SPA Fallback off

With SPA Fallback on, the server answers every unknown address with `/index.html` and status 200. A search engine then sees the home page under each wrong address. That is a soft 404.

With SPA Fallback off, the server answers an unknown address with `/404.html` and status 404. The build writes that file.

### 2. Turn compression on

Select `gzip` and `zstd`. Without compression the landing page sends about 420 KB of scripts. With it, the same scripts are about 140 KB.

### 3. Add one header

| Type | Name | Value |
|---|---|---|
| `set` | `Strict-Transport-Security` | `max-age=31536000` |

Do not set `Cache-Control` here. A header rule applies to every response, and the HTML pages must not get a long cache.

## Check after the deploy

Each line shows what a correct server answers.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://pixi-marrow.schmooky.dev/no-such-page/
```

The answer is `404`.

```bash
curl -s -o /dev/null -w "%{content_type}\n" https://pixi-marrow.schmooky.dev/robots.txt
```

The answer starts with `text/plain`.

```bash
curl -sI -H "Accept-Encoding: gzip, zstd" https://pixi-marrow.schmooky.dev/ | grep -i content-encoding
```

The answer names `gzip` or `zstd`.

## After the first correct deploy

1. Add the site to Google Search Console.
2. Submit `https://pixi-marrow.schmooky.dev/sitemap-index.xml` there.

## What the platform cannot do

The header rules have no path. So the files under `/_astro/`, which have a hash in their names, get no long cache. A CDN in front of the site can add it.
