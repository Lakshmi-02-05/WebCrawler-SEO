# SEO Crawler

A small full-stack tool: paste a URL, it crawls the page and reports on
everything that matters for on-page SEO — title, meta description, Open
Graph / Twitter Card tags, headings, image alt coverage, link counts — plus
a 0–100 score and a plain-English list of issues.

## Stack & why

| Piece | Choice | Why |
|---|---|---|
| Server | **Express** | Minimal, standard, easy to read for a small API + static site |
| Fetching pages | **Axios** | Clean timeouts/error handling for hitting arbitrary third-party URLs |
| Parsing HTML | **Cheerio** | jQuery-style server-side HTML parsing — no headless browser needed since we only read static HTML |
| Storage (simple) | **JSON file** (`data/crawls.json`) | Zero setup, human-readable, easy to diff/export |
| Storage (queryable) | **SQLite** via `better-sqlite3` (`data/seo.db`) | Real SQL for filtering/sorting history without running a DB server |
| Frontend | Plain **HTML/CSS/JS** | No framework/build step requested — easy to read and modify directly |

## Project structure

```
seo-crawler/
├── server.js           # Express app entrypoint
├── routes/crawl.js      # API endpoints (/api/crawl, /api/history)
├── utils/crawler.js     # Axios + Cheerio scraping & SEO scoring logic
├── utils/jsonStore.js   # Flat JSON file persistence
├── db/db.js             # SQLite persistence (schema + queries)
├── public/               # Frontend: index.html, style.css, script.js
└── data/                 # Generated at runtime: crawls.json, seo.db (gitignored)
```

## Setup

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

`better-sqlite3` compiles a native module on install — if that step ever
fails on your machine, you can drop straight to the JSON-only storage by
removing the `db.insertCrawl(...)` line in `routes/crawl.js` and the app
still works fine.

## API

### `POST /api/crawl`
```json
{ "url": "https://example.com/page" }
```
Fetches and analyzes the page, saves the result to both JSON and SQLite,
and returns the parsed SEO data + score.

### `GET /api/history?limit=20`
Returns the most recent crawls (from SQLite), newest first.

### `GET /api/history/:id`
Returns full detail for one past crawl.

## Notes on the SEO score

The scorer in `utils/crawler.js` is intentionally simple and transparent —
it starts at 100 and deducts points for common on-page mistakes (missing
title/description, no H1 or too many H1s, missing canonical, missing
viewport tag, images without alt text, thin content under 300 words). It's
meant as a quick sanity check, not a replacement for a full SEO audit tool.

## Security notes

- Only `http://` and `https://` URLs are accepted (basic guard against
  server-side request forgery / SSRF).
- All third-party page content (titles, descriptions, etc.) is HTML-escaped
  before being inserted into the page in `script.js`, since that text comes
  from an untrusted external site and must never be treated as trusted HTML.
- SQL queries use prepared/parameterized statements (`better-sqlite3`'s
  `@name` bindings), so crawled content can never be interpreted as SQL.
