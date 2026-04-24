# proxypin-mcp

MCP server for [ProxyPin](https://github.com/wanghongenpin/proxypin) — let AI analyze your HTTP(S) traffic in real-time.

[English](#how-it-works) | [中文](#工作原理)

---

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│                        ProxyPin App                         │
│                                                             │
│  MITM Proxy ──▶ EventListener ──▶ WsTrafficServer :12080   │
│                                         │   ▲              │
│                                    push │   │ commands     │
│                                         │   │ (history)    │
└─────────────────────────────────────────┼───┼──────────────┘
                                          │   │
                                     WS   │   │  WS
                                          ▼   │
┌─────────────────────────────────────────────────────────────┐
│                       proxypin-mcp                          │
│                                                             │
│  Ring Buffer (real-time)    ◀── request / response msgs     │
│  sendCommand() / pendingCmds ──▶ cmd_reply (history)        │
│                                                             │
│  MCP Tools ──▶ Claude Code / AI                             │
└─────────────────────────────────────────────────────────────┘
```

**Real-time traffic**: ProxyPin pushes every request and response through WebSocket. The MCP server buffers them in a ring buffer (default 1000 entries) and exposes them via `list_requests` / `get_request` / `search_requests`.

**History**: The MCP sends commands (`list_histories`, `get_history`, `search_history`, `get_history_detail`) over the same WebSocket. ProxyPin reads the HAR files on its end and returns only the fields needed — summaries for list/search, full HAR only for `get_history_detail`. This keeps AI context size bounded regardless of how many times history tools are called.

**Config sync**: ProxyPin sends a `config` message to the MCP on connect and whenever settings change (e.g. history access toggled), keeping the two sides in sync without polling.

## Quick Start

### 1. Enable WebSocket Push in ProxyPin

Settings → WebSocket Push → Enable (default port: 12080)

### 2. Configure MCP

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "proxypin": {
      "command": "npx",
      "args": ["proxypin-mcp", "--port", "12080"]
    }
  }
}
```

### 3. Use with AI

AI can now call these tools to analyze your traffic:

**Real-time tools**
- **list_requests** — Browse recent captured requests
- **get_request** — Get full request/response details (headers, body, timing)
- **search_requests** — Filter by URL keyword, HTTP method, or status code
- **get_stats** — Overview: connection status, status code distribution, top domains
- **clear_buffer** — Clear the buffer before a new capture session

**History tools** (requires History Access enabled in ProxyPin settings)
- **list_histories** — List all saved history sessions
- **get_history_requests** — Browse requests in a session (summary only)
- **search_history** — Search across all sessions by URL/method/status
- **get_history_detail** — Get full HAR entry for a specific request

## Options

| Flag | Env Variable | Default | Description |
|------|-------------|---------|-------------|
| `--port`, `-p` | `PROXYPIN_PORT` | `12080` | ProxyPin WebSocket push port |
| `--buffer-size` | `PROXYPIN_BUFFER_SIZE` | `1000` | Max requests to keep in memory |
| — | `PROXYPIN_WS_URL` | `ws://127.0.0.1:{port}` | Full WebSocket URL (overrides port) |

## Examples

```json
// Custom port
{ "args": ["proxypin-mcp", "--port", "9999"] }

// Larger buffer
{ "args": ["proxypin-mcp", "--port", "12080", "--buffer-size", "5000"] }

// Via environment variables
{
  "args": ["proxypin-mcp"],
  "env": { "PROXYPIN_PORT": "12080", "PROXYPIN_BUFFER_SIZE": "2000" }
}
```

---

## 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                      ProxyPin 应用                          │
│                                                             │
│  MITM 代理 ──▶ EventListener ──▶ WsTrafficServer :12080    │
│                                        │   ▲               │
│                                   推送 │   │ 命令          │
│                                        │   │（历史记录）    │
└────────────────────────────────────────┼───┼───────────────┘
                                         │   │
                                    WS   │   │  WS
                                         ▼   │
┌─────────────────────────────────────────────────────────────┐
│                       proxypin-mcp                          │
│                                                             │
│  环形缓冲区（实时）     ◀── request / response 消息         │
│  sendCommand() / pendingCmds ──▶ cmd_reply（历史）          │
│                                                             │
│  MCP 工具 ──▶ Claude Code / AI                              │
└─────────────────────────────────────────────────────────────┘
```

**实时流量**：ProxyPin 将每条请求和响应通过 WebSocket 推送过来，MCP 缓存到环形缓冲区（默认 1000 条），通过 `list_requests` / `get_request` / `search_requests` 暴露给 AI。

**历史记录**：MCP 通过同一个 WebSocket 发送命令（`list_histories` / `get_history` / `search_history` / `get_history_detail`），ProxyPin 在自己这边读取 HAR 文件，只返回所需字段——列表/搜索只返回摘要，完整 HAR 仅在 `get_history_detail` 时返回。无论调用多少次历史工具，AI 上下文大小都在可控范围内。

**配置同步**：ProxyPin 在客户端连接时以及设置变更时（如切换历史访问开关）向 MCP 推送 `config` 消息，两端状态保持同步，无需轮询。

## 快速开始

### 1. 在 ProxyPin 中开启 WebSocket 推送

设置 → WebSocket推送 → 启用（默认端口：12080）

### 2. 配置 MCP

在 `.mcp.json` 中添加：

```json
{
  "mcpServers": {
    "proxypin": {
      "command": "npx",
      "args": ["proxypin-mcp", "--port", "12080"]
    }
  }
}
```

### 3. 让 AI 分析流量

AI 可以调用以下工具分析你的抓包数据：

**实时工具**
- **list_requests** — 浏览最近捕获的请求列表
- **get_request** — 查看完整的请求/响应详情（请求头、响应体、耗时）
- **search_requests** — 按 URL 关键字、HTTP 方法或状态码过滤
- **get_stats** — 总览：连接状态、状态码分布、Top 域名
- **clear_buffer** — 清空缓冲区，开始新的抓包会话

**历史工具**（需在 ProxyPin 设置中开启"历史访问"）
- **list_histories** — 列出所有历史会话
- **get_history_requests** — 浏览某个会话的请求（仅摘要）
- **search_history** — 跨所有会话按 URL/方法/状态码搜索
- **get_history_detail** — 获取某条请求的完整 HAR 数据

## 配置参数

| 参数 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `--port`, `-p` | `PROXYPIN_PORT` | `12080` | ProxyPin WebSocket 推送端口 |
| `--buffer-size` | `PROXYPIN_BUFFER_SIZE` | `1000` | 内存中最大缓存请求数 |
| — | `PROXYPIN_WS_URL` | `ws://127.0.0.1:{port}` | 完整 WebSocket 地址（覆盖 port） |

## 配置示例

```json
// 自定义端口
{ "args": ["proxypin-mcp", "--port", "9999"] }

// 增大缓冲区
{ "args": ["proxypin-mcp", "--port", "12080", "--buffer-size", "5000"] }

// 通过环境变量配置
{
  "args": ["proxypin-mcp"],
  "env": { "PROXYPIN_PORT": "12080", "PROXYPIN_BUFFER_SIZE": "2000" }
}
```

## License

MIT
