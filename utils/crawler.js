// utils/crawler.js
//
// WHAT: The actual "crawler". Given a URL, it:
//   1. Fetches the raw HTML with Axios.
//   2. Loads it into Cheerio (a jQuery-like API for parsing HTML on the
//      server - much faster/lighter than spinning up a real browser like
//      Puppeteer, and it's all we need since we only READ the static HTML,
//      we don't need to run the page's JS or take screenshots).
//   3. Pulls out every tag that matters for SEO: <title>, meta description,
//      meta keywords, canonical link, robots directive, Open Graph tags,
//      Twitter Card tags, heading structure, image alt coverage, and a
//      rough internal/external link count.
//   4. Runs a few simple rules over that data to produce a 0-100 "SEO score"
//      and a list of human-readable issues, e.g. "Meta description is
//      missing" or "Title is too long (should be under ~60 characters)".
//
// WHY Axios (not fetch): Axios gives us easy timeouts, automatic JSON/
// header handling, and clearer error objects (err.response.status etc),
// which matters a lot for a crawler hitting arbitrary third-party sites
// that may be slow, redirect, or return non-200 codes.

const axios = require('axios');
const cheerio = require('cheerio');

// Some sites block requests that don't look like they came from a browser.
// Sending a normal User-Agent avoids being blocked purely for looking like a bot.
const USER_AGENT =
  'Mozilla/5.0 (compatible; SEOCrawlerBot/1.0; +https://example.com/bot)';

/**
 * Fetch + analyze a single URL.
 * Returns a plain object matching the shape both jsonStore and db.js expect.
 */
async function crawlUrl(targetUrl) {
  const startedAt = Date.now();

  // --- 1. Fetch the page -----------------------------------------------
  const response = await axios.get(targetUrl, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 10000, // 10s - don't let one slow/hanging site block the server forever
    // Accept any status < 500 so we can still report on 404s, redirects, etc.
    // instead of Axios throwing and us losing the chance to show useful info.
    validateStatus: (status) => status < 500,
    maxRedirects: 5,
  });

  const responseTimeMs = Date.now() - startedAt;
  const html = response.data;

  // --- 2. Parse with Cheerio --------------------------------------------
  const $ = cheerio.load(html);

  // --- 3. Extract SEO fields ---------------------------------------------
  const title = $('title').first().text().trim();

  // Meta tags are matched by their `name` or `property` attribute.
  const getMeta = (name) =>
    $(`meta[name="${name}"]`).attr('content') ||
    $(`meta[property="${name}"]`).attr('content') ||
    '';

  const metaDescription = getMeta('description').trim();
  const metaKeywords = getMeta('keywords').trim();
  const robots = getMeta('robots').trim();
  const canonical = $('link[rel="canonical"]').attr('href') || '';
  const lang = $('html').attr('lang') || '';
  const viewport = getMeta('viewport').trim();
  const charset = $('meta[charset]').attr('charset') || '';
  const favicon =
    $('link[rel="icon"]').attr('href') ||
    $('link[rel="shortcut icon"]').attr('href') ||
    '';

  // Open Graph tags (used by Facebook/LinkedIn/etc when a link is shared)
  const og = {
    title: getMeta('og:title'),
    description: getMeta('og:description'),
    image: getMeta('og:image'),
    url: getMeta('og:url'),
    type: getMeta('og:type'),
  };

  // Twitter Card tags (used when a link is shared on Twitter/X)
  const twitter = {
    card: getMeta('twitter:card'),
    title: getMeta('twitter:title'),
    description: getMeta('twitter:description'),
    image: getMeta('twitter:image'),
  };

  // Heading structure - having exactly one H1 is a classic on-page SEO rule.
  const h1Count = $('h1').length;
  const h1Texts = $('h1')
    .map((_, el) => $(el).text().trim())
    .get();

  // Word count of the visible body text - a rough proxy for "thin content".
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.length ? bodyText.split(' ').length : 0;

  // Images missing alt text hurt both accessibility and image-search SEO.
  let imagesMissingAlt = 0;
  $('img').each((_, el) => {
    const alt = $(el).attr('alt');
    if (!alt || !alt.trim()) imagesMissingAlt += 1;
  });

  // Rough internal vs external link count, based on hostname comparison.
  let internalLinks = 0;
  let externalLinks = 0;
  const pageHost = safeHostname(targetUrl);
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return;
    }
    const linkHost = safeHostname(href, targetUrl);
    if (linkHost && pageHost && linkHost === pageHost) internalLinks += 1;
    else externalLinks += 1;
  });

  // --- 4. Score + issues ---------------------------------------------------
  const { seoScore, issues } = scoreSeo({
    title,
    metaDescription,
    h1Count,
    canonical,
    viewport,
    imagesMissingAlt,
    wordCount,
    statusCode: response.status,
  });

  return {
    url: targetUrl,
    statusCode: response.status,
    responseTimeMs,
    title,
    titleLength: title.length,
    metaDescription,
    metaDescriptionLength: metaDescription.length,
    metaKeywords,
    canonical,
    robots,
    lang,
    viewport,
    charset,
    favicon,
    h1Count,
    h1Texts,
    wordCount,
    imagesMissingAlt,
    internalLinks,
    externalLinks,
    og,
    twitter,
    seoScore,
    issues,
    crawledAt: new Date().toISOString(),
  };
}

/** Safely pull a hostname out of a URL, resolving relative links against the page URL. */
function safeHostname(href, base) {
  try {
    return new URL(href, base).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Very small, transparent rule-based scorer - not meant to be a definitive
 * SEO audit, just enough to flag the most common on-page mistakes at a glance.
 * Starts at 100 and subtracts points for each issue found.
 */
function scoreSeo({
  title,
  metaDescription,
  h1Count,
  canonical,
  viewport,
  imagesMissingAlt,
  wordCount,
  statusCode,
}) {
  const issues = [];
  let score = 100;

  if (statusCode !== 200) {
    issues.push(`Page returned HTTP ${statusCode} instead of 200.`);
    score -= 20;
  }
  if (!title) {
    issues.push('Missing <title> tag.');
    score -= 15;
  } else if (title.length > 60) {
    issues.push('Title is longer than ~60 characters and may get truncated in search results.');
    score -= 5;
  } else if (title.length < 15) {
    issues.push('Title is very short - consider making it more descriptive.');
    score -= 3;
  }

  if (!metaDescription) {
    issues.push('Missing meta description.');
    score -= 15;
  } else if (metaDescription.length > 160) {
    issues.push('Meta description is longer than ~160 characters and may get truncated.');
    score -= 5;
  } else if (metaDescription.length < 50) {
    issues.push('Meta description is quite short - aim for ~50-160 characters.');
    score -= 3;
  }

  if (h1Count === 0) {
    issues.push('No <h1> found on the page.');
    score -= 10;
  } else if (h1Count > 1) {
    issues.push(`Found ${h1Count} <h1> tags - best practice is exactly one per page.`);
    score -= 5;
  }

  if (!canonical) {
    issues.push('No canonical link tag - can lead to duplicate-content issues.');
    score -= 5;
  }

  if (!viewport) {
    issues.push('No responsive viewport meta tag found - may hurt mobile SEO.');
    score -= 5;
  }

  if (imagesMissingAlt > 0) {
    issues.push(`${imagesMissingAlt} image(s) missing alt text.`);
    score -= Math.min(10, imagesMissingAlt); // cap the penalty
  }

  if (wordCount < 300) {
    issues.push('Page body has fewer than 300 words - may be considered "thin content".');
    score -= 5;
  }

  return { seoScore: Math.max(0, score), issues };
}

module.exports = { crawlUrl };
