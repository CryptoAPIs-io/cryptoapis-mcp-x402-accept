/**
 * The proxy server: an MCP server to the agent, an MCP client to the merchant's server.
 *
 *   agent → mcp-x402-accept (the MERCHANT's process) → merchant's MCP server
 *
 * It mirrors every tool the upstream exposes. Tools named in `pricedTools` are wrapped in an
 * x402 paywall; the rest are forwarded free. The merchant changes no code in their server.
 *
 * SELF-HOSTED ONLY — by design, not by default. CryptoAPIs never runs this process, so tool
 * arguments and results never leave the merchant's machine. See README.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ProxyConfig } from "./config.js";
import { connectUpstream } from "./upstream.js";
import { buildFreeHandler, buildPaidHandler, createPayFactory } from "./paywall.js";

/**
 * The upstream advertises JSON Schema; McpServer's `registerTool` wants a Zod raw shape.
 * Rather than translate (and risk rejecting an argument the upstream would have accepted),
 * the proxy declares a permissive shape and lets the UPSTREAM validate — it is the authority
 * on its own tools' inputs, and a proxy that second-guesses it only adds ways to be wrong.
 */
const PASSTHROUGH_SHAPE = {} as Record<string, never>;

/**
 * Start the paywall proxy.
 *
 * @param config the validated merchant config
 */
export async function startProxy(config: ProxyConfig): Promise<void> {
    const upstream = await connectUpstream(config.upstream);
    const pay = createPayFactory(config);

    const tools = await upstream.listTools();
    if (tools.length === 0) {
        throw new Error("the upstream MCP server exposes no tools — nothing to proxy");
    }

    // Catch a priced tool the upstream does not actually have. Left unchecked this is a
    // silent revenue hole: the merchant believes a tool is paywalled while it simply is not
    // there, or (worse) they typo'd a name that IS there and it stays free.
    const upstreamNames = new Set(tools.map((t) => t.name));
    const unknown = Object.keys(config.pricedTools).filter((name) => !upstreamNames.has(name));
    if (unknown.length > 0) {
        throw new Error(
            `pricedTools names tools the upstream does not expose: ${unknown.join(", ")}. ` +
            `Available: ${[...upstreamNames].join(", ")}`,
        );
    }

    const server = new McpServer({
        name: config.serverInfo?.name ?? "mcp-x402-accept",
        version: config.serverInfo?.version ?? "0.1.0",
        title: "x402 paywall proxy",
        websiteUrl: "https://developers.cryptoapis.io",
    });

    let paidCount = 0;
    for (const tool of tools) {
        const price = config.pricedTools[tool.name];
        const isPaid = price !== undefined;
        if (isPaid) paidCount++;

        server.registerTool(
            tool.name,
            {
                // Tell the agent what it costs BEFORE it calls. An agent that discovers the
                // price only by being refused has already spent a round-trip, and may pick a
                // competitor's tool instead.
                description: isPaid
                    ? `${tool.description ?? tool.name} [paid: x402]`
                    : tool.description ?? tool.name,
                inputSchema: PASSTHROUGH_SHAPE,
            },
            (isPaid
                ? buildPaidHandler(tool.name, price, upstream, pay)
                : buildFreeHandler(tool.name, upstream)) as never,
        );
    }

    // stderr, never stdout: stdout IS the MCP transport on a stdio server, and a stray line
    // there corrupts the protocol stream. Counts only — never tool arguments or results.
    process.stderr.write(
        `mcp-x402-accept: proxying ${tools.length} tool(s), ${paidCount} paywalled\n`,
    );

    const shutdown = async () => {
        await upstream.close().catch(() => {});
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await server.connect(new StdioServerTransport());
}
