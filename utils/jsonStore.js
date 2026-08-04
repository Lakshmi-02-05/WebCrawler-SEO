// utils/jsonStore.js
//
// WHAT: Appends every crawl result to a single JSON file (data/crawls.json)
//       as a simple array, and can read it back.
//
// WHY have this *in addition to* SQLite?
//   - The task asked for JSON storage "of course" as the default, with SQL
//     as an extra if needed. Many small tools/scripts/exports just want a
//     flat JSON file they can `cat`, diff in git, or hand to another script
//     - no query engine required.
//   - SQLite (db/db.js) is better when you need to *query* the data later
//     (filter by score, search by domain, paginate a big history, etc).
//   - Keeping both shows the trade-off: JSON = simple & portable,
//     SQL = queryable & scales better. Real projects often start with JSON
//     and "graduate" to SQL once the data/query needs grow - this repo shows
//     both ends of that path side by side.
//
// NOTE: Reading + rewriting the whole file on every save is fine for a
// personal tool doing dozens/hundreds of crawls. If this needs to handle
// thousands of records with frequent writes, that's exactly the signal to
// drop this file and rely on db/db.js (SQLite) instead - real DBs handle
// concurrent writes safely; a hand-rolled JSON file does not.

const fs = require('fs');
const path = require('path');

const JSON_PATH = path.join(__dirname, '..', 'data', 'crawls.json');

// Make sure the file exists before we ever try to read it, so a fresh
// checkout of this project works with zero manual setup steps.
function ensureFile() {
  const dir = path.dirname(JSON_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); // fresh clone has no /data yet
  if (!fs.existsSync(JSON_PATH)) {
    fs.writeFileSync(JSON_PATH, '[]', 'utf-8');
  }
}

/** Read every stored crawl result. */
function readAll() {
  ensureFile();
  const raw = fs.readFileSync(JSON_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    // If the file ever gets corrupted (e.g. manual edit gone wrong),
    // fail safe instead of crashing the whole server.
    console.error('crawls.json was unreadable, starting fresh:', err.message);
    return [];
  }
}

/** Append one new result and persist it to disk. */
function append(record) {
  const all = readAll();
  all.push(record);
  fs.writeFileSync(JSON_PATH, JSON.stringify(all, null, 2), 'utf-8');
  return record;
}

module.exports = { readAll, append };
