/**
 * `@cryptoapis-io/mcp-x402-accept` — a self-hosted MCP proxy that puts an x402 paywall in
 * front of an existing MCP server.
 *
 * Normally run as a binary (`cryptoapis-mcp-x402-accept --config …`). These exports let a
 * merchant embed the proxy in a process they already run, or build a variant of it.
 */

export { loadConfig } from "./config.js";
export type { Price, ProxyConfig, Upstream } from "./config.js";
export { connectUpstream } from "./upstream.js";
export type { UpstreamConnection } from "./upstream.js";
export { buildFreeHandler, buildPaidHandler, createPayFactory } from "./paywall.js";
export { startProxy } from "./server.js";
