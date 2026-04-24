#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";

const args = process.argv.slice(2);
let port = 12080;
let bufferCapacity = 1000;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === "--port" || args[i] === "-p") && args[i + 1]) {
    port = parseInt(args[++i], 10);
  } else if (args[i] === "--buffer-size" && args[i + 1]) {
    bufferCapacity = parseInt(args[++i], 10);
  }
}

port = parseInt(process.env.PROXYPIN_PORT || port, 10);
bufferCapacity = parseInt(process.env.PROXYPIN_BUFFER_SIZE || bufferCapacity, 10);

const WS_URL = process.env.PROXYPIN_WS_URL || `ws://127.0.0.1:${port}`;

// --- History config (sent by ProxyPin on connect / config change) ---
let historyEnabled = false;

// --- Pending WS commands: requestId -> { resolve, reject, timer } ---
const pendingCmds = new Map();
let cmdSeq = 0;
let activeWs = null;

function sendCommand(action, params = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!activeWs || activeWs.readyState !== WebSocket.OPEN) {
      return reject(new Error("WebSocket not connected"));
    }
    const requestId = `cmd_${++cmdSeq}`;
    const timer = setTimeout(() => {
      pendingCmds.delete(requestId);
      reject(new Error(`Command "${action}" timed out`));
    }, timeoutMs);
    pendingCmds.set(requestId, { resolve, reject, timer });
    activeWs.send(JSON.stringify({ action, requestId, ...params }));
  });
}

// --- Ring buffer ---
const buffer = new Map();
const insertOrder = [];
let wsConnected = false;

function trimBuffer() {
  while (insertOrder.length > bufferCapacity) {
    const oldId = insertOrder.shift();
    buffer.delete(oldId);
  }
}

function touchEntry(id) {
  const idx = insertOrder.indexOf(id);
  if (idx !== -1) insertOrder.splice(idx, 1);
  insertOrder.push(id);
}

function handleMessage(msg) {
  const { type, id, data } = msg;

  if (type === "config") {
    historyEnabled = data?.historyEnabled ?? false;
    return;
  }

  if (type === "cmd_reply") {
    const pending = pendingCmds.get(msg.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingCmds.delete(msg.requestId);
      if (msg.error) pending.reject(new Error(msg.error));
      else pending.resolve(msg);
    }
    return;
  }

  if (!id) return;

  if (type === "request") {
    const entry = buffer.get(id) || { id, status: null, response: null, messages: [] };
    entry.method = data.method || "";
    entry.url = data.uri || "";
    entry.request_headers = data.headers || {};
    entry.request_body = data.body || "";
    entry.request_time = data.requestTime || 0;
    buffer.set(id, entry);
    touchEntry(id);
    trimBuffer();
  } else if (type === "response") {
    const entry = buffer.get(id) || { id, messages: [] };
    const req = data.request || {};
    const resp = data.response || {};
    entry.method = req.method || entry.method || "";
    entry.url = req.url || entry.url || "";
    entry.status = resp.status || 0;
    entry.status_text = resp.statusText || "";
    entry.response = data;
    entry.time = data.time ?? -1;
    entry.started = data.startedDateTime || "";
    buffer.set(id, entry);
    touchEntry(id);
    trimBuffer();
  } else if (type === "ws_message") {
    const entry = buffer.get(id);
    if (entry) {
      if (!entry.messages) entry.messages = [];
      entry.messages.push(data);
    }
  }
}

// --- WebSocket connection with auto-reconnect ---
function connectWs() {
  try {
    const ws = new WebSocket(WS_URL);
    ws.on("open", () => { wsConnected = true; activeWs = ws; });
    ws.on("message", (raw) => {
      try { handleMessage(JSON.parse(raw.toString())); } catch {}
    });
    ws.on("close", () => {
      wsConnected = false;
      activeWs = null;
      setTimeout(connectWs, 5000);
    });
    ws.on("error", () => {
      wsConnected = false;
      activeWs = null;
      setTimeout(connectWs, 5000);
    });
  } catch {
    wsConnected = false;
    activeWs = null;
    setTimeout(connectWs, 5000);
  }
}

