# CLAUDE.md — @cryptoapis-io/mcp-x402-accept

The **merchant-side** MCP paywall proxy. Fronts an MCP server the merchant already runs and charges
agents per tool call with x402, without touching that server's code. The mirror image of
`mcp-x402-pay` (which is the buyer side).

```
agent → mcp-x402-accept (MERCHANT's process) → merchant's MCP server
```

It is an MCP **server** to the agent and an MCP **client** to the upstream — the only package in this
monorepo that is both.

## Non-negotiable: self-hosted only

CryptoAPIs never runs this process, and **we do not offer a hosted version** — decided deliberately,
not a default. Hosting it would mean holding merchants' upstream credentials, sitting in
the cleartext path of their tool arguments and results, taking on a GDPR data-processor role, and
owing uptime on their revenue. Self-hosting removes the question instead of answering it.

That decision is load-bearing on the CODE, and must survive future edits:

- **Tool arguments and results are OPAQUE.** The proxy reads only the tool *name* and
  `_meta["x402/payment"]`. Never parse, log, buffer or cache args/results. `upstream.callTool` and the
  handlers in `paywall.ts` forward verbatim — keep them that way.
- **Never log to stdout.** On a stdio MCP server stdout *is* the protocol stream; a stray line
  corrupts it. Diagnostics go to stderr, and are counts only — never payloads.

Note the sibling `mcp-x402-pay` logs every tool call via `McpLogger`. This package deliberately does
**not** — it would defeat the opacity guarantee above.

## Modules (`src/`)

- `config.ts` — zod-validated JSON config + `${VAR}` env interpolation (so the file holds no secrets
  and stays commit-safe). Everything fails at **boot**, never on an agent's first paid call.
- `upstream.ts` — the outbound MCP client (`stdio` or `streamableHttp`). Connect, list, forward.
  Nothing else belongs here.
- `paywall.ts` — wraps an upstream tool using the merchant SDK's `paymentTool`. **Reuses
  `@cryptoapis-io/x402-merchant-sdk/mcp` rather than reimplementing the transport**, so the template
  (the SDK's `examples/mcp-paid-tool/`) and this proxy share ONE x402 MCP implementation and a spec
  fix lands in both. Do not fork that logic in here.
- `server.ts` — mirrors upstream tools, registering each as paid or free; boots the stdio server.
- `cli.ts` — `cryptoapis-mcp-x402-accept --config <path>`.

## Design decisions that look like bugs

- **`pricedTools` is an allowlist; unpriced tools stay FREE.** Deliberate: silently breaking unpriced
  tools would make adding the proxy a breaking change for every agent already using the upstream.
- **A priced tool the upstream does not expose is a HARD boot failure.** The alternative is a silent
  revenue hole — the merchant believes a tool is paywalled while it serves for free.
- **`inputSchema` is a permissive passthrough**, not a translation of the upstream's JSON Schema. The
  upstream is the authority on its own inputs; a proxy that second-guesses it only adds ways to
  wrongly reject a valid call.
- **Priced tools get `[paid: x402]` appended to their description** so an agent knows the cost before
  calling, not by being refused.

## The ordering property

`payTool` runs its handler only after settlement, and the handler here is "call the upstream". So the
proxy **charges, then forwards** — it never forwards then bills. An unpaid call cannot reach the
merchant's server. This is enforced by construction, not by a check someone could remove; test 2 in
`tests/proxy.test.mjs` asserts it, and the free-tool test proves the detector actually fires.

## Commands

```bash
pnpm build       # tsc
pnpm typecheck
pnpm test        # builds, then node --test over tests/*.test.mjs
```

Tests spawn three real processes (client → proxy → fixture upstream) over stdio and need no network,
no API key and no money — the challenge is emitted before any facilitator call.

## Status

Built + end-to-end tested, **not yet published**. Requires a CryptoAPIs key with the
`X402_FACILITATOR` feature at runtime. Implements the x402 v2 MCP transport
(`specs/transports-v2/mcp.md`).
