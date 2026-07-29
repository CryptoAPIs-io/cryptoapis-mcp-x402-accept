/**
 * Configuration for the self-hosted x402 paywall proxy.
 *
 * The merchant runs this process themselves, so every secret here is THEIR own: their
 * CryptoAPIs key, their receiving address, their upstream server's credentials. We never
 * see any of it — see README's "Why self-hosted only".
 *
 * Config comes from a JSON file (`--config`) because the interesting part is a per-tool
 * price map, which does not fit env vars cleanly. Secrets may still come from the
 * environment via `${VAR}` interpolation, so the file itself stays commit-safe.
 */

import { readFileSync } from "node:fs";
import { z } from "zod";

/** A price for one tool. Mirrors the merchant SDK's price spec (atomic units, CAIP-2). */
const PriceSchema = z.object({
    network: z.string().min(1).describe("CAIP-2 network id, e.g. eip155:8453"),
    asset: z.string().min(1).describe("token contract/mint, or the `native` sentinel"),
    amount: z.string().min(1).describe("ATOMIC units — USDC has 6 decimals, so 10000 = $0.01"),
    payTo: z.string().min(1).optional().describe("receiving address; defaults to the top-level payTo"),
    maxTimeoutSeconds: z.number().int().positive().optional(),
    extra: z.record(z.unknown()).optional().describe("family-specific extra, e.g. SVM { feePayer, decimals, tokenProgram }"),
});

/** How to reach the merchant's existing MCP server. */
const UpstreamSchema = z.union([
    z.object({
        transport: z.literal("stdio"),
        command: z.string().min(1),
        args: z.array(z.string()).optional(),
        env: z.record(z.string()).optional().describe("env for the upstream process — its own credentials live here"),
    }),
    z.object({
        transport: z.literal("http"),
        url: z.string().url(),
        headers: z.record(z.string()).optional().describe("auth headers for the upstream server"),
    }),
]);

const ConfigSchema = z.object({
    upstream: UpstreamSchema,
    apiKey: z.string().min(1).describe("CryptoAPIs key with the X402_FACILITATOR feature"),
    payTo: z.string().min(1).describe("default receiving address for every priced tool"),
    baseUrl: z.string().url().optional().describe("facilitator base URL override (QA/local)"),
    settle: z.boolean().optional().describe("false = verify without settling. Advisory only; never ship it"),
    /**
     * The paywall. Only tools named here are charged for; everything else the upstream
     * exposes is proxied through untouched and FREE. An allowlist, not a blocklist: a tool
     * the merchant forgets to price stays free rather than becoming silently unreachable.
     */
    pricedTools: z.record(z.union([PriceSchema, z.array(PriceSchema).nonempty()])),
    serverInfo: z.object({
        name: z.string().min(1).optional(),
        version: z.string().min(1).optional(),
    }).optional(),
});

export type Price = z.infer<typeof PriceSchema>;
export type Upstream = z.infer<typeof UpstreamSchema>;
export type ProxyConfig = z.infer<typeof ConfigSchema>;

/** `${VAR}` → process.env.VAR, so a config file can reference secrets without holding them. */
function interpolateEnv(raw: string): string {
    return raw.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
        const value = process.env[name];
        if (value === undefined) {
            throw new Error(`config references \${${name}} but that environment variable is not set`);
        }
        return value;
    });
}

/**
 * Read, interpolate and validate the config file.
 *
 * Every problem is raised HERE, at boot — a proxy that starts and only fails when an agent
 * tries to pay looks like a payment outage to the agent and costs the merchant a sale.
 */
export function loadConfig(path: string): ProxyConfig {
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch (err) {
        throw new Error(`cannot read config file ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(interpolateEnv(raw));
    } catch (err) {
        throw new Error(`config file ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }

    const result = ConfigSchema.safeParse(parsed);
    if (!result.success) {
        const issues = result.error.issues
            .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("\n");
        throw new Error(`config file ${path} is invalid:\n${issues}`);
    }
    if (Object.keys(result.data.pricedTools).length === 0) {
        throw new Error("config has no pricedTools — the proxy would charge for nothing. Price at least one tool.");
    }
    return result.data;
}
