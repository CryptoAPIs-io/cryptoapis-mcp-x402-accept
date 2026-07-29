/**
 * A fixture "merchant's existing MCP server" for the proxy tests.
 *
 * Two tools: one the proxy will paywall, one it will leave free. It also records every call
 * to stderr so a test can assert the upstream was NOT reached on an unpaid call — the single
 * most important property of the proxy.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fixture-upstream", version: "1.0.0" });

server.registerTool(
    "premium_data",
    {
        description: "The merchant's valuable tool",
        inputSchema: { query: z.string() },
    },
    async ({ query }) => {
        process.stderr.write(`UPSTREAM_CALLED:premium_data:${query}\n`);
        return { content: [{ type: "text", text: `secret answer for ${query}` }] };
    },
);

server.registerTool(
    "free_ping",
    {
        description: "A free tool the merchant did not price",
        inputSchema: {},
    },
    async () => {
        process.stderr.write("UPSTREAM_CALLED:free_ping\n");
        return { content: [{ type: "text", text: "pong" }] };
    },
);

await server.connect(new StdioServerTransport());
