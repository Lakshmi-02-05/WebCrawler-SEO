// public/script.js
//
// WHAT: All frontend behavior - no framework, just the DOM APIs, since the
// brief asked for plain HTML/CSS/JS. It:
//   1. Listens for the form submit ("customer clicks" analyze).
//   2. Calls our own backend (POST /api/crawl) - the browser never talks to
//      the target site directly (that would hit CORS walls on most sites
//      anyway) - the Node server does the fetching server-side.
//   3. Renders the returned SEO data into the page.
//   4. Loads + renders crawl history from the server on page load.

const form = document.getElementById('crawl-form');
const urlInput = document.getElementById('url-input');
const crawlBtn = document.getElementById('crawl-btn');
const errorMsg = document.getElementById('error-msg');
const loadingMsg = document.getElementById('loading-msg');
const resultsEl = document.getElementById('results');
const historyList = document.getElementById('history-list');

form.addEventListener('submit', async (e) => {
  e.preventDefault(); // don't let the browser do a full page reload on submit
  await runCrawl(urlInput.value.trim());
});

async function runCrawl(url) {
  hide(errorMsg);
  hide(resultsEl);
  show(loadingMsg);
  crawlBtn.disabled = true;

  try {
    const res = await fetch('/api/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();

    if (!res.ok) {
      // Server sent back a structured { error: "..." } - show it plainly.
      throw new Error(data.error || 'Something went wrong.');
    }

    renderResult(data);
    await loadHistory(); // refresh the list so the new crawl shows up immediately
  } catch (err) {
    errorMsg.textContent = err.message;
    show(errorMsg);
  } finally {
    hide(loadingMsg);
    crawlBtn.disabled = false;
  }
}

function renderResult(data) {
  const scoreClass = data.seo_score >= 80 ? 'score-good' : data.seo_score >= 50 ? 'score-warn' : 'score-bad';

  const issuesHtml = data.issues && data.issues.length
    ? `<ul class="issues-list">${data.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
    : `<p class="no-issues">No major issues found ✅</p>`;

  const ogImage = data.og && data.og.image;
  const ogPreviewHtml = ogImage
    ? `
      <div class="og-preview">
        <img src="${escapeAttr(ogImage)}" alt="Open Graph preview image" onerror="this.remove()" />
        <div class="og-body">
          <div class="og-title">${escapeHtml(data.og.title || data.title || '')}</div>
          <div class="og-desc">${escapeHtml(data.og.description || data.meta_description || '')}</div>
        </div>
      </div>
    `
    : '';

  resultsEl.innerHTML = `
    <div class="card">
      <div class="result-header">
        <h2>${escapeHtml(data.url)}</h2>
        <span class="score-badge ${scoreClass}">${data.seo_score}/100</span>
      </div>

      <div class="field-grid">
        ${field('Status Code', data.status_code)}
        ${field('Response Time', `${data.response_time_ms} ms`)}
        ${field('Title', data.title || '(none)')}
        ${field('Title Length', `${data.title_length} chars`)}
        ${field('Meta Description', data.meta_description || '(none)')}
        ${field('Description Length', `${data.meta_description_length} chars`)}
        ${field('Canonical URL', data.canonical || '(none)')}
        ${field('Robots Meta', data.robots || '(none)')}
        ${field('Language', data.lang || '(none)')}
        ${field('H1 Count', data.h1_count)}
        ${field('Word Count', data.word_count)}
        ${field('Images Missing Alt', data.images_missing_alt)}
        ${field('Internal Links', data.internal_links)}
        ${field('External Links', data.external_links)}
      </div>

      <h3>Issues</h3>
      ${issuesHtml}

      ${ogPreviewHtml ? `<h3>Social Share Preview (Open Graph)</h3>${ogPreviewHtml}` : ''}
    </div>
  `;
  show(resultsEl);
}

function field(label, value) {
  return `
    <div class="field">
      <span class="label">${escapeHtml(label)}</span>
      <span class="value">${escapeHtml(String(value))}</span>
    </div>
  `;
}

async function loadHistory() {
  try {
    const res = await fetch('/api/history?limit=15');
    const items = await res.json();

    if (!items.length) {
      historyList.textContent = 'No crawls yet - analyze a URL above to get started.';
      return;
    }

    historyList.innerHTML = items
      .map(
        (item) => `
        <div class="history-item">
          <span class="h-url">${escapeHtml(item.url)}</span>
          <span class="h-meta">score ${item.seo_score}/100 · ${formatDate(item.created_at)}</span>
        </div>
      `
      )
      .join('');
  } catch (err) {
    historyList.textContent = 'Could not load history.';
  }
}

function formatDate(sqliteUtcString) {
  // SQLite's datetime('now') returns UTC without a timezone suffix; add "Z"
  // so the browser's Date parser treats it as UTC and converts to local time.
  const d = new Date(sqliteUtcString.replace(' ', 'T') + 'Z');
  return d.toLocaleString();
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

// Minimal HTML-escaping helpers so titles/descriptions pulled from arbitrary
// third-party sites can never inject markup/scripts into our own page (XSS).
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(str) {
  return escapeHtml(str);
}

// Load history as soon as the page opens.
loadHistory();
