#!/usr/bin/env node
/**
 * CLI entry: `cryptoapis-mcp-x402-accept --config ./x402-accept.config.json`
 */

import { loadConfig } from "./config.js";
import { startProxy } from "./server.js";

const USAGE = `
mcp-x402-accept — put an x402 paywall in front of an existing MCP server.

  cryptoapis-mcp-x402-accept --config <path>

Options:
  --config <path>   path to the JSON config (required)
  --help            show this message

The config declares the upstream server, your CryptoAPIs key, your receiving address, and
which tools are priced. See the README for a complete example.
`.trim();

function parseArgs(argv: string[]): { config?: string; help: boolean } {
    const out: { config?: string; help: boolean } = { help: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--help" || argv[i] === "-h") out.help = true;
        if (argv[i] === "--config" || argv[i] === "-c") out.config = argv[++i];
    }
    return out;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(`${USAGE}\n`);
        return;
    }
    if (!args.config) {
        throw new Error(`--config is required.\n\n${USAGE}`);
    }
    // Config problems surface here, at boot — never on an agent's first paid call.
    await startProxy(loadConfig(args.config));
}

main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
