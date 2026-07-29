# @cryptoapis-io/mcp-x402-accept

Put an **x402 paywall in front of an MCP server you already run** — charge AI agents per tool call
without changing a line of that server's code.

```
agent  →  mcp-x402-accept (your process)  →  your existing MCP server
```

The proxy is an MCP server to the agent and an MCP client to yours. It mirrors every tool your server
exposes; the ones you price are paywalled, the rest pass through free.

## When to use this (and when not to)

| Your situation | Use |
|---|---|
| You **can** edit your MCP server (Node/TS) | [`x402-merchant-sdk/mcp`](https://github.com/CryptoAPIs-io/cryptoapis-x402-merchant-sdk/tree/master/examples/mcp-paid-tool) — three lines around your handler, nothing in the data path |
| You **cannot** — third-party, closed-source, or not Node | **this proxy** |

If you can edit your server, do that instead. It is simpler and strictly fewer moving parts. This
package exists for the case where that is not an option.

## Why self-hosted only

**You run this process. We never do, and we do not offer a hosted version.**

That is a deliberate product decision, not a default you can flip. A proxy sits between an agent and
your server, so a hosted one would mean CryptoAPIs holding your upstream server's credentials, sitting
in the cleartext path of your tool arguments and results, and owing you uptime on your own revenue.
For a merchant whose product *is* the data flowing through those calls, that is not a reasonable thing
to ask. Self-hosting removes the question rather than answering it.

What that guarantees, structurally:

- Tool **arguments and results are opaque** to the proxy. It reads the tool *name* (is this priced?)
  and `_meta["x402/payment"]` (is it paid for?) — nothing else. They are never parsed, logged,
  buffered, or cached.
- Your upstream credentials are **your own env vars**, in your own process.
- The only outbound calls are to the CryptoAPIs facilitator, to `/verify` and `/settle` the payment
  itself.

## Install

```bash
npm install -g @cryptoapis-io/mcp-x402-accept
```

## Configure

```jsonc
{
  "upstream": {
    "transport": "stdio",
    "command": "node",
    "args": ["/path/to/your-mcp-server.js"],
    "env": { "YOUR_UPSTREAM_TOKEN": "${YOUR_UPSTREAM_TOKEN}" }
  },

  "apiKey": "${CRYPTOAPIS_API_KEY}",
  "payTo":  "0xYourReceivingAddress",

  // Only these are charged for. Everything else your server exposes stays FREE.
  "pricedTools": {
    "premium_data": {
      "network": "eip155:8453",
      "asset":   "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount":  "10000"
    }
  }
}
```

`${VAR}` reads from the environment, so the config file itself holds no secrets and is safe to commit.

`amount` is in **atomic units** — USDC has 6 decimals, so `"10000"` is $0.01. Getting this wrong by
10^6 is the easiest mistake here.

An HTTP upstream instead of stdio:

```jsonc
"upstream": {
  "transport": "http",
  "url": "https://your-server.example.com/mcp",
  "headers": { "Authorization": "Bearer ${YOUR_UPSTREAM_TOKEN}" }
}
```

To accept several assets or networks for one tool, pass an array — the agent picks one. Offer only
what `GET https://ai.cryptoapis.io/x402/merchant/supported` lists (public, no key); anything else is
advertised and then rejected at `/verify`.

## Run

```bash
cryptoapis-mcp-x402-accept --config ./x402-accept.config.json
```

Then point agents at the **proxy** instead of your server. In Claude Code:

```bash
claude mcp add my-paid-tools -- cryptoapis-mcp-x402-accept --config /abs/path/to/config.json
```

Everything is validated at boot — the config, the upstream connection, and whether the tools you
priced actually exist upstream. A typo'd tool name is a **hard failure**, not a silent revenue hole:
the alternative is believing a tool is paywalled while it quietly serves for free.

## What an agent sees

| Step | Result |
|---|---|
| Unpaid call to a priced tool | `isError: true` carrying `PaymentRequired` in **both** `structuredContent` and `content[0].text` |
| Agent pays | Signs locally, retries with the payload in `_meta["x402/payment"]` — raw JSON, no base64 |
| Paid call | Your tool's real result, with the receipt in `_meta["x402/payment-response"]` |
| Call to an unpriced tool | Forwarded, free, unchanged |

**Your server is never called until payment has settled.** The proxy charges and then forwards — it
does not forward and then bill. An unpaid call cannot reach your server at all, so it cannot be made
to do the work for free.

Priced tools advertise `[paid: x402]` in their description so an agent knows the cost *before*
calling. An agent that discovers a price only by being refused has already wasted a round-trip.

## Paying it

Agents pay with [`@cryptoapis-io/mcp-x402-pay`](https://www.npmjs.com/package/@cryptoapis-io/mcp-x402-pay)
or, in code, [`@cryptoapis-io/x402-buyer-sdk/mcp`](https://www.npmjs.com/package/@cryptoapis-io/x402-buyer-sdk).

## Notes

- Requires a CryptoAPIs API key with the **`X402_FACILITATOR`** feature.
- `"settle": false` verifies without settling — useful while wiring up, but advisory only: the buyer
  proved they *could* pay, not that they did. Never ship it.
- Test end-to-end on **Base Sepolia** (`eip155:84532`) before charging real money.
- Implements the x402 v2 MCP transport
  ([spec](https://github.com/coinbase/x402/blob/main/specs/transports-v2/mcp.md)), sharing one
  implementation with the merchant SDK — a spec fix lands in both.
