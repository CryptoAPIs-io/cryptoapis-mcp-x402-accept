/**
 * The paywall itself: wrap an upstream tool so it is paid for with x402.
 *
 * This reuses `@cryptoapis-io/x402-merchant-sdk/mcp` rather than reimplementing the
 * transport — the same `paymentTool` a merchant would call by hand if they could edit their
 * server (see the SDK's `examples/mcp-paid-tool/`). The template and the proxy therefore
 * share ONE implementation of the x402 MCP transport, so a spec fix lands in both.
 *
 * The ordering property that makes this safe: `payTool` runs its handler only after
 * settlement, and the handler here is "call the upstream". So an unpaid call NEVER reaches
 * the merchant's server — the proxy does not forward, then charge; it charges, then
 * forwards. A merchant cannot be made to do the work for free, and an agent cannot use the
 * proxy to reach a priced tool for nothing.
 */

import { paymentTool } from "@cryptoapis-io/x402-merchant-sdk/mcp";
import type { Price, ProxyConfig } from "./config.js";
import type { UpstreamConnection } from "./upstream.js";

/** An MCP tool result. Opaque to the proxy — forwarded, never inspected. */
type ToolResult = { content?: unknown[]; isError?: boolean; _meta?: Record<string, unknown> };

/**
 * Build the paid handler for one upstream tool.
 *
 * @param toolName the tool's name, as the upstream exposes it
 * @param price the configured price (or list of accepted prices)
 * @param upstream the connected upstream
 * @param pay the merchant SDK's configured `payTool` factory
 * @returns an MCP tool handler that charges, then forwards
 */
export function buildPaidHandler(
    toolName: string,
    price: Price | Price[],
    upstream: UpstreamConnection,
    pay: ReturnType<typeof paymentTool>,
): (args: Record<string, unknown>, extra?: unknown) => Promise<ToolResult> {
    return pay(
        toolName,
        price,
        // Reached ONLY after the payment has settled.
        async (args: Record<string, unknown>) => {
            // Forward verbatim. We do not read, reshape, log or cache either the arguments
            // or the result — the merchant's product passes through this line untouched.
            return (await upstream.callTool(toolName, args)) as ToolResult;
        },
    ) as (args: Record<string, unknown>, extra?: unknown) => Promise<ToolResult>;
}

/**
 * Build the free pass-through handler for an unpriced tool.
 *
 * Tools the merchant did not price stay FREE and fully usable. An allowlist that silently
 * broke unpriced tools would make adding the proxy a breaking change for every agent
 * already using the upstream.
 *
 * @param toolName the tool's name
 * @param upstream the connected upstream
 * @returns a handler that forwards without charging
 */
export function buildFreeHandler(
    toolName: string,
    upstream: UpstreamConnection,
): (args: Record<string, unknown>) => Promise<ToolResult> {
    return async (args: Record<string, unknown>) => (await upstream.callTool(toolName, args)) as ToolResult;
}

/**
 * Create the SDK's `payTool` factory from the merchant's config.
 *
 * @param config the validated proxy config
 * @returns the configured factory
 */
export function createPayFactory(config: ProxyConfig): ReturnType<typeof paymentTool> {
    return paymentTool({
        apiKey: config.apiKey,
        payTo: config.payTo,
        baseUrl: config.baseUrl,
        settle: config.settle ?? true,
    });
}
