# timebase-web

The web app for Timebase. Deploys to https://timebase.cc via Cloudflare Pages.

## Stack

Static HTML + vanilla JS + one CSS file. No build, no bundler, no framework.

## Local development

```sh
cd web
python3 -m http.server 8000
open http://localhost:8000
```

## Deploy

Push `main` to `github.com/timebaseapp/timebase-web`. Cloudflare Pages auto-deploys the directory root.

Manual deploy with wrangler:

```sh
npx wrangler pages deploy . --project-name=timebase
```

## Files

- `index.html` — the single page
- `app.js` — store + scrub + render
- `styles.css` — palette + type + layout
- `cities.json` — bundled city list (mirrors `data/cities.json`)
- `icon.svg` — app icon (bisected circle)
- `_headers` — Cloudflare Pages headers
