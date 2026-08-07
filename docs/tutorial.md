# Tutorial — from clone to a paid domain lookup

Fifteen minutes, no accounts, no API keys. By the end you will have run the server, seen a
real dual-rail 402, paid it with testnet USDC, and read the artifact out of the 200.

## 1. Install

```bash
git clone https://github.com/nirholas/x402-domains.git
cd x402-domains
npm install
```

Node 18 or newer. The only runtime dependencies are `express`, `x402` and `dotenv`.

## 2. Configure (optional)

```bash
cp .env.example .env
```

`.env.example` ships with the suite's public receive addresses already filled in, so the
server runs as-is:

```bash
PAY_TO_ADDRESS=0x40252CFDF8B20Ed757D61ff157719F33Ec332402
SOLANA_PAY_TO_ADDRESS=WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW
```

Change both to your own addresses if you want the money. Everything else is commented out
and has a sane default: `base-sepolia` for the EVM rail, `solana` mainnet for the Solana
rail, `https://x402.org/facilitator` for EVM settlement, `https://facilitator.payai.network`
for Solana settlement (the reference x402.org facilitator only settles Base Sepolia), and
port `4021`.

There is no API key to obtain. RDAP is keyless and public — that is the whole point of
this service.

## 3. Run the server

```bash
npm run dev
```

```
x402-domains listening on http://localhost:4021
Payment rails (USDC — the client picks):
  evm     base-sepolia   → 0x40252CFDF8B20Ed757D61ff157719F33Ec332402  via https://x402.org/facilitator
  solana  solana         → WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW  via https://facilitator.payai.network
  note: using suite default payTo — set PAY_TO_ADDRESS / SOLANA_PAY_TO_ADDRESS to receive funds yourself
Paid routes:
  GET /check/:domain       $0.001
  POST /bulk               $0.005
Free routes: GET /  GET /health  GET /skill.md  GET /.well-known/x402  GET /openapi.json
```

Sanity check the free routes:

```bash
curl -s localhost:4021/health
curl -s localhost:4021/.well-known/x402 | jq '.resources[].resource'
```

## 4. Your first 402

```bash
curl -i -s localhost:4021/check/example.com
```

```http
HTTP/1.1 402 Payment Required
```

```jsonc
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "1000",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402", … },
    { "scheme": "exact", "network": "solana", "maxAmountRequired": "1000",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW", … }
  ]
}
```

Read it as a price list. `maxAmountRequired` is in the asset's base units: USDC has six
decimals, so `"1000"` is $0.001. Two entries means two ways to pay for the identical
resource — **your client chooses**, the server does not care.

## 5. Get a funded test wallet

For the EVM rail on Base Sepolia:

1. Make a throwaway key: `openssl rand -hex 32` → prefix it with `0x`.
2. Get its address: `npx tsx -e "import {privateKeyToAccount} from 'viem/accounts'; console.log(privateKeyToAccount(process.env.K).address)"`.
3. Fund it with testnet USDC from the [Circle faucet](https://faucet.circle.com) (pick Base
   Sepolia). You need cents, not dollars.

## 6. Pay for a lookup

```bash
PRIVATE_KEY=0xyourTestnetKey npm run client
```

`examples/agent-client.ts` does the whole dance:

```
① Unpaid request → expect a dual-rail 402
   HTTP 402
   accepts: base-sepolia   1000 base units USDC → 0x40252CF…
   accepts: solana         1000 base units USDC → WwwuGbqH…

② Paying from 0xYourWallet on Base Sepolia …

③ 200 — the artifact:
{
  "domain": "example.com",
  "status": "registered",
  "available": false,
  "registrar": "RESERVED-Internet Assigned Numbers Authority",
  "createdAt": "1995-08-14T04:00:00Z",
  "expiresAt": "2025-08-13T04:00:00Z",
  "nameservers": ["a.iana-servers.net", "b.iana-servers.net"],
  "dnssecSigned": true,
  "source": "rdap",
  "checkedAt": "2026-08-07T12:00:00.000Z"
}

   X-PAYMENT-RESPONSE: { success: true, rail: 'evm', network: 'base-sepolia', transaction: '0x…' }
```

