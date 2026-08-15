# car-scanner

A PWA where the user points their phone camera at a car, takes a photo, and gets back the make, model, year (range), a few key facts, an estimated price range, and 2–3 reference photos pulled from the web so they can visually confirm the AI's guess against the real thing.

Single Cloudflare Worker (Workers Static Assets) serving both the PWA frontend and the `/api/identify` backend — same origin, no CORS to manage.

## Repo structure

```
/src
  worker.ts     # Worker entry point, routes requests
  identify.ts   # /api/identify handler
  anthropic.ts  # Claude vision + facts/price calls
  google.ts     # Google Custom Search image lookup
  types.ts      # shared types
/public
  index.html
  manifest.json
  service-worker.js
  app.js        # camera capture + UI logic
  styles.css
  icons/        # placeholder PWA icons
wrangler.toml
```

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. **Anthropic API key** — get one from the [Anthropic Console](https://console.anthropic.com/).

3. **Google Custom Search** (for reference photos) — this is a manual setup dependency, not something the code can do for you:
   - Create a [Programmable Search Engine](https://programmablesearchengine.google.com/) with image search enabled and "search the entire web" turned on. Note its Search Engine ID (`cx`).
   - Get an API key with the [Custom Search JSON API](https://developers.google.com/custom-search/v1/overview) enabled from the Google Cloud Console. Free tier is ~100 queries/day.
   - If these aren't configured, the app still works — it just returns identification, facts, and price with an empty reference-photo list.

4. **Local development** — copy `.dev.vars.example` to `.dev.vars` and fill in your keys (this file is git-ignored), then:
   ```
   npm run dev
   ```

5. **Deploy** — set secrets on your Cloudflare account once, then deploy:
   ```
   npx wrangler secret put ANTHROPIC_API_KEY
   npx wrangler secret put GOOGLE_CSE_API_KEY
   npx wrangler secret put GOOGLE_CSE_CX
   npm run deploy
   ```

## How it works

`POST /api/identify` takes a base64 JPEG (client-resized to ~1200px, quality 0.8) and:

1. Calls Claude (`claude-sonnet-5`, vision) with a strict JSON schema (structured outputs) to identify make/model/year-range/confidence. Low-confidence or non-car photos return a clear "couldn't identify" response instead of a confident-sounding guess.
2. In parallel, calls Claude again with the web search tool for a few facts + a price estimate, and calls the Google Custom Search API for 2–3 reference photos.
3. Merges everything into one response. If the facts or image lookups fail, the response still succeeds with an empty facts list or reference-photo list — a single degraded dependency doesn't fail the whole scan.

## Out of scope for v1

- Scan history / persistence
- User accounts or auth
- Live camera viewfinder (`getUserMedia`)
- Offline identification
- Precise single-year identification (year ranges only)
