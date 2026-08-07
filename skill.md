# x402-domains

Authoritative domain intelligence over RDAP (RFC 9082/9083, the IANA-standard successor to
WHOIS). Ask whether a domain is registered or available and get the registrar, creation /
last-changed / expiry dates, nameservers, EPP status flags and DNSSEC delegation — resolved
against the TLD's own authoritative RDAP server via the IANA bootstrap registry, live, on
every call. No API key exists for this data and none is needed; you pay per lookup in USDC
over x402 instead of holding a subscription.

- **Base URL:** `http://localhost:4026` (self-host) — replace with your deployment's origin.
- **Manifest:** `GET /.well-known/x402`
- **OpenAPI:** `GET /openapi.json`
- **Contact:** nichxbt@gmail.com

## Payment

This service speaks **x402** (HTTP 402 Payment Required). Every paid route answers an
unpaid request with a 402 whose `accepts` array carries **two rails — USDC on Base (EVM)
and USDC on Solana. Your client picks whichever it can sign.**

```jsonc
// 402 body
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402", "maxAmountRequired": "1000",
      "resource": "http://localhost:4026/check/example.com", "mimeType": "application/json" },
    { "scheme": "exact", "network": "solana", "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW", "maxAmountRequired": "1000",
      "resource": "http://localhost:4026/check/example.com", "mimeType": "application/json" }
  ]
}
```

- **Protocol:** x402 v1, scheme `exact`
- **Invocation contract:** every accept also carries `outputSchema.input` (how to build the
  request — method, query/path params, JSON body fields) and `outputSchema.output` (the JSON
  Schema of the 200 body). Both are elided above for readability and both are generated from
  `openapi.json`, so an agent can plan and call the route from the challenge alone.
- **Asset:** USDC (6 decimals) on both rails
- **Networks:** `base-sepolia` (default) or `base`; `solana` (default) or `solana-devnet`
- **Facilitators:** `https://x402.org/facilitator` (EVM rail) and
  `https://facilitator.payai.network` (Solana rail) — both override-able via
  `FACILITATOR_URL` / `SOLANA_FACILITATOR_URL`
- **How to pay:** any x402 client. `x402-fetch` + `viem` for the EVM rail, or any Solana
  x402 client / the `@three-ws/x402-payment-modal` checkout for the Solana rail. Sign the
  requirement you chose, base64 it into the `X-PAYMENT` header, retry the request.
- **Receipt:** successful responses carry `X-PAYMENT-RESPONSE` (base64 JSON:
  `{ success, rail, network, transaction, payer, amount, asset }`) and the same object
  inline as `receipt` in the body.

Payment is per request. There is no account, no key, and no minimum.

---

## `GET /check/:domain` — $0.001

One live RDAP lookup.

**Params**

| name | in | type | notes |
|---|---|---|---|
| `domain` | path | string | Registrable domain, e.g. `example.com`. IDN must be punycode (`xn--…`). Trailing dot is stripped. |

**Response 200**

```json
{
  "domain": "example.com",
  "status": "registered",
  "available": false,
  "registrar": "RESERVED-Internet Assigned Numbers Authority",
  "registrarIanaId": "376",
  "createdAt": "1995-08-14T04:00:00Z",
  "updatedAt": "2026-01-16T18:26:50Z",
  "expiresAt": "2026-08-13T04:00:00Z",
  "nameservers": ["elliott.ns.cloudflare.com", "hera.ns.cloudflare.com"],
  "statusFlags": ["client delete prohibited", "client transfer prohibited"],
  "dnssecSigned": true,
  "rdapServer": "https://rdap.verisign.com/com/v1/domain/example.com",
  "source": "rdap",
  "checkedAt": "2026-08-07T12:00:00.000Z",
  "receipt": { "success": true, "rail": "evm", "network": "base-sepolia", "transaction": "0x…" }
}
```

`status` is `available` when the authoritative registry returns 404 (no registration on
file), `registered` on a 200, and `unknown` when the TLD's RDAP server is unreachable, rate
limited, or does not implement RDAP — in which case `note` explains why and `available` is
`null`. Never treat `unknown` as available.

## `POST /bulk` — $0.005

Up to 50 domains in one paid call, checked with bounded concurrency (8 at a time).

**Body**

```json
{ "domains": ["example.com", "openai.com", "probably-free-73f2a.dev"] }
```

**Response 200**

```json
{
  "count": 3,
  "registered": 2,
  "available": 1,
  "unknown": 0,
  "results": [ /* one DomainCheck object per domain, same shape as /check */ ],
  "checkedAt": "2026-08-07T12:00:00.000Z",
  "receipt": { "success": true, "rail": "solana", "network": "solana", "transaction": "5Qm…" }
}
```

Duplicates are de-duplicated before lookup, so `count` may be lower than the number of
domains you sent.

## Free routes

| route | returns |
|---|---|
| `GET /` | service card: rails, prices, doc links |
| `GET /health` | `{ ok, uptime }` |
| `GET /skill.md` | this file |
| `GET /.well-known/x402` | machine-readable resource manifest |
| `GET /openapi.json` | OpenAPI 3.1 description |

## Errors

| status | body `error` | meaning |
|---|---|---|
| 400 | `INVALID_DOMAIN` | the path segment is not a syntactically valid domain |
| 400 | `EMPTY_LIST` | `/bulk` called with an empty `domains` array |
| 400 | `TOO_MANY_DOMAINS` | more than 50 domains in one `/bulk` call |
| 400 | `BAD_REQUEST` | `/bulk` body is not `{ "domains": [...] }` |
| 402 | — | payment required or rejected; body is the dual-rail challenge with `error` explaining why |
| 502 | `RDAP_UPSTREAM_ERROR` | the RDAP chain failed in a way the per-domain `unknown` status could not absorb |

A per-domain failure inside `/bulk` never fails the whole call — that domain comes back
with `status: "unknown"` and a `note`.
