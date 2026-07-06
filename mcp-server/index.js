#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import AdmZip from 'adm-zip';
import { readdir, stat, unlink, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { z } from 'zod';
import { formatMarkdown } from './markdown-formatter.js';

// --- Config ---
const WS_PORT = 3456;
const PING_INTERVAL = 20000;
// Sessions dir: env var > ~/.fe-debug/sessions (avoids macOS permission issues with ~/Downloads)
const SESSIONS_DIR = process.env.FE_DEBUG_PATH || join(homedir(), '.fe-debug', 'sessions');

// WS origin allowlist. WebSockets aren't bound by same-origin policy, so any web page
// the user opens could otherwise connect and inject fake STREAM_ENTRIES (prompt
// injection). Only accept chrome-extension:// origins. FE_DEBUG_EXT_IDS (comma-separated
// extension IDs) restricts to specific IDs for dev with unpacked builds; unset = accept
// any chrome-extension:// origin (still blocks every web page — the main threat).
const EXT_ID_ALLOWLIST = (process.env.FE_DEBUG_EXT_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin || !origin.startsWith('chrome-extension://')) return false;
  if (EXT_ID_ALLOWLIST.length === 0) return true;
  const id = origin.slice('chrome-extension://'.length).replace(/\/$/, '');
  return EXT_ID_ALLOWLIST.includes(id);
}

// Live stream — defaults to CWD/fe-debug/, overridable via start-recording param
let liveLogDir = process.cwd();
let liveEntries = [];
let liveSessionMeta = {};
let liveScreenshotMap = {};

// --- WebSocket state ---
let extensionWs = null;
let pendingRequests = new Map();
let requestIdCounter = 0;

// Keep this long-lived stdio server alive through stray socket/async errors instead of
// crashing (which would silently drop the extension bridge). Log and continue.
process.on('uncaughtException', (err) => console.error('[fe-debug-mcp] Uncaught exception:', err));
process.on('unhandledRejection', (err) => console.error('[fe-debug-mcp] Unhandled rejection:', err));

// --- WebSocket Server ---
let wss = null;
let pingTimer = null;

