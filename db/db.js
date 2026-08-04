// db/db.js
//
// WHAT: Sets up a local SQLite database file (data/seo.db) and creates the
//       "crawls" table if it doesn't exist yet.
//
// WHY SQLite + better-sqlite3 instead of a bigger DB (Postgres/MySQL)?
//   - This is a single-user local tool, not a multi-server production app.
//   - SQLite needs zero setup (no server to install/run), the whole DB is
//     one file on disk, which is perfect for a demo / internal SEO tool.
//   - better-sqlite3 is *synchronous*, which keeps the code simple to read
//     (no need for async/await or callbacks for every query) and it's one
//     of the fastest sqlite drivers for Node.
//
// If this ever needs to run on a real server with multiple users hitting it
// concurrently, swap this file out for a Postgres/MySQL client (pg / mysql2)
// - the rest of the app only talks to the functions exported below, so the
// swap wouldn't touch any other file.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Store the DB file inside /data so it's easy to find, back up, or .gitignore.
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'seo.db');

// Git doesn't track empty folders, so a fresh `git clone` of this project won't have /data yet. Create it here so the app works with zero manual
// setup steps instead of crashing on the very first run.
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// verbose: console.log lets you see the raw SQL Node executes - handy while
// debugging, remove/comment out in a "production" build to reduce noise.
const db = new Database(DB_PATH /*, { verbose: console.log } */);

// WAL (Write-Ahead Logging) mode lets reads and writes happen concurrently
// without locking the whole file - good default for any sqlite app.
db.pragma('journal_mode = WAL');

// Create the table once. "IF NOT EXISTS" makes this safe to run every time
// the server starts (idempotent migrations for a project this size).
db.exec(`
  CREATE TABLE IF NOT EXISTS crawls (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    url             TEXT    NOT NULL,
    status_code     INTEGER,
    response_time_ms INTEGER,
    title           TEXT,
    title_length    INTEGER,
    meta_description TEXT,
    meta_description_length INTEGER,
    meta_keywords   TEXT,
    canonical       TEXT,
    robots          TEXT,
    lang             TEXT,
    h1_count        INTEGER,
    word_count      INTEGER,
    images_missing_alt INTEGER,
    internal_links  INTEGER,
    external_links  INTEGER,
    og_json         TEXT,   -- stored as a JSON string (SQLite has no native JSON type)
    twitter_json    TEXT,   -- same idea for twitter card tags
    seo_score       INTEGER,
    issues_json     TEXT,   -- list of SEO warnings, stored as JSON text
    created_at      TEXT    DEFAULT (datetime('now'))
  );
`);

/**
 * Insert one crawl result and return the row that was created.
 * WHY a prepared statement: better-sqlite3 caches/compiles it, so repeated
 * inserts (e.g. crawling many URLs) are fast and safe from SQL injection
 * since values are bound, never string-concatenated into the query.
 */
function insertCrawl(record) {
  const stmt = db.prepare(`
    INSERT INTO crawls (
      url, status_code, response_time_ms, title, title_length,
      meta_description, meta_description_length, meta_keywords,
      canonical, robots, lang, h1_count, word_count,
      images_missing_alt, internal_links, external_links,
      og_json, twitter_json, seo_score, issues_json
    ) VALUES (
      @url, @statusCode, @responseTimeMs, @title, @titleLength,
      @metaDescription, @metaDescriptionLength, @metaKeywords,
      @canonical, @robots, @lang, @h1Count, @wordCount,
      @imagesMissingAlt, @internalLinks, @externalLinks,
      @ogJson, @twitterJson, @seoScore, @issuesJson
    )
  `);

  const info = stmt.run({
    url: record.url,
    statusCode: record.statusCode,
    responseTimeMs: record.responseTimeMs,
    title: record.title,
    titleLength: record.titleLength,
    metaDescription: record.metaDescription,
    metaDescriptionLength: record.metaDescriptionLength,
    metaKeywords: record.metaKeywords,
    canonical: record.canonical,
    robots: record.robots,
    lang: record.lang,
    h1Count: record.h1Count,
    wordCount: record.wordCount,
    imagesMissingAlt: record.imagesMissingAlt,
    internalLinks: record.internalLinks,
    externalLinks: record.externalLinks,
    ogJson: JSON.stringify(record.og || {}),
    twitterJson: JSON.stringify(record.twitter || {}),
    seoScore: record.seoScore,
    issuesJson: JSON.stringify(record.issues || []),
  });

  return getCrawlById(info.lastInsertRowid);
}

/** Get the most recent N crawls, newest first - powers the history list in the UI. */
function getRecentCrawls(limit = 20) {
  const stmt = db.prepare(`SELECT * FROM crawls ORDER BY id DESC LIMIT ?`);
  return stmt.all(limit).map(parseRow);
}

/** Get a single crawl by id - used for the "view details" screen. */
function getCrawlById(id) {
  const stmt = db.prepare(`SELECT * FROM crawls WHERE id = ?`);
  const row = stmt.get(id);
  return row ? parseRow(row) : null;
}

/** All history for a specific URL, so you can track SEO changes over time. */
function getCrawlsByUrl(url) {
  const stmt = db.prepare(`SELECT * FROM crawls WHERE url = ? ORDER BY id DESC`);
  return stmt.all(url).map(parseRow);
}

// Undo the JSON.stringify we did on the way in, so API consumers get real objects/arrays.
function parseRow(row) {
  return {
    ...row,
    og: JSON.parse(row.og_json || '{}'),
    twitter: JSON.parse(row.twitter_json || '{}'),
    issues: JSON.parse(row.issues_json || '[]'),
  };
}

module.exports = { insertCrawl, getRecentCrawls, getCrawlById, getCrawlsByUrl };
