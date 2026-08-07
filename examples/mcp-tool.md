# Exposing x402-domains as an MCP tool

[Model Context Protocol](https://modelcontextprotocol.io) servers give Claude tools it can
call mid-conversation. Wrapping this service means Claude can *buy* a domain lookup while
you're talking to it — the wallet lives in the MCP server, not in the model.

## The server

```bash
npm install @modelcontextprotocol/sdk x402-fetch viem zod
```

`mcp-domains.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { wrapFetchWithPayment } from "x402-fetch";
import { z } from "zod";

const BASE_URL = process.env.X402_DOMAINS_URL ?? "http://localhost:4021";

// One wallet, reused for every purchase. Fund it with a small USDC balance and
// treat it as a spending budget — this is the whole point of agentic commerce.
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http() })
  .extend(publicActions);
const pay = wrapFetchWithPayment(fetch, wallet as never);

const server = new McpServer({ name: "x402-domains", version: "0.1.0" });

server.tool(
  "check_domain",
  "Check whether a domain is registered or available, with registrar, expiry date, " +
    "nameservers and DNSSEC status, straight from the authoritative RDAP registry. " +
    "Costs $0.001 USDC per call, paid automatically.",
  { domain: z.string().describe("Registrable domain, e.g. example.com") },
  async ({ domain }) => {
    const res = await pay(`${BASE_URL}/check/${encodeURIComponent(domain)}`);
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "check_domains_bulk",
  "Check up to 50 domains in one call. Costs $0.005 USDC total — much cheaper than 50 " +
    "single checks. Use this whenever you have more than five candidates.",
  { domains: z.array(z.string()).min(1).max(50) },
  async ({ domains }) => {
    const res = await pay(`${BASE_URL}/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domains }),
    });
    const data = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  },
);

await server.connect(new StdioServerTransport());
```

## Wiring it into Claude Desktop / Claude Code

`claude_desktop_config.json` (or `.mcp.json` for Claude Code):

```json
{
  "mcpServers": {
    "x402-domains": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/mcp-domains.ts"],
      "env": {
        "PRIVATE_KEY": "0xYourFundedTestnetKey",
        "X402_DOMAINS_URL": "https://your-deployment.example.com"
      }
    }
  }
}
```

Then:

> **You:** I need a name for a dev-tools startup. Check `ratchet.dev`, `ratchetlabs.com`,
> `getratchet.io`, `ratchet.sh` and `usratchet.com`.
>
> **Claude:** *(calls `check_domains_bulk` once — $0.005 — and reports which are free,
> who holds the rest, and when they expire)*

## Notes

- **Budget the wallet, not the tool.** Fund the MCP server's key with the amount you're
  willing to let the agent spend. That ceiling is the safety mechanism.
- **Prefer bulk.** Fifty single checks cost $0.05; one bulk call covering the same fifty
  costs $0.005. Say so in the tool description — the model will follow it.
- **Solana rail.** Swap `wrapFetchWithPayment` for a Solana x402 client if your agent's
  wallet lives on Solana; the service accepts either and the tool code is otherwise
  identical.
- **Discovery.** An agent that can read [`skill.md`](../skill.md) or
  `GET /.well-known/x402` can build this wrapper for itself — that's what those files are
  for.