function createWsServer() {
  return new Promise((resolve) => {
    // Bind to loopback only. The origin check trusts the browser-set Origin header,
    // which only holds against browser clients — a non-browser client on the LAN could
    // forge it. Binding to 127.0.0.1 keeps the socket off the network entirely, so the
    // localhost threat model actually holds. The extension connects to ws://localhost,
    // which resolves to loopback, so this is transparent to it.
    const server = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });
    server.on('listening', () => {
      console.error(`[fe-debug-mcp] WebSocket server listening on port ${WS_PORT}`);
      resolve(server);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[fe-debug-mcp] Port ${WS_PORT} busy — another MCP server instance may be running. Check with: lsof -i :${WS_PORT}`);
      } else {
        console.error(`[fe-debug-mcp] WebSocket server error: ${err.message}`);
      }
      resolve(null);
    });
  });
}

async function startWsServer() {
  // Do NOT kill whoever holds the port — it may be an unrelated user process.
  // Bind directly; on EADDRINUSE retry once (covers an old instance still exiting),
  // then give up gracefully. File-based stdio tools keep working either way.
  wss = await createWsServer();
  if (!wss) {
    console.error(`[fe-debug-mcp] Retrying WS bind in 1.5s...`);
    await new Promise((r) => setTimeout(r, 1500));
    wss = await createWsServer();
  }
  if (wss) setupWsHandlers();
}

function setupWsHandlers() {
  wss.on('connection', (ws, req) => {
    // A socket error with no listener throws as an uncaught exception in `ws` and would
    // crash the whole server (e.g. a rejected/hostile peer RSTing mid-close-handshake).
    // Attach before anything else so both the reject and accept paths are covered.
    ws.on('error', (err) => console.error(`[fe-debug-mcp] WS socket error: ${err.message}`));

    // Reject any connection that isn't from an allowed Chrome extension origin.
    // Blocks web pages (prompt injection) from hijacking the extension's WS slot.
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin)) {
      console.error(`[fe-debug-mcp] Rejected WS connection from origin: ${origin || '(none)'}`);
      ws.close(1008, 'Forbidden origin');
      return;
    }

    // Close old connection and reject its pending requests
    if (extensionWs && extensionWs.readyState <= 1) {
      extensionWs.close(1000, 'Replaced by new connection');
    }
    for (const [reqId, pending] of pendingRequests.entries()) {
      pending.resolve({ type: 'ERROR', message: 'Connection replaced' });
      pendingRequests.delete(reqId);
    }

    extensionWs = ws;
    console.error('[fe-debug-mcp] Extension connected via WebSocket');

    // Keepalive ping every 20s
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, PING_INTERVAL);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'PONG') return;

        if (msg.type === 'STREAM_ENTRIES' && msg.entries) {
          handleStreamEntries(msg.entries, msg.domain).catch((err) =>
            console.error('[fe-debug-mcp] Stream write error:', err)
          );
          return;
        }

        if (msg.type === 'STREAM_SCREENSHOT' && msg.screenshot) {
          handleStreamScreenshot(msg.screenshot).catch((err) =>
            console.error('[fe-debug-mcp] Screenshot save error:', err)
          );
          return;
        }

        if (msg._requestId && pendingRequests.has(msg._requestId)) {
          const { resolve } = pendingRequests.get(msg._requestId);
          pendingRequests.delete(msg._requestId);
          resolve(msg);
          return;
        }
      } catch (err) {
        console.error('[fe-debug-mcp] WS message parse error:', err);
      }
    });

    ws.on('close', () => {
      extensionWs = null;
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      for (const [reqId, pending] of pendingRequests.entries()) {
        pending.resolve({ type: 'ERROR', message: 'Extension disconnected' });
        pendingRequests.delete(reqId);
      }
      console.error('[fe-debug-mcp] Extension disconnected');
    });
  });

  wss.on('error', (err) => {
    console.error(`[fe-debug-mcp] WebSocket server error: ${err.message}`);
  });
}

// Send command to extension and wait for response matched by _requestId
function sendToExtension(command, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!extensionWs || extensionWs.readyState !== extensionWs.OPEN) {
      reject(new Error('Extension not connected'));
      return;
    }

    const requestId = ++requestIdCounter;
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Extension response timeout'));
    }, timeoutMs);

    pendingRequests.set(requestId, {
      resolve: (msg) => {
        clearTimeout(timer);
        resolve(msg);
      },
    });

    extensionWs.send(JSON.stringify({ ...command, _requestId: requestId }));
  });
}

// --- File helpers ---
async function ensureSessionsDir() {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

async function listZipFiles() {
  await ensureSessionsDir();
  const files = await readdir(SESSIONS_DIR);
  const zips = [];

  for (const f of files) {
    if (!f.endsWith('.zip')) continue;
    const fullPath = join(SESSIONS_DIR, f);
    const s = await stat(fullPath);
    // Parse domain and timestamp from filename: fe-debug-{domain}-{timestamp}.zip
    const match = f.match(/^fe-debug-(.+?)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.zip$/);
    zips.push({
      filename: f,
      path: fullPath,
      domain: match ? match[1] : 'unknown',
      timestamp: match ? match[2].replace(/-/g, (m, i) => i > 9 ? ':' : '-') : 'unknown',
      size: s.size,
      mtime: s.mtime,
    });
  }

  // Sort newest first
  zips.sort((a, b) => b.mtime - a.mtime);
  return zips;
}

function readZipContents(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const result = { markdown: '', screenshots: [] };

  for (const entry of entries) {
    if (entry.entryName === 'debug-log.md') {
      result.markdown = entry.getData().toString('utf8');
    } else if (entry.entryName.startsWith('screenshots/') && !entry.isDirectory) {
      result.screenshots.push({
        name: entry.entryName.replace('screenshots/', ''),
        base64: entry.getData().toString('base64'),
      });
    }
  }

  return result;
}

// Accumulate streamed entries and regenerate fe-debug/debug-log.md
async function handleStreamEntries(entries, domain) {
  // Update session meta from domain
  if (domain && domain !== 'unknown') {
    liveSessionMeta.url = liveSessionMeta.url || domain;
  }

  liveEntries.push(...entries);

  // Write markdown to fe-debug/debug-log.md
  const feDebugDir = join(liveLogDir, 'fe-debug');
  await mkdir(feDebugDir, { recursive: true });

  const markdown = formatMarkdown({
    meta: liveSessionMeta,
    entries: liveEntries,
    screenshotMap: liveScreenshotMap,
  });
  await writeFile(join(feDebugDir, 'debug-log.md'), markdown);
}

// Save streamed screenshot to fe-debug/screenshots/
async function handleStreamScreenshot(screenshot) {
  const feDebugDir = join(liveLogDir, 'fe-debug', 'screenshots');
  await mkdir(feDebugDir, { recursive: true });

  const { filename, base64, annotationId } = screenshot;
  const buffer = Buffer.from(base64, 'base64');
  await writeFile(join(feDebugDir, filename), buffer);

  // Track in screenshotMap for markdown references
  if (annotationId) {
    liveScreenshotMap[annotationId] = filename;
  }
}

// --- Entry summarization / filtering (token efficiency) ---
// Category values come from the capture modules: console | action | network | state | annotation.
const CATEGORY_LABELS = { console: 'console', action: 'userAction', network: 'network', state: 'componentState', annotation: 'annotation' };

// One-line overview of the FULL session so Claude knows what was captured (and truncated).
function summarizeEntries(entries, shownCount) {
  const counts = {};
  let consoleErr = 0;
  let consoleWarn = 0;
  for (const e of entries) {
    const cat = e.category || 'other';
    counts[cat] = (counts[cat] || 0) + 1;
    if (cat === 'console') {
      if (e.type === 'warn') consoleWarn++;
      else consoleErr++;
    }
  }
  const parts = Object.entries(counts).map(([cat, n]) =>
    cat === 'console' ? `${n} console (${consoleErr} error, ${consoleWarn} warn)` : `${n} ${CATEGORY_LABELS[cat] || cat}`
  );
  let summary = `${entries.length} entries: ${parts.join(', ') || 'none'}.`;
  if (typeof shownCount === 'number' && shownCount < entries.length) {
    summary += ` Showing last ${shownCount} of ${entries.length}.`;
  }
  return summary;
}

// Filter by console level (non-console categories always kept), then keep the last `tail`.
function filterEntries(entries, { tail = 50, level = 'all' } = {}) {
  let filtered = entries;
  if (level !== 'all') {
    filtered = entries.filter((e) => {
      if (e.category !== 'console') return true;
      const isWarn = e.type === 'warn';
      return level === 'warn' ? isWarn : !isWarn; // 'error' = everything that isn't a warn
    });
  }
  if (typeof tail === 'number' && tail >= 0 && filtered.length > tail) {
    filtered = filtered.slice(-tail);
  }
  return filtered;
}

// Compact summary line + markdown of the filtered subset.
function renderLogMarkdown(meta, allEntries, screenshotMap, opts) {
  const filtered = filterEntries(allEntries, opts);
  const summary = summarizeEntries(allEntries, filtered.length);
  // The section counts below come from formatMarkdown over the filtered subset, so they
  // can disagree with the full-session summary above. Flag it when we truncated.
  const note = filtered.length < allEntries.length
    ? '\n_Section counts below reflect only the shown window, not the whole session._'
    : '';
  const md = formatMarkdown({ meta: meta || {}, entries: filtered, screenshotMap: screenshotMap || {} });
  return `**Summary:** ${summary}${note}\n\n${md}`;
}

// --- MCP Server ---
const server = new McpServer({
  name: 'fe-debug',
  version: '0.1.0',
});

// Tool: get-debug-log
server.tool(
  'get-debug-log',
  'Read a debug log session as markdown. Defaults to a compact summary + last 50 entries, no screenshots. Widen with tail/level/includeScreenshots. (tail/level apply to live sessions; saved ZIPs return the full rendered log.)',
  {
    url: z.string().optional().describe('Filter by domain (partial match)'),
    tail: z.number().int().positive().optional().default(50).describe('Return only the last N entries (default 50)'),
    level: z.enum(['all', 'error', 'warn']).optional().default('all').describe('Filter console entries by level; non-console entries always kept'),
    includeScreenshots: z.boolean().optional().default(false).describe('Attach screenshots as images (default false)'),
  },
  async ({ url, tail, level, includeScreenshots }) => {
    // Try live data from extension first
    if (extensionWs && extensionWs.readyState === extensionWs.OPEN) {
      try {
        const data = await sendToExtension({ type: 'GET_LOG' }, 30000);
        if (data.entries && data.entries.length > 0) {
          const text = renderLogMarkdown(data.sessionMeta, data.entries, data.screenshotMap, { tail, level });
          const content = [{ type: 'text', text: `## Live debug log\n\n${text}` }];
          if (includeScreenshots && data.screenshots) {
            for (const ss of data.screenshots) {
              if (ss.base64) content.push({ type: 'image', data: ss.base64, mimeType: 'image/png' });
            }
          }
          return { content };
        }
      } catch (_) {
        // Fall through to file-based
      }
    }

    // File-based: read from saved ZIPs. These store pre-rendered markdown (no structured
    // entries), so tail/level can't be applied here — screenshots stay opt-in.
    const zips = await listZipFiles();
    if (!zips.length) {
      return { content: [{ type: 'text', text: 'No debug logs found. Record a session first.' }] };
    }

    let target = zips[0]; // Default: latest
    if (url) {
      const filtered = zips.filter((z) => z.domain.includes(url.replace(/\./g, '-')));
      if (filtered.length) target = filtered[0];
    }

    const { markdown, screenshots } = readZipContents(target.path);
    const content = [{ type: 'text', text: markdown || 'Empty debug log.' }];

    if (includeScreenshots) {
      for (const ss of screenshots) {
        content.push({ type: 'image', data: ss.base64, mimeType: 'image/png' });
      }
    }

    return { content };
  }
);

