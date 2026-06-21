const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');

let client = null;
let isReady = false;
let latestQrDataUrl = null;
let qrResolve = null; // Resolver so getQRCode can wait for the first QR

// Debug log buffer
let debugBuffer = [];
function debug(...args) {
  const msg = args.join(' ');
  console.log(msg);
  debugBuffer.push(msg);
}
function clearDebugBuffer() { debugBuffer = []; }

function detectChromePath() {
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
       'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
         '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/snap/bin/chromium',
          '/snap/bin/chromium-browser',
        ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  return null;
}

const CHROME_PATH = detectChromePath();

/** Remove stale Chrome lock files from whatsapp-web.js session directory */
function cleanStaleLocks() {
  const dir = './.wwebjs_auth';
  if (!fs.existsSync(dir)) return;
  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'LOCK'];
  const walk = (p) => {
    try {
      const entries = fs.readdirSync(p, { withFileTypes: true });
      for (const e of entries) {
        const full = p + '/' + e.name;
        if (e.isDirectory()) walk(full);
        else if (lockFiles.includes(e.name)) {
          fs.unlinkSync(full);
          debug(`[clean] Removed stale lock: ${full}`);
        }
      }
    } catch (_) {}
  };
  walk(dir);
}

async function initBrowser() {
  cleanStaleLocks();

  if (client) {
    debug('[init] Client already exists, destroying old one...');
    try { await client.destroy(); } catch (e) {}
    client = null;
    isReady = false;
    latestQrDataUrl = null;
  }

  return new Promise((resolve) => {
    debug('[init] Creating whatsapp-web.js Client with LocalAuth...');

    client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
      },
    });

    client.on('qr', async (qrString) => {
      debug('[init] QR code received, converting to base64...');
      try {
        latestQrDataUrl = await qrcode.toDataURL(qrString);
        debug('[init] QR ready for display');
      } catch (err) {
        debug('[init] QR conversion error: ' + err.message);
      }
      // Resolve the init promise if it hasn't been resolved yet
      if (qrResolve) {
        qrResolve();
        qrResolve = null;
      }
    });

    client.on('ready', () => {
      debug('[init] Client is READY — authenticated and connected');
      isReady = true;
      latestQrDataUrl = null;
      if (qrResolve) {
        qrResolve();
        qrResolve = null;
      }
    });

    client.on('auth_failure', (msg) => {
      debug('[init] Auth failure: ' + (msg || 'unknown'));
      isReady = false;
      if (qrResolve) {
        qrResolve();
        qrResolve = null;
      }
    });

    client.on('disconnected', (reason) => {
      debug('[init] Disconnected: ' + reason);
      isReady = false;
    });

    // Create a promise that resolves when first QR or ready fires
    const firstEvent = new Promise((r) => { qrResolve = r; });

    // Start initialization
    client.initialize().catch((err) => {
      debug('[init] Initialize error: ' + err.message);
      isReady = false;
      if (qrResolve) {
        qrResolve();
        qrResolve = null;
      }
    });

    // Wait for the first QR or ready event
    firstEvent.then(() => {
      debug('[init] First event received, connected=' + isReady);
      resolve({ success: true, connected: isReady });
    });

    // Timeout safety — resolve after 60s no matter what
    setTimeout(() => {
      if (qrResolve) {
        qrResolve();
        qrResolve = null;
      }
      resolve({ success: true, connected: isReady });
    }, 60000);
  });
}

async function getQRCode() {
  if (isReady) {
    return { connected: true };
  }
  if (latestQrDataUrl) {
    return { qr: latestQrDataUrl };
  }
  // No QR yet and not connected
  return { qr: null };
}

async function sendMessage(phoneNumber, message) {
  clearDebugBuffer();
  const msg = message || '';

  if (!isReady || !client) {
    debug('[send] Client not ready');
    return {
      success: false,
      error: 'WHATSAPP_NOT_CONNECTED',
      details: JSON.stringify({ phoneNumber, rootCause: 'WhatsApp session not connected or expired' }),
    };
  }

  // Normalize phone number — strip non-digits and international prefix (00/+), add @c.us suffix
  let cleanNumber = phoneNumber.replace(/\D/g, '');
  if (cleanNumber.startsWith('00')) cleanNumber = cleanNumber.slice(2);
  const chatId = `${cleanNumber}@c.us`;

  debug(`[send] Sending to ${cleanNumber} (${msg.length} chars)...`);

  try {
    const result = await client.sendMessage(chatId, msg, { linkPreview: true });
    debug(`[send] Message sent successfully (id: ${result.id._serialized})`);
    return { success: true };
  } catch (err) {
    debug(`[send] Failed: ${err.message}`);
    const logs = debugBuffer.join('\n');
    return {
      success: false,
      error: err.message,
      details: JSON.stringify({
        phoneNumber,
        rootCause: err.message,
        debugLogs: logs.substring(0, 1000),
      }),
    };
  }
}

async function closeBrowser() {
  if (client) {
    try { await client.destroy(); } catch (e) {}
    client = null;
  }
  isReady = false;
  latestQrDataUrl = null;
  debug('[close] Client destroyed');
}

function getStatus() {
  return isReady;
}

module.exports = { initBrowser, getQRCode, sendMessage, closeBrowser, getStatus };
