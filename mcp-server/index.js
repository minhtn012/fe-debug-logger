#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import AdmZip from 'adm-zip';
import { readdir, stat, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { z } from 'zod';

// --- Config ---
const WS_PORT = 3456;
const PING_INTERVAL = 20000;
const DEFAULT_CLEANUP_DAYS = 7;
const SESSIONS_DIR = process.env.FE_DEBUG_PATH || join(homedir(), 'Downloads', 'fe-debug', 'sessions');

// --- WebSocket state ---
let extensionWs = null;
let pendingRequests = new Map();
let requestIdCounter = 0;

// --- WebSocket Server ---
const wss = new WebSocketServer({ port: WS_PORT });
let pingTimer = null;

wss.on('connection', (ws) => {
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

      // Handle PONG (keepalive)
      if (msg.type === 'PONG') return;

      // Route response to pending request
      if (msg._requestId && pendingRequests.has(msg._requestId)) {
        const { resolve } = pendingRequests.get(msg._requestId);
        pendingRequests.delete(msg._requestId);
        resolve(msg);
        return;
      }

      // Handle unsolicited responses (match by type)
      for (const [reqId, pending] of pendingRequests.entries()) {
        if (pending.expectedType === msg.type) {
          pendingRequests.delete(reqId);
          pending.resolve(msg);
          return;
        }
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
    // Reject all pending requests on disconnect
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

console.error(`[fe-debug-mcp] WebSocket server listening on port ${WS_PORT}`);

// Send command to extension and wait for response
function sendToExtension(command, expectedType, timeoutMs = 10000) {
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
      expectedType,
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

// --- MCP Server ---
const server = new McpServer({
  name: 'fe-debug',
  version: '0.1.0',
});

// Tool: list-debug-logs
server.tool(
  'list-debug-logs',
  'List saved debug log sessions from ~/Downloads/fe-debug/sessions/. Auto-cleans sessions older than 7 days.',
  {},
  async () => {
    const zips = await listZipFiles();

    // Auto-cleanup old sessions
    const cutoff = Date.now() - DEFAULT_CLEANUP_DAYS * 24 * 60 * 60 * 1000;
    const old = zips.filter((z) => z.mtime.getTime() < cutoff);
    for (const z of old) {
      await unlink(z.path).catch(() => {});
    }

    const current = zips.filter((z) => z.mtime.getTime() >= cutoff);
    const list = current.map((z) => `- ${z.filename} (${z.domain}, ${Math.round(z.size / 1024)}KB, ${z.mtime.toISOString()})`);

    return {
      content: [{
        type: 'text',
        text: current.length
          ? `Found ${current.length} debug log(s)${old.length ? ` (cleaned ${old.length} old)` : ''}:\n${list.join('\n')}`
          : 'No debug logs found.',
      }],
    };
  }
);

// Tool: get-debug-log
server.tool(
  'get-debug-log',
  'Read a debug log session. Returns markdown + screenshots. Defaults to latest session.',
  { url: z.string().optional().describe('Filter by domain (partial match)') },
  async ({ url }) => {
    // Try live data from extension first
    if (extensionWs && extensionWs.readyState === extensionWs.OPEN) {
      try {
        const data = await sendToExtension({ type: 'GET_LOG' }, 'LOG_DATA', 5000);
        if (data.entries && data.entries.length > 0) {
          const parts = [{ type: 'text', text: `## Live debug log (${data.entries.length} entries)\n\nSession: ${data.sessionMeta?.url || 'unknown'}` }];
          // Return raw entries as JSON for Claude to analyze
          parts.push({ type: 'text', text: '```json\n' + JSON.stringify(data.entries, null, 2) + '\n```' });
          return { content: parts };
        }
      } catch (_) {
        // Fall through to file-based
      }
    }

    // File-based: read from saved ZIPs
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

    for (const ss of screenshots) {
      content.push({
        type: 'image',
        data: ss.base64,
        mimeType: 'image/png',
      });
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
  },
  async (config) => {
    try {
      const resp = await sendToExtension(
        { type: 'START_RECORDING', config },
        'RECORDING_STARTED'
      );
      return {
        content: [{ type: 'text', text: `Recording started. Config: ${JSON.stringify(config)}` }],
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
  'Stop recording and return captured debug data from Chrome extension.',
  {},
  async () => {
    try {
      const resp = await sendToExtension(
        { type: 'STOP_RECORDING' },
        'RECORDING_STOPPED'
      );

      // Get the log data after stopping
      let logData;
      try {
        logData = await sendToExtension({ type: 'GET_LOG' }, 'LOG_DATA', 5000);
      } catch (_) {
        return {
          content: [{ type: 'text', text: `Recording stopped (${resp.entryCount || 0} entries). Could not retrieve log data.` }],
        };
      }

      const content = [{ type: 'text', text: `Recording stopped. ${resp.entryCount || 0} entries captured.` }];

      if (logData.entries && logData.entries.length > 0) {
        content.push({ type: 'text', text: '```json\n' + JSON.stringify(logData.entries, null, 2) + '\n```' });
      }

      if (logData.screenshots) {
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
      const status = await sendToExtension({ type: 'GET_STATUS' }, 'STATUS', 3000);
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

// Tool: cleanup-debug-logs
server.tool(
  'cleanup-debug-logs',
  'Delete old debug log sessions.',
  { olderThanDays: z.number().optional().default(7).describe('Delete sessions older than N days') },
  async ({ olderThanDays }) => {
    const zips = await listZipFiles();
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    for (const z of zips) {
      if (z.mtime.getTime() < cutoff) {
        await unlink(z.path).catch(() => {});
        deleted++;
      }
    }

    return {
      content: [{ type: 'text', text: `Deleted ${deleted} session(s) older than ${olderThanDays} days.` }],
    };
  }
);

// --- Start ---
const transport = new StdioServerTransport();
await server.connect(transport);