// Tool: start-recording
server.tool(
  'start-recording',
  'Start recording frontend debug data via Chrome extension. Requires extension to be connected via WebSocket.',
  {
    console: z.boolean().optional().default(true).describe('Capture console errors'),
    userActions: z.boolean().optional().default(true).describe('Capture user actions'),
    network: z.boolean().optional().default(true).describe('Capture network requests'),
    componentState: z.boolean().optional().default(true).describe('Capture component state'),
    logDir: z.string().optional().describe('Directory to save live stream logs. Defaults to CWD.'),
  },
  async (config) => {
    try {
      // Update live log directory if provided
      if (config.logDir) liveLogDir = config.logDir;

      // Reset live state for fresh session
      liveEntries = [];
      liveSessionMeta = { startTime: new Date().toISOString() };
      liveScreenshotMap = {};

      // Clean old fe-debug folder
      const feDebugDir = join(liveLogDir, 'fe-debug');
      const feFiles = await readdir(feDebugDir).catch(() => []);
      for (const f of feFiles) {
        if (f === 'debug-log.md') await unlink(join(feDebugDir, f)).catch(() => {});
      }
      const ssDir = join(feDebugDir, 'screenshots');
      const ssFiles = await readdir(ssDir).catch(() => []);
      for (const f of ssFiles) {
        await unlink(join(ssDir, f)).catch(() => {});
      }

      const { logDir, ...recordConfig } = config;
      const resp = await sendToExtension({ type: 'START_RECORDING', config: recordConfig });
      return {
        content: [{ type: 'text', text: `Recording started. Live logs → ${liveLogDir}\nConfig: ${JSON.stringify(recordConfig)}` }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to start recording: ${err.message}. Make sure the FE Debug Logger extension is installed and the page is open.` }],
        isError: true,
      };
    }
  }
);

// Tool: stop-recording
server.tool(
  'stop-recording',
  'Stop recording and return a compact summary + last 50 entries as markdown. Screenshots are opt-in. Use get-debug-log with tail/level/includeScreenshots for the full log.',
  {
    includeScreenshots: z.boolean().optional().default(false).describe('Attach screenshots as images (default false)'),
  },
  async ({ includeScreenshots }) => {
    try {
      const resp = await sendToExtension({ type: 'STOP_RECORDING' });

      // Get the log data after stopping
      let logData;
      try {
        logData = await sendToExtension({ type: 'GET_LOG' }, 30000);
      } catch (_) {
        return {
          content: [{ type: 'text', text: `Recording stopped (${resp.entryCount || 0} entries). Could not retrieve log data.` }],
        };
      }

      const entries = logData.entries || [];
      const content = [];

      if (entries.length > 0) {
        const text = renderLogMarkdown(logData.sessionMeta, entries, logData.screenshotMap, { tail: 50, level: 'all' });
        content.push({ type: 'text', text: `Recording stopped.\n\n${text}\n\n_Use get-debug-log with tail/level/includeScreenshots for more._` });
      } else {
        content.push({ type: 'text', text: `Recording stopped. ${resp.entryCount || 0} entries captured.` });
      }

      if (includeScreenshots && logData.screenshots) {
        for (const ss of logData.screenshots) {
          if (ss.base64) {
            content.push({ type: 'image', data: ss.base64, mimeType: 'image/png' });
          }
        }
      }

      return { content };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to stop recording: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: get-status
server.tool(
  'get-status',
  'Check Chrome extension connection and recording status.',
  {},
  async () => {
    const connected = extensionWs && extensionWs.readyState === extensionWs.OPEN;

    if (!connected) {
      return {
        content: [{ type: 'text', text: 'Extension not connected. Open the FE Debug Logger extension in Chrome.' }],
      };
    }

    try {
      const status = await sendToExtension({ type: 'GET_STATUS' }, 5000);
      return {
        content: [{
          type: 'text',
          text: `Connected: yes\nRecording: ${status.recording ? 'yes' : 'no'}\nEntries: ${status.entryCount || 0}\nAnnotations: ${status.annotationCount || 0}`,
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Connected but unresponsive: ${err.message}` }],
      };
    }
  }
);

