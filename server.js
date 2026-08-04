// WHAT: The main entrypoint. Boots an Express server that:
//   - serves the static frontend (public/) - the form the customer uses
//   - exposes the SEO crawler API under /api
//
// WHY Express: it's the de-facto standard minimal web framework for
// Node.js - small, unopinionated, huge ecosystem, and perfect for a
// tool this size (a couple of routes + static files).

const express = require('express');
const cors = require('cors');
const path = require('path');

const crawlRoutes = require('./routes/crawl');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ------------------------------------------------------------

// Parse incoming JSON bodies (so req.body.url works in routes/crawl.js).
app.use(express.json());

// CORS: allows the frontend to call this API even if it's ever served from
// a different origin/port during development (e.g. a separate dev server).
// Safe to leave on for this kind of internal/demo tool.
app.use(cors());

// Serve everything in /public directly (index.html, style.css, script.js).
// WHY: no build step (no React/webpack) was requested - plain HTML/CSS/JS
// is simplest to read, run, and modify for a tool like this.
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ------------------------------------------------------------

// Every crawler-related endpoint lives under /api (see routes/crawl.js).
app.use('/api', crawlRoutes);

// Simple health check - useful once this is deployed anywhere, so a load
// balancer / uptime monitor has something to ping.
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// --- Start ------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`SEO crawler running at http://localhost:${PORT}`);
});