connectWs();

// --- MCP Server ---
const server = new McpServer({
  name: "proxypin",
  version: "1.0.0",
  description: "ProxyPin traffic capture MCP server. Connects to ProxyPin's WebSocket push service and buffers HTTP/HTTPS/WebSocket traffic in real-time. Use list_requests to browse captured traffic, get_request to inspect full request/response details (headers, body, timing), search_requests to filter by URL/method/status, and get_stats for an overview. Typical workflow: get_stats → list_requests → get_request(id) for deep inspection.",
});

server.tool(
  "list_requests",
  "List recent captured HTTP(S) requests with summary info (method, URL, status code, response time). Returns newest first. Use this as the starting point to browse traffic, then call get_request with a specific ID to see full details including headers and response body.",
  { limit: z.number().default(20).describe("Max items to return (default 20)"), offset: z.number().default(0).describe("Offset for pagination (default 0)") },
  async ({ limit, offset }) => {
    const items = [...buffer.values()].reverse();
    const page = items.slice(offset, offset + limit);
    const requests = page.map((e) => ({
      id: e.id, method: e.method, url: e.url, status: e.status,
      time_ms: e.time, started: e.started, ws_messages: (e.messages || []).length,
    }));
    return { content: [{ type: "text", text: JSON.stringify({ total: items.length, offset, limit, requests }) }] };
  }
);

server.tool(
  "get_request",
  "Get complete request and response details for a specific capture. Returns full HAR entry including: request headers, request body, response headers, response body (decoded text), status code, timing, server IP, and any WebSocket/SSE messages. Use the request ID from list_requests or search_requests.",
  { request_id: z.string().describe("The request ID from list_requests or search_requests") },
  async ({ request_id }) => {
    const entry = buffer.get(request_id);
    if (!entry) return { content: [{ type: "text", text: JSON.stringify({ error: `Request ${request_id} not found` }) }] };
    return { content: [{ type: "text", text: JSON.stringify(entry) }] };
  }
);

server.tool(
  "search_requests",
  "Filter captured traffic by URL keyword, HTTP method, and/or status code. Supports combining filters (e.g. keyword='api' + method='POST' + status_code=500 to find failed API POST requests). Returns up to 50 matches, newest first. Use get_request(id) on results to see full details.",
  {
    keyword: z.string().default("").describe("Case-insensitive URL substring match (e.g. 'login', 'api/v1', '.json')"),
    method: z.string().default("").describe("HTTP method: GET, POST, PUT, DELETE, PATCH, etc."),
    status_code: z.number().default(0).describe("Exact HTTP status code: 200, 301, 404, 500, etc. Use 0 to skip this filter"),
  },
  async ({ keyword, method, status_code }) => {
    const items = [...buffer.values()].reverse();
    const results = [];
    for (const e of items) {
      if (keyword && !(e.url || "").toLowerCase().includes(keyword.toLowerCase())) continue;
      if (method && (e.method || "").toUpperCase() !== method.toUpperCase()) continue;
      if (status_code && e.status !== status_code) continue;
      results.push({ id: e.id, method: e.method, url: e.url, status: e.status, time_ms: e.time });
      if (results.length >= 50) break;
    }
    return { content: [{ type: "text", text: JSON.stringify({ count: results.length, requests: results }) }] };
  }
);