What `wrapFetchWithPayment` did for you: caught the 402, picked the `base-sepolia` entry out
of `accepts`, signed an EIP-3009 `transferWithAuthorization` for exactly 1000 base units to
`payTo`, base64'd it into `X-PAYMENT`, and replayed the request. The server verified and
settled it through the facilitator before the route handler ever ran.

## 7. Reading the artifact

Two fields decide everything:

| `status` | `available` | what it means |
|---|---|---|
| `registered` | `false` | the registry has a record; `registrar`, `expiresAt`, `nameservers` are populated |
| `available` | `true` | the registry returned 404 — likely registrable, though premium/reserved lists may still apply |
| `unknown` | `null` | the RDAP server failed or the TLD has no RDAP; `note` says which. **Not** a synonym for available |

`expiresAt` is the registry's expiry, not the registrar's grace-period end — a domain can
be past `expiresAt` and still not be released.

## 8. Bulk

Fifty single checks cost $0.05. One `POST /bulk` covering the same fifty costs $0.005:

```bash
curl -s -X POST localhost:4021/bulk \
  -H 'content-type: application/json' \
  -H "X-PAYMENT: $PAID" \
  -d '{"domains":["example.com","openai.com","zz-free-9f2a1c.dev"]}' \
  | jq '{count, registered, available, unknown}'
```

Duplicates are removed before lookup, so `count` can be smaller than what you sent.

## 9. Paying on the Solana rail instead

The same 402 already offered it. Take the `solana` entry, build the SPL transfer, sign it,
and send the envelope:

```ts
import { prepareSolanaCheckout, encodeX402Payment } from "@three-ws/x402-payment-modal/server";

const challenge = await (await fetch(`${BASE}/check/example.com`)).json();
const accept = challenge.accepts.find((a) => a.network.startsWith("solana"));

const { tx_base64 } = await prepareSolanaCheckout({ accept, buyer: myPubkey });
const signed = await wallet.signTransaction(tx_base64);      // Phantom, Solflare, a keypair
const { x_payment } = encodeX402Payment({
  accept,
  signedTxBase64: signed,
  resourceUrl: `${BASE}/check/example.com`,
});

const res = await fetch(`${BASE}/check/example.com`, { headers: { "X-PAYMENT": x_payment } });
```

The network fee is paid by the facilitator's sponsor account (`accept.extra.feePayer`), so
the buyer needs USDC and no SOL. Set `SOLANA_NETWORK=devnet` to rehearse on devnet.

## 10. Going to mainnet

```bash
# EVM rail → Base mainnet
NETWORK=base
FACILITATOR_URL=https://your-mainnet-facilitator.example

# Solana rail → already mainnet by default
SOLANA_NETWORK=mainnet-beta
SOLANA_RPC_URL=https://your-rpc-provider.example

# your own addresses, or you are donating to the suite
PAY_TO_ADDRESS=0xYourMainnetAddress
SOLANA_PAY_TO_ADDRESS=YourSolanaAddress

# so 402 challenges quote absolute public URLs
PUBLIC_BASE_URL=https://domains.yourdomain.com
```

`https://x402.org/facilitator` is a testnet convenience. For real money, point
`FACILITATOR_URL` at a mainnet-capable facilitator (Coinbase CDP's, or your own) — it is
the component that verifies signatures and broadcasts settlement, so choose it as
deliberately as you would a payment processor.

Then list the deployment: submit your origin to [x402scan.com](https://x402scan.com), the
x402 Bazaar, and [agentic.market](https://agentic.market). They read
`/.well-known/x402`, which this server already serves.

## Next

- [API reference](api.md) — every field of every response
- [For AI agents](agents.md) — discovery, MCP, listing
- [`examples/curl.md`](https://github.com/nirholas/x402-domains/blob/main/examples/curl.md) — the protocol by hand
