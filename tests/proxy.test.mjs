/**
 * End-to-end test of the paywall proxy: a real MCP client → the proxy → a real upstream
 * MCP server, all three as separate processes over stdio.
 *
 * The properties that matter:
 *   1. every upstream tool is mirrored (paid AND free);
 *   2. an unpaid call to a PRICED tool returns a conformant x402 challenge;
 *   3. that call NEVER reaches the upstream (the merchant does no unpaid work);
 *   4. an UNPRICED tool still works, free, and does reach the upstream.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");

/** Write a config pointing the proxy at the fixture upstream. */
function writeConfig() {
    const dir = mkdtempSync(join(tmpdir(), "x402-accept-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({
        upstream: {
            transport: "stdio",
            command: process.execPath,
            args: [join(HERE, "fixture-upstream.mjs")],
        },
        // Never used: the challenge is emitted BEFORE any facilitator call, so these tests
        // exercise the proxy without touching the network or moving money.
        apiKey: "test-key-not-real",
        payTo: "0x6198000000000000000000000000000000005A6e",
        pricedTools: {
            premium_data: { network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "10000" },
        },
    }, null, 2));
    return path;
}

/** Connect a client to the proxy, capturing the proxy's (and upstream's) stderr. */
async function connectToProxy(configPath) {
    const stderr = [];
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [join(PKG, "dist", "cli.js"), "--config", configPath],
        stderr: "pipe",
    });
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(transport);
    transport.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));
    // Let the upstream's startup chatter land before any assertion reads it.
    await new Promise((r) => setTimeout(r, 300));
    return { client, stderr: () => stderr.join("") };
}

test("mirrors every upstream tool, marking the priced one", async () => {
    const { client } = await connectToProxy(writeConfig());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    assert.deepEqual(names, ["free_ping", "premium_data"], "both upstream tools are mirrored");

    const paid = tools.find((t) => t.name === "premium_data");
    assert.match(paid.description, /\[paid: x402\]/, "the priced tool advertises that it costs money");

    const free = tools.find((t) => t.name === "free_ping");
    assert.doesNotMatch(free.description, /\[paid: x402\]/, "the unpriced tool is not marked paid");

    await client.close();
});

test("an unpaid call is challenged AND never reaches the upstream", async () => {
    const { client, stderr } = await connectToProxy(writeConfig());

    const result = await client.callTool({ name: "premium_data", arguments: { query: "gold" } });

    assert.equal(result.isError, true, "unpaid call is an error result");

    const body = result.structuredContent;
    assert.equal(body.x402Version, 2, "x402Version is 2");
    assert.equal(body.resource.url, "mcp://tool/premium_data", "resource.url is the spec's mcp://tool/<name>");
    assert.ok(Array.isArray(body.accepts) && body.accepts.length > 0, "accepts is populated");
    assert.equal(body.accepts[0].network, "eip155:8453", "the configured network is offered");
    assert.equal(body.accepts[0].amount, "10000", "the configured atomic amount is offered");

    // The spec requires the challenge in BOTH forms, identical.
    const text = JSON.parse(result.content[0].text);
    assert.deepEqual(text, body, "structuredContent and content[0].text carry identical data");

    // THE load-bearing assertion: the merchant's server did no unpaid work.
    assert.doesNotMatch(stderr(), /UPSTREAM_CALLED:premium_data/, "upstream was NOT called for an unpaid request");

    await client.close();
});

test("an unpriced tool passes through free and does reach the upstream", async () => {
    const { client, stderr } = await connectToProxy(writeConfig());

    const result = await client.callTool({ name: "free_ping", arguments: {} });

    assert.notEqual(result.isError, true, "a free tool is not challenged");
    assert.equal(result.content[0].text, "pong", "the upstream's real result is forwarded verbatim");

    await new Promise((r) => setTimeout(r, 200));
    assert.match(stderr(), /UPSTREAM_CALLED:free_ping/, "upstream WAS called for the free tool");

    await client.close();
});

test("a priced tool the upstream does not expose fails at BOOT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "x402-accept-bad-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({
        upstream: { transport: "stdio", command: process.execPath, args: [join(HERE, "fixture-upstream.mjs")] },
        apiKey: "test-key-not-real",
        payTo: "0x6198000000000000000000000000000000005A6e",
        pricedTools: {
            typo_tool: { network: "eip155:8453", asset: "0xabc", amount: "10000" },
        },
    }));

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [join(PKG, "dist", "cli.js"), "--config", path],
        stderr: "pipe",
    });
    const client = new Client({ name: "test-agent", version: "1.0.0" });

    await assert.rejects(
        () => client.connect(transport),
        "connecting to a proxy with a bogus priced tool fails rather than silently leaving it free",
    );
});