// Tool: get-live-log
server.tool(
  'get-live-log',
  'Read the current live debug log (compact summary + last 50 entries, no screenshots by default). Faster than get-debug-log — no WS roundtrip. Widen with tail/level/includeScreenshots.',
  {
    tail: z.number().int().positive().optional().default(50).describe('Return only the last N entries (default 50)'),
    level: z.enum(['all', 'error', 'warn']).optional().default('all').describe('Filter console entries by level; non-console entries always kept'),
    includeScreenshots: z.boolean().optional().default(false).describe('Attach screenshots as images (default false)'),
  },
  async ({ tail, level, includeScreenshots }) => {
    let content;
    if (liveEntries.length > 0) {
      // Prefer in-memory entries so we can filter/tail and show an accurate summary.
      const text = renderLogMarkdown(liveSessionMeta, liveEntries, liveScreenshotMap, { tail, level });
      content = [{ type: 'text', text }];
    } else {
      // Fallback: rendered markdown file (no structured entries — can't filter).
      const mdPath = join(liveLogDir, 'fe-debug', 'debug-log.md');
      try {
        const markdown = await readFile(mdPath, 'utf8');
        content = [{ type: 'text', text: markdown }];
      } catch {
        return { content: [{ type: 'text', text: `No live log at ${mdPath}. Start recording first.` }] };
      }
    }

    if (includeScreenshots) {
      const ssDir = join(liveLogDir, 'fe-debug', 'screenshots');
      const ssFiles = await readdir(ssDir).catch(() => []);
      for (const f of ssFiles) {
        if (f.endsWith('.png')) {
          const imgData = await readFile(join(ssDir, f));
          content.push({ type: 'image', data: imgData.toString('base64'), mimeType: 'image/png' });
        }
      }
    }

    return { content };
  }
);

// --- Start ---
await startWsServer();
const transport = new StdioServerTransport();
await server.connect(transport);