server.tool(
  "get_stats",
  "Get an overview of captured traffic: WebSocket connection status, buffer usage, HTTP status code distribution, and top 10 domains by request count. Good starting point to understand what traffic has been captured before drilling into specific requests.",
  {},
  async () => {
    const items = [...buffer.values()];
    const statusDist = {};
    const domainDist = {};
    for (const e of items) {
      if (e.status) statusDist[e.status] = (statusDist[e.status] || 0) + 1;
      try {
        const host = new URL(e.url).hostname;
        if (host) domainDist[host] = (domainDist[host] || 0) + 1;
      } catch {}
    }
    const topDomains = Object.fromEntries(
      Object.entries(domainDist).sort((a, b) => b[1] - a[1]).slice(0, 10)
    );
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ ws_connected: wsConnected, ws_url: WS_URL, buffer_size: items.length, buffer_capacity: bufferCapacity, history_enabled: historyEnabled, status_distribution: statusDist, top_domains: topDomains }),
      }],
    };
  }
);

server.tool(
  "clear_buffer",
  "Clear all captured requests from the buffer. Use this before starting a new capture session to avoid mixing old and new traffic.",
  {},
  async () => {
    buffer.clear();
    insertOrder.length = 0;
    return { content: [{ type: "text", text: JSON.stringify({ status: "ok", message: "Buffer cleared" }) }] };
  }
);

// --- History tools (all via WS commands to ProxyPin, no local file access) ---
const HISTORY_DISABLED_ERR = { content: [{ type: "text", text: JSON.stringify({ error: "History access is disabled. Enable it in ProxyPin Settings → WebSocket Push → History Access." }) }] };

server.tool(
  "list_histories",
  "List all saved history sessions from ProxyPin. Each session has a name, request count, file size, and creation time. Use get_history_requests to browse a session, or search_history to search across sessions.",
  {},
  async () => {
    if (!historyEnabled) return HISTORY_DISABLED_ERR;
    try {
      const reply = await sendCommand("list_histories");
      return { content: [{ type: "text", text: JSON.stringify({ count: reply.data.length, histories: reply.data }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }
);

server.tool(
  "get_history_requests",
  "Get requests from a saved history session. Returns summary info only (method, URL, status, time). Use get_history_detail with a specific ID for full headers and body.",
  {
    name: z.string().describe("History session name from list_histories"),
    limit: z.number().default(10).describe("Max items to return (default 10)"),
    offset: z.number().default(0).describe("Offset for pagination (default 0)"),
  },
  async ({ name, limit, offset }) => {
    if (!historyEnabled) return HISTORY_DISABLED_ERR;
    try {
      const reply = await sendCommand("get_history", { name, limit, offset });
      return { content: [{ type: "text", text: JSON.stringify({ session: reply.name, total: reply.total, offset: reply.offset, limit: reply.limit, requests: reply.requests }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }
);

server.tool(
  "search_history",
  "Search across all saved history sessions for requests matching the given filters. Returns matching requests with their session name. Use get_history_detail for full details.",
  {
    keyword: z.string().default("").describe("Case-insensitive URL substring match"),
    method: z.string().default("").describe("HTTP method filter: GET, POST, PUT, DELETE, etc."),
    status_code: z.number().default(0).describe("HTTP status code filter (0 to skip)"),
    limit: z.number().default(10).describe("Max results (default 10)"),
  },
  async ({ keyword, method, status_code, limit }) => {
    if (!historyEnabled) return HISTORY_DISABLED_ERR;
    try {
      const reply = await sendCommand("search_history", { keyword, method, status_code, limit }, 15000);
      return { content: [{ type: "text", text: JSON.stringify({ count: reply.count, requests: reply.requests }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }
);

server.tool(
  "get_history_detail",
  "Get the complete HAR entry for a specific request from history. Returns full request headers, body, response headers, response body, and timing. Use the request ID from search_history or get_history_requests.",
  {
    request_id: z.string().describe("Request ID from search_history or get_history_requests"),
    session_name: z.string().default("").describe("History session name (optional, speeds up lookup)"),
  },
  async ({ request_id, session_name }) => {
    if (!historyEnabled) return HISTORY_DISABLED_ERR;
    try {
      const reply = await sendCommand("get_history_detail", { id: request_id, name: session_name || undefined });
      return { content: [{ type: "text", text: JSON.stringify({ session: reply.session, ...reply.data }) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: e.message }) }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
