# 🤖 WhatsApp Bulk Sender

Send bulk WhatsApp messages through your real WhatsApp account with a live progress dashboard and detailed Markdown reports.

---

## Features

- **📱 WhatsApp Web Integration** — Uses `whatsapp-web.js` to send messages through your real WhatsApp account. Secure session persistence via QR scan (no credentials stored).
- **🔢 Phone Number Validation** — Phone numbers are automatically cleaned and validated (strips non-digits, assumes Egypt +20). Invalid numbers are skipped.
- **⏱️ Smart Send Strategy** — Automatically recommends safe delays and batch sizes based on your list size to prevent rate-limiting.
- **🔗 Link Preview** — Automatically detects URLs in your message and loads their Open Graph preview (title, description, image) in real-time.
- **⏭️ Skip Invalid Numbers** — Invalid phone numbers are skipped automatically and logged in the report. Only valid numbers are sent to.
- **📈 Live Dashboard** — Real-time progress bar, stats (Total / Pending / Sent / Failed / Skipped), and per-number log table.
- **📥 Markdown Reports** — Download a clean, human-readable `.md` report after sending. Includes summary stats and per-number results with emoji status icons.
- **💾 Session Persistence** — Scan QR once. The session is saved and auto-restored on next startup.
- **🔄 Auto-Reconnect** — If the session drops, a reconnect button appears. No need to restart.

---

## Requirements

- **Node.js** 18+
- **Google Chrome or Chromium** (auto-detected on Linux, macOS, Windows)

---

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url>
cd whatsapp-ai-agent
npm install
```

### 2. Start the server

```bash
npm run dev
```

Or without auto-restart:

```bash
npm start
```

### 3. Open the app

Navigate to [http://localhost:3000](http://localhost:3000)

---

## Usage Guide

### Step 1: Connect WhatsApp

1. Click **"Connect WhatsApp"**
2. A QR code appears on screen
3. Open WhatsApp on your phone → Menu (⋮) → **Linked Devices** → **Link a Device**
4. Scan the QR code
5. The status dot turns green: ✅ **Connected**

On subsequent starts, the session is restored automatically — no QR scan needed.

### Step 2: Upload Numbers

Upload a `.txt` or `.csv` file with phone numbers. Supported formats:

```
+201234567890
+209876543210
00201123456789
01123456789
```

- Each number on a separate line (or comma-separated)
- Non-digit characters are stripped automatically
- Numbers with fewer than 7 digits are filtered out
- Numbers are automatically formatted to E.164 international format

### Step 3: Write Your Message

Type your message in the text area. If your message contains a URL, a **live link preview** card appears automatically — showing the page title, description, and thumbnail image.

The message is saved to your browser's local storage, so it persists across page refreshes.

### Step 4: Validate & Get Strategy

Click **"Validate & Get Strategy"** (or it triggers automatically when you upload numbers with a message ready). The app will:

1. ✅ Clean and validate every phone number
2. 📊 Recommend the safest sending strategy (delay, batch size, pause)
3. ⏭️ Identify invalid numbers to skip

The results appear in the info box, and the delay dropdown is automatically set to the recommended value.

### Step 5: Send Messages

1. Choose a delay between messages (2s / 4s / 6s / 8s)
2. Click **"▶ Start Sending"**
3. Watch the live progress:
   - **Progress bar** shows overall completion
   - **Stats** update in real-time (Sent / Failed / Skipped)
   - **Log table** shows each number's status as it's processed
4. Click **"⏹ Stop"** at any time to abort

### Step 6: Download Report

Click **"📥 Download Report (MD)"** to get a Markdown report with:

```
# 📱 WhatsApp Send Report

## Summary
| Metric | Count |
|--------|-------|
| Total  | 503   |
| Sent   | 498   |
| Failed | 4     |
| Skipped| 1     |

## Results
| # | Number         | Status      | Time     | Details          |
|---|----------------|-------------|----------|------------------|
| 1 | +201234567890  | ✅ Sent     | 6:00 PM  | -                |
| 2 | +209876543210  | ❌ Failed   | 6:00 PM  | Error: timeout   |
| 3 | 0099999999999  | ⏭️ Skipped  | 6:00 PM  | Invalid format   |
```

---

## Project Structure

```
whatsapp-ai-agent/
├── server.js           # Express server — API routes, SSE streaming, OG preview
├── sender.js           # WhatsApp client — init, QR auth, sendMessage
├── agent.js            # Phone validation and send strategy logic
├── public/
│   └── index.html      # Frontend — dashboard UI, live progress, link preview
├── package.json
└── README.md
```

### Architecture

```
┌──────────┐     POST /api/send     ┌──────────────┐
│          │  ──────────────────►   │              │
│  Browser │     GET /api/stream    │  Node.js     │
│  (UI)    │  ◄── SSE events ────   │  Server      │
│          │                        │              │
│          │  POST /api/prepare     │  ┌─────────┐ │
│          │  ──────────────────►   │  │Validator│ │
│          │                        │  │+Strategy│ │
│          │  GET /api/log/md       │  └─────────┘ │
│          │  ◄── MD report ─────   │              │
└──────────┘                        │  ┌─────────┐ │
                                    │  │whatsapp │ │
                                    │  │-web.js  │ │
                                    │  └─────────┘ │
                                    └──────────────┘
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/init` | Initialize WhatsApp session (QR or restore) |
| `GET` | `/api/qr` | Get current QR code as base64 data URL |
| `GET` | `/api/status` | Check if WhatsApp is connected |
| `POST` | `/api/prepare` | Validate numbers + get send strategy |
| `POST` | `/api/send` | Submit send job config |
| `GET` | `/api/send/stream` | SSE stream of send progress |
| `GET` | `/api/log` | Get send log as JSON |
| `GET` | `/api/log/md` | Download Markdown report |
| `GET` | `/api/preview?url=` | Fetch Open Graph preview for a URL |

---

## Troubleshooting

### Session lost after restart
- Delete the session folder: `rm -rf .wwebjs_auth`
- Restart the server and re-scan the QR code

### "Browser already running" error
- Stale lock files are cleaned automatically, but if the issue persists:
  ```bash
  rm -rf .wwebjs_auth/session/*.lock
  ```

### Messages fail silently
- Check the server console for error logs
- Download the Markdown report to see which numbers failed and why
- Ensure your WhatsApp session is still active (green dot in UI)

### Chrome not found
- The app auto-detects Chrome/Chromium on common paths. If yours is in a custom location, set it in `sender.js` or install the bundled Puppeteer Chromium.

---

## Tech Stack

- **Runtime:** Node.js
- **Web Framework:** Express
- **WhatsApp:** whatsapp-web.js (v1.34.7)
- **Browser Automation:** Puppeteer (via whatsapp-web.js)
- **Frontend:** Vanilla HTML/CSS/JS (no frameworks)

---

## Notes

- **WhatsApp Web Policy:** This tool automates WhatsApp Web interactions. Use responsibly and in compliance with WhatsApp's Terms of Service.
- **Rate Limiting:** Use safe delays. Sending too fast may trigger WhatsApp rate limits or temporary blocks.
- **Session Expiry:** WhatsApp sessions expire after a period of inactivity. If disconnected, click the reconnect button or re-scan the QR code.
- **Single User:** The app is designed for single-user use on a local machine. Not tested for multi-user or production deployments.
