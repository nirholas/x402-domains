# For AI agents

This service is built to be used by software that was not written with it in mind. An
agent with a wallet needs no signup, no key, and no human in the loop: it discovers the
service, reads the price, pays, and gets the data.

## 1. Discover

Two files describe everything. Both are free and unauthenticated.

**`GET /skill.md`** — the agent-facing contract in Markdown: what the service does, every
endpoint with its price and response schema, how to pay, and the error table. Drop the URL
into a system prompt or a retrieval index and a model can use the service correctly with no
other documentation. This is the [agentres.dev](https://agentres.dev) `skill.md` pattern,
and its format is specified by
[`x402-skill-md`](https://github.com/nirholas/x402-skill-md).

**`GET /.well-known/x402`** — the machine-readable manifest:

```jsonc
{
  "x402Version": 1,
  "name": "x402-domains",
  "rails": [
    { "rail": "evm",    "network": "base-sepolia", "asset": "USDC", "payTo": "0x40252CF…2402" },
    { "rail": "solana", "network": "solana",       "asset": "USDC", "payTo": "WwwuGbqH…T3WwW" }
  ],
  "resources": [
    {
      "resource": "GET /check/:domain",
      "price": "$0.001",
      "accepts": [ { "network": "base-sepolia", … }, { "network": "solana", … } ],
      "outputSchema": { "type": "object", "properties": { "…": {} } }
    }
  ]
}
```

An agent can plan against `outputSchema` before spending anything, and budget against
`price`.

**`GET /openapi.json`** — OpenAPI 3.1, if your framework prefers to generate a client.

## 2. Pay

Every paid route answers an unpaid request with 402 and a **dual-rail** `accepts` array:
USDC on Base, USDC on Solana, same price, same artifact. Your agent picks whichever chain
its wallet lives on. Neither rail is preferred by the server.

**EVM rail** — sign an EIP-3009 `transferWithAuthorization`:

```ts
import { wrapFetchWithPayment } from "x402-fetch";
const pay = wrapFetchWithPayment(fetch, wallet);       // viem wallet client
const res = await pay("https://your-host/check/example.com");
const record = await res.json();                        // the artifact
```

**Solana rail** — build and sign the SPL transfer, then send the envelope:

```ts
import { prepareSolanaCheckout, encodeX402Payment } from "@three-ws/x402-payment-modal/server";

const accept = challenge.accepts.find((a) => a.network.startsWith("solana"));
const { tx_base64 } = await prepareSolanaCheckout({ accept, buyer: pubkey });
const { x_payment } = encodeX402Payment({
  accept,
  signedTxBase64: await wallet.signTransaction(tx_base64),
  resourceUrl: url,
});
await fetch(url, { headers: { "X-PAYMENT": x_payment } });
```

The Solana network fee is covered by the facilitator's sponsor account
(`accept.extra.feePayer`), so an agent holding only USDC can still pay.

## 3. What you get

The 200 body **is** the purchase. There is no job id, no webhook, nothing to poll:

```json
{
  "domain": "example.com",
  "status": "registered",
  "available": false,
  "registrar": "…",
  "expiresAt": "2025-08-13T04:00:00Z",
  "nameservers": ["…"],
  "dnssecSigned": true,
  "source": "rdap",
  "checkedAt": "2026-08-07T12:00:00.000Z"
}
```

Plus `X-PAYMENT-RESPONSE`, a base64 receipt naming the rail, network and transaction — keep
it if you need to reconcile spend later.

### Reasoning rules worth encoding

- `status: "unknown"` means the registry did not answer. It is **not** availability. Retry
  or check elsewhere before acting.
- `expiresAt` is registry expiry. A domain past it may still be in a redemption or grace
  period and not actually purchasable.
- Batch. Fifty `GET /check` calls cost $0.05; one `POST /bulk` with the same fifty costs
  $0.005 — a 10× saving for one extra line of code.

## 4. MCP integration

[`examples/mcp-tool.md`](https://github.com/nirholas/x402-domains/blob/main/examples/mcp-tool.md)
is a complete Model Context Protocol server exposing `check_domain` and
`check_domains_bulk`. The wallet lives in the MCP process, so its balance is the agent's
spending cap — fund it with what you are willing to lose and no more.

```json
{
  "mcpServers": {
    "x402-domains": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-domains.ts"],
      "env": { "PRIVATE_KEY": "0x…", "X402_DOMAINS_URL": "https://your-host" }
    }
  }
}
```

## 5. Getting listed

Deploy publicly, then submit the origin to the x402 discovery surfaces. Each of them reads
`/.well-known/x402`, which this server already serves at the root of your domain:

| where | what it does | how |
|---|---|---|
| [x402scan.com](https://x402scan.com) | indexes live x402 endpoints and their on-chain settlement volume | submit your origin; it crawls `/.well-known/x402` |
| **x402 Bazaar** | the protocol's own resource directory, queried by agents at runtime | register through the facilitator's `list` API |
| [agentic.market](https://agentic.market) | marketplace of agent-payable services | submit the origin plus your `skill.md` URL |

Before submitting, check that these are all reachable over HTTPS on your public origin, and
that `PUBLIC_BASE_URL` is set so 402 challenges quote absolute public URLs:

```
https://your-host/.well-known/x402
https://your-host/skill.md
https://your-host/openapi.json
```

Questions or a listing problem: **nichxbt@gmail.com**.
