/**
 * The outbound half of the proxy: an MCP CLIENT connected to the merchant's existing server.
 *
 * The proxy is an MCP server to the agent AND an MCP client to the merchant's server. This
 * module is the second half. It deliberately does nothing but connect, list and forward —
 * all payment logic lives in `paywall.ts`, and tool arguments/results pass through here
 * untouched and uninspected.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Upstream } from "./config.js";

/** What the proxy needs from the upstream: its tools, and a way to call them. */
export type UpstreamConnection = {
    listTools: () => Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>>;
    callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
    close: () => Promise<void>;
};

/**
 * Connect to the merchant's MCP server.
 *
 * @param upstream the validated upstream config
 * @returns a connection the proxy forwards through
 */
export async function connectUpstream(upstream: Upstream): Promise<UpstreamConnection> {
    const client = new Client(
        { name: "mcp-x402-accept", version: "0.1.0" },
        // The proxy forwards tool calls only. It does not expose the agent's roots or
        // sampling to the upstream, and does not claim capabilities it cannot honour.
        { capabilities: {} },
    );

    const transport = upstream.transport === "stdio"
        ? new StdioClientTransport({
            command: upstream.command,
            args: upstream.args ?? [],
            // The upstream's OWN credentials. On a self-hosted proxy this is the merchant's
            // process reading the merchant's env — nothing leaves their machine.
            env: { ...(process.env as Record<string, string>), ...(upstream.env ?? {}) },
        })
        : new StreamableHTTPClientTransport(new URL(upstream.url), {
            requestInit: { headers: upstream.headers ?? {} },
        });

    await client.connect(transport);

    return {
        listTools: async () => {
            const { tools } = await client.listTools();
            return tools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
            }));
        },
        // Arguments in, result out, nothing examined in between. Keep it that way: the
        // opacity guarantee in the README is only worth as much as this function's body.
        callTool: async (name, args) => client.callTool({ name, arguments: args }),
        close: async () => client.close(),
    };
}
