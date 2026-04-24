# Changelog

All notable changes to this project will be documented in this file.
本文件记录项目所有重要变更。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)，版本号遵循 [语义化版本](https://semver.org/spec/v2.0.0.html)。

---

## [1.0.0] - 2026-04-24

### Added / 新增

- Real-time HTTP(S) traffic capture via ProxyPin WebSocket push
  通过 ProxyPin WebSocket 推送实时捕获 HTTP(S) 流量
- Ring buffer with configurable capacity (`--buffer-size` / `PROXYPIN_BUFFER_SIZE`)
  可配置容量的环形缓冲区（`--buffer-size` / `PROXYPIN_BUFFER_SIZE`）
- MCP tools: `list_requests`, `get_request`, `search_requests`, `get_stats`, `clear_buffer`
  实时流量工具：`list_requests`、`get_request`、`search_requests`、`get_stats`、`clear_buffer`
- History tools: `list_histories`, `get_history_requests`, `search_history`, `get_history_detail`
  历史记录工具：`list_histories`、`get_history_requests`、`search_history`、`get_history_detail`
- Bidirectional WebSocket command/reply protocol for history access
  双向 WebSocket 命令/回复协议，用于历史记录访问
- Config sync — ProxyPin pushes `config` message on connect and settings change
  配置同步——ProxyPin 在连接及设置变更时推送 `config` 消息
- Auto-reconnect with 5-second back-off
  断线自动重连（5 秒间隔）
- CLI flags `--port` / `-p` and `--buffer-size`; env vars `PROXYPIN_PORT`, `PROXYPIN_BUFFER_SIZE`, `PROXYPIN_WS_URL`
  支持命令行参数 `--port` / `-p`、`--buffer-size` 及环境变量 `PROXYPIN_PORT`、`PROXYPIN_BUFFER_SIZE`、`PROXYPIN_WS_URL`
- Bilingual README (English / 中文)
  中英双语 README
