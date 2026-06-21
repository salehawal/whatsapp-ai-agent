const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const {
  validateNumbers,
  getSendStrategy,
} = require('./agent');
const {
  initBrowser,
  getQRCode,
  sendMessage,
  closeBrowser,
  getStatus,
} = require('./sender');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory send log
let sendLog = [];

/**
 * POST /api/init
 * Initialize the WhatsApp Web browser session.
 */
app.post('/api/init', async (_req, res) => {
  try {
    const result = await initBrowser();
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/qr
 * Returns the current QR code as a base64 data URL, or connection status.
 */
app.get('/api/qr', async (_req, res) => {
  try {
    const result = await getQRCode();
    res.json(result || { qr: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/status
 * Returns whether WhatsApp is currently connected.
 */
app.get('/api/status', (_req, res) => {
  res.json({ connected: getStatus() });
});

/**
 * POST /api/prepare
 * Validate numbers and get sending strategy from AI.
 * Body: { numbers: string[], message: string }
 */
app.post('/api/prepare', async (req, res) => {
  try {
    const { numbers, message } = req.body;

    const [validation, strategy] = await Promise.all([
      validateNumbers(numbers),
      getSendStrategy(numbers.length),
    ]);

    res.json({ validation, strategy });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Holds the most recent send job config submitted via POST /api/send
let pendingSendJob = null;

/**
 * POST /api/send
 * Accepts the send job config and stores it for the EventSource stream.
 * Body: { valid: string[], invalid: string[], message: string, delayMs: number }
 */
app.post('/api/send', (req, res) => {
  const { valid = [], invalid = [], message = '', delayMs = 5000 } = req.body;
  pendingSendJob = { valid, invalid, message, delayMs };
  console.log(`POST /api/send: ${valid.length} valid + ${invalid.length} invalid`);
  res.json({ success: true });
});

/**
 * GET /api/send/stream
 * EventSource endpoint that reads the stored send job and streams SSE events.
 */
app.get('/api/send/stream', async (req, res) => {
  const job = pendingSendJob;
  if (!job) {
    res.status(400).send('No pending send job. POST /api/send first.');
    return;
  }
  pendingSendJob = null; // Consume the job

  const { valid = [], invalid = [], message = '', delayMs = 5000 } = job;

  // Build the full list: invalid numbers first (skipped instantly), then valid
  const all = [
    ...invalid.map((n) => ({ number: n, type: 'invalid' })),
    ...valid.map((n) => ({ number: n, type: 'valid' })),
  ];

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  sendLog = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let aborted = false;

  req.on('close', () => {
    aborted = true;
    console.log('[stream] Client disconnected, aborting');
  });

  console.log(`[stream] Processing ${valid.length} valid + ${invalid.length} invalid...`);

  for (let i = 0; i < all.length; i++) {
    if (aborted) { console.log('[stream] Aborted by client'); break; }
    const { number, type } = all[i];

    // Emit sending event
    const sendingEvent = { type: 'sending', index: i, total: all.length, number };
    res.write(`data: ${JSON.stringify(sendingEvent)}\n\n`);

    let status, error, details;

    if (type === 'invalid') {
      status = 'skipped';
      error = 'INVALID_NUMBER';
      details = JSON.stringify({ phoneNumber: number, rootCause: 'Invalid phone number format' });
      skipped++;
    } else {
      let result;
      try {
        result = await sendMessage(number, message);
      } catch (err) {
        console.error(`UNCAUGHT error for ${number}:`, err);
        result = { success: false, error: 'UNCAUGHT: ' + err.message, details: err.stack };
      }
      status = result.success ? 'sent' : 'failed';
      error = result.error || null;
      details = result.details || null;
      if (result.success) sent++;
      else failed++;
    }

    const entry = { number, status, error, details, time: new Date().toLocaleTimeString() };
    sendLog.push(entry);
    console.log(`[${i + 1}/${all.length}] ${number}: ${status}${error && status !== 'skipped' ? ' - ' + error : ''}`);

    // Emit result event
    const resultEvent = { type: 'result', ...entry };
    try {
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify(resultEvent)}\n\n`);
      }
    } catch (_) {
      aborted = true;
      break;
    }

    // Delay between messages with keepalive heartbeats
    if (i < all.length - 1 && type !== 'invalid') {
      const heartbeat = setInterval(() => {
        if (aborted) { clearInterval(heartbeat); return; }
        try { if (!res.destroyed) res.write(': h\n\n'); } catch (_) {}
      }, 1000);
      await new Promise((r) => setTimeout(r, delayMs));
      clearInterval(heartbeat);
    }
  }

  // Emit done event
  if (!res.destroyed) {
    const doneEvent = { type: 'done', sent, failed, skipped };
    res.write(`data: ${JSON.stringify(doneEvent)}\n\n`);
    console.log('[stream] Done — sent:', sent, 'failed:', failed, 'skipped:', skipped);
    res.end();
  }
});

/**
 * GET /api/log
 * Returns the send log as JSON.
 */
app.get('/api/log', (_req, res) => {
  res.json(sendLog);
});

/**
 * GET /api/log/md
 * Downloads the send report as a Markdown file.
 */
app.get('/api/log/md', (_req, res) => {
  const now = new Date().toLocaleString();
  const sent = sendLog.filter((e) => e.status === 'sent').length;
  const failed = sendLog.filter((e) => e.status === 'failed').length;
  const skipped = sendLog.filter((e) => e.status === 'skipped').length;
  const total = sendLog.length;

  const statusIcon = (s) =>
    s === 'sent' ? '✅ Sent' : s === 'skipped' ? '⏭️ Skipped' : '❌ Failed';

  let md = `# 📱 WhatsApp Send Report\n\n`;
  md += `**Generated:** ${now}\n\n`;

  // Summary table
  md += `## Summary\n\n`;
  md += `| Metric | Count |\n`;
  md += `|--------|-------|\n`;
  md += `| **Total** | ${total} |\n`;
  md += `| **Sent** | ${sent} |\n`;
  md += `| **Failed** | ${failed} |\n`;
  md += `| **Skipped** (invalid) | ${skipped} |\n\n`;

  // Results table
  md += `## Results\n\n`;
  md += `| # | Number | Status | Time | Details |\n`;
  md += `|---|--------|--------|------|---------|\n`;

  for (let i = 0; i < sendLog.length; i++) {
    const e = sendLog[i];
    const details = e.details
      ? e.details.replace(/\n/g, ' ').substring(0, 200)
      : e.error || '-';
    md += `| ${i + 1} | \`${e.number}\` | ${statusIcon(e.status)} | ${e.time} | ${details} |\n`;
  }

  md += `\n---\n*Report auto-generated by WhatsApp AI Bulk Sender*\n`;

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="send-report.md"');
  res.send(md);
});

/**
 * GET /api/preview?url=
 * Fetches Open Graph meta tags from a URL for link preview display.
 */
app.get('/api/preview', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.json({ error: 'Missing url parameter' });

  try {
    const data = await fetchOGPreview(url);
    res.json(data);
  } catch (err) {
    res.json({ error: err.message });
  }
});

async function fetchOGPreview(pageUrl) {
  return new Promise((resolve, reject) => {
    const module = pageUrl.startsWith('https') ? https : http;
    module.get(pageUrl, { timeout: 8000 }, (resp) => {
      // Handle redirects that http.get() doesn't follow (cross-protocol)
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        const redirectUrl = resp.headers.location;
        // Resolve relative redirect
        const absoluteUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, pageUrl).href;
        // Follow the redirect with the appropriate module
        const mod = absoluteUrl.startsWith('https') ? https : http;
        mod.get(absoluteUrl, { timeout: 8000 }, (resp2) => {
          let html = '';
          resp2.setEncoding('utf8');
          resp2.on('data', (chunk) => { html += chunk; if (html.length > 50000) { resp2.destroy(); resolve(extractOG(html, absoluteUrl)); } });
          resp2.on('end', () => resolve(extractOG(html, absoluteUrl)));
          resp2.on('close', () => { if (html.length > 0) resolve(extractOG(html, absoluteUrl)); });
        }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
        return;
      }

      let html = '';
      resp.setEncoding('utf8');
      resp.on('data', (chunk) => {
        html += chunk;
        if (html.length > 50000) {
          resp.destroy();
          resolve(extractOG(html, pageUrl));
        }
      });
      resp.on('end', () => resolve(extractOG(html, pageUrl)));
      resp.on('close', () => {
        if (html.length > 0) resolve(extractOG(html, pageUrl));
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

function extractOG(html, baseUrl) {
  const decodeEntities = (str) => {
    if (!str) return str;
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d)));
  };

  const get = (prop) => {
    const re = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
    const m = html.match(re);
    if (m) return decodeEntities(m[1]);
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i');
    const m2 = html.match(re2);
    if (m2) return decodeEntities(m2[1]);
    return null;
  };

  // Resolve relative URL against base URL
  const resolveUrl = (url) => {
    if (!url) return null;
    // Non-HTTP URLs (data:, blob:, javascript:, etc.) — return as-is
    if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:') || url.startsWith('vbscript:')) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      // Upgrade http:// to https:// when the page itself is https
      if (baseUrl && baseUrl.startsWith('https') && url.startsWith('http://')) {
        return 'https://' + url.slice(7);
      }
      return url;
    }
    // Relative URL — resolve against base
    try {
      return new URL(url, baseUrl).href;
    } catch (_) {
      return url;
    }
  };

  const title = get('og:title') || get('twitter:title') || html.match(/<title>([^<]*)<\/title>/i)?.[1] || null;
  const description = get('og:description') || get('twitter:description') || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] || null;
  const image = resolveUrl(get('og:image') || get('twitter:image'));
  const siteName = get('og:site_name') || null;

  const clean = (v) => (v && v.trim()) ? v.trim() : null;
  return { title: clean(title), description: clean(description), image: clean(image), siteName: clean(siteName) };
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
