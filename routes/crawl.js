// routes/crawl.js
//
// WHAT: Express router exposing the SEO crawler as a small REST API.
//   POST /api/crawl        -> crawl a URL the user submits, store + return result
//   GET  /api/history       -> list recent crawls (from SQLite - easy to query/sort)
//   GET  /api/history/:id   -> a single crawl's full detail
//
// WHY split into a router file instead of putting this in server.js:
//   Keeps server.js focused on wiring the app together (middleware, static
//   files, port), while this file owns "everything about the /api/crawl
//   feature". This is the standard Express pattern for anything beyond a
//   toy app - it keeps routes easy to find and test in isolation.

const express = require('express');
const router = express.Router();

const { crawlUrl } = require('../utils/crawler');
const jsonStore = require('../utils/jsonStore');
const db = require('../db/db');

/**
 * POST /api/crawl
 * Body: { "url": "https://example.com" }
 *
 * This is the endpoint the frontend calls the moment a user clicks
 * "Analyze SEO" on a URL - it does the actual fetch + parse + save.
 */
router.post('/crawl', async (req, res) => {
  const { url } = req.body;

  // --- Basic input validation ---------------------------------------------
  // WHY: never trust client input. A crawler is an easy way to accidentally
  // build an SSRF (Server-Side Request Forgery) tool if you let it fetch
  // *anything* the caller asks for with no checks. We keep this simple
  // (just a well-formed http/https URL check) but call out the concern.
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Request body must include a "url" string.' });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'That is not a valid URL.' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Only http:// and https:// URLs are supported.' });
  }

  try {
    // 1. Do the actual crawl + SEO parsing.
    const result = await crawlUrl(parsed.toString());

    // 2. Persist to JSON file (simple, human-readable audit trail).
    jsonStore.append(result);

    // 3. Persist to SQLite too (so it can be queried/sorted/filtered later,
    //    e.g. "show me every crawl scoring under 70").
    const saved = db.insertCrawl(result);

    // Respond with the freshly computed result (includes the DB id + timestamp).
    res.json(saved);
  } catch (err) {
    // Axios errors carry useful info in err.response / err.code - surface it
    // instead of a generic 500 so the user knows *why* the crawl failed
    // (site down, timed out, DNS not found, etc).
    const message = err.response
      ? `Target site responded with status ${err.response.status}.`
      : err.code === 'ECONNABORTED'
      ? 'Request timed out after 10 seconds.'
      : err.message;

    console.error('Crawl failed for', url, '-', message);
    res.status(502).json({ error: `Could not crawl that URL: ${message}` });
  }
});

/** GET /api/history - recent crawls, newest first, for the history list in the UI. */
router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  res.json(db.getRecentCrawls(limit));
});

/** GET /api/history/:id - full detail for one past crawl (e.g. re-opening a result). */
router.get('/history/:id', (req, res) => {
  const record = db.getCrawlById(req.params.id);
  if (!record) return res.status(404).json({ error: 'No crawl found with that id.' });
  res.json(record);
});

module.exports = router;
