<div align="center">

# Timebase &nbsp;·&nbsp; web

#### *The browser side of [timebase.cc](https://timebase.cc).*

[Visit](https://timebase.cc) &nbsp;·&nbsp; [iOS](https://github.com/timebaseapp/ios) &nbsp;·&nbsp; [@amrith](https://x.com/amrith)

</div>

---

A small world clock that lives in a browser tab. Scroll, drag, or scrub to see what time it'll be anywhere. Same palette, same paper grain, same rhythm as the iOS app — but lighter, instant, link-friendly.

No framework. No build step. Just HTML, one CSS file, one JS file.

## What's where

```
.
├── index.html          // the page
├── app.js              // store · scrub · render
├── styles.css          // palette · typography · layout
├── cities.json         // the bundled city list
├── icon.svg            // app mark
├── grain.png           // paper texture (shared with iOS)
├── privacy.html        // Privacy + Terms
├── support.html        // FAQ + contact
├── legal.css           // styling for the two pages above
├── _headers            // Cloudflare Pages cache + security
└── _redirects          // /terms → /privacy#terms
```

## Run it

```sh
python3 -m http.server 8000
open http://localhost:8000
```

That's the whole local-dev story. Edit, refresh, repeat.

## Ship it

Push to `main`. Cloudflare Pages auto-deploys to [`timebase.cc`](https://timebase.cc) within a minute. To push manually:

```sh
npx wrangler pages deploy . --project-name=timebase
```

---

<div align="center">

*Crafted by [@amrith](https://x.com/amrith) in Amsterdam.*

</div>
