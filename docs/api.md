# API reference

Base URL: `http://localhost:4026` when self-hosting. Machine-readable equivalents:
[`openapi.json`](https://github.com/nirholas/x402-domains/blob/main/openapi.json) and
[`/.well-known/x402`](https://github.com/nirholas/x402-domains/blob/main/public/.well-known/x402).

All prices are USDC. Every paid route accepts **both** rails — Base (EVM) and Solana — and
returns the purchased artifact in the 200 body.

---

## `GET /check/:domain`

**Price:** $0.001 · **Returns:** one `DomainCheck`

### Parameters

| name | in | type | required | notes |
|---|---|---|---|---|
| `domain` | path | string | yes | Registrable domain. Case-insensitive, trailing dot stripped. Internationalised names must be punycode (`xn--…`); Unicode is rejected as `INVALID_DOMAIN`. Max 253 chars. |

### Response 200 — `DomainCheck`

| field | type | meaning |
|---|---|---|
| `domain` | string | the normalised name that was queried |
| `status` | `"registered"` \| `"available"` \| `"unknown"` | see the table below |
| `available` | boolean \| null | `true` no registration found · `false` registered · `null` undetermined |
| `registrar` | string \| null | registrar name from the RDAP `registrar` entity's vCard `fn` |
| `registrarIanaId` | string \| null | IANA registrar ID from `publicIds` |
| `createdAt` | ISO 8601 \| null | RDAP `registration` event |
| `updatedAt` | ISO 8601 \| null | RDAP `last changed`, falling back to `last update of RDAP database` |
| `expiresAt` | ISO 8601 \| null | RDAP `expiration` event — registry expiry, not the registrar grace-period end |
| `nameservers` | string[] | delegated nameservers, lowercased; `[]` when none are published |
| `statusFlags` | string[] | EPP status codes, e.g. `client transfer prohibited`, `pending delete` |
| `dnssecSigned` | boolean \| null | `secureDNS.delegationSigned` |
| `rdapServer` | string \| null | the exact URL that answered — audit trail |
| `source` | `"rdap"` | always; this service has no fixture mode |
| `note` | string | present only when something needs explaining (404 semantics, upstream failure) |
| `checkedAt` | ISO 8601 | when the query ran |
| `receipt` | object \| null | the settlement receipt, mirroring `X-PAYMENT-RESPONSE` |

### How `status` is decided

| upstream | `status` | `available` |
|---|---|---|
| RDAP 200 with a domain object | `registered` | `false` |
| RDAP 404 | `available` | `true` |
| any other status, timeout, DNS failure, or non-JSON body | `unknown` | `null` |

`unknown` is not a soft `available`. Registries rate-limit; a handful of TLDs still have no
RDAP endpoint at all and fall through to the `rdap.org` aggregator, which may also decline.
When you see `unknown`, retry later or verify at the registrar — do not register on it.

### Example

```bash
curl -s localhost:4026/check/example.com -H "X-PAYMENT: $PAID" | jq
```

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
  "statusFlags": ["client delete prohibited", "client transfer prohibited", "client update prohibited"],
  "dnssecSigned": true,
  "rdapServer": "https://rdap.verisign.com/com/v1/domain/example.com",
  "source": "rdap",
  "checkedAt": "2026-08-07T12:00:00.000Z",
  "receipt": {
    "success": true,
    "rail": "evm",
    "network": "base-sepolia",
    "transaction": "0xabc…",
    "payer": "0xYourWallet",
    "amount": "1000",
    "asset": "USDC"
  }
}
```

An unregistered name:

```json
{
  "domain": "zz-free-9f2a1c.dev",
  "status": "available",
  "available": true,
  "registrar": null,
  "expiresAt": null,
  "nameservers": [],
  "rdapServer": "https://pubapi.registry.google/rdap/domain/zz-free-9f2a1c.dev",
  "source": "rdap",
  "note": "No registration found in the authoritative RDAP registry — the domain is likely available (registry-level reservations may still apply).",
  "checkedAt": "2026-08-07T12:00:00.000Z"
}
```

### Errors

| status | `error` | cause |
|---|---|---|
| 400 | `INVALID_DOMAIN` | not a syntactically valid domain |
| 402 | — | unpaid, malformed payment, or a rejected settlement; body is the challenge |
| 502 | `RDAP_UPSTREAM_ERROR` | an unexpected failure outside the `unknown` path |

---

## `POST /bulk`

**Price:** $0.005 · **Returns:** up to 50 `DomainCheck` objects plus counts

### Request body

```json
{ "domains": ["example.com", "openai.com", "zz-free-9f2a1c.dev"] }
```

| field | type | rules |
|---|---|---|
| `domains` | string[] | 1–50 entries. De-duplicated before lookup. Each is validated like the `/check` path param; an invalid entry comes back as `unknown` with a `note` rather than failing the call. |

Lookups run 8 at a time.

### Response 200

```json
{
  "count": 3,
  "registered": 2,
  "available": 1,
  "unknown": 0,
  "results": [ { "domain": "example.com", "status": "registered", "…": "…" } ],
  "checkedAt": "2026-08-07T12:00:00.000Z",
  "receipt": { "success": true, "rail": "solana", "network": "solana", "transaction": "5Qm…" }
}
```

| field | type | meaning |
|---|---|---|
| `count` | integer | number of **unique** domains checked — may be less than you sent |
| `registered` / `available` / `unknown` | integer | tallies over `results` |
| `results` | `DomainCheck[]` | same order as the de-duplicated input |
| `checkedAt` | ISO 8601 | when the batch finished |

### Errors

| status | `error` | cause |
|---|---|---|
| 400 | `BAD_REQUEST` | body is not `{ "domains": [...] }` |
| 400 | `EMPTY_LIST` | `domains` is empty |
| 400 | `TOO_MANY_DOMAINS` | more than 50 entries |
| 402 | — | payment required or rejected |
| 502 | `RDAP_UPSTREAM_ERROR` | unexpected failure |

---

## Free routes

| route | returns |
|---|---|
| `GET /` | service card: name, prices, rails, facilitator, doc links |
| `GET /health` | `{ ok: true, uptime: <seconds> }` |
| `GET /skill.md` | the agent-facing skill file, `text/markdown` |
| `GET /.well-known/x402` | resource manifest with prices, rails and output schemas |
| `GET /openapi.json` | OpenAPI 3.1 |

---

## Payment

### The 402 body

```jsonc
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [ /* one PaymentRequirements per rail */ ]
}
```

`PaymentRequirements`:

| field | example | notes |
|---|---|---|
| `scheme` | `"exact"` | the only scheme this service accepts |
| `network` | `"base-sepolia"` / `"solana"` | switched by `NETWORK` and `SOLANA_NETWORK` |
| `maxAmountRequired` | `"1000"` | base units; USDC has 6 decimals, so this is $0.001 |
| `resource` | `"http://localhost:4026/check/example.com"` | absolute URL being purchased |
| `description` | `"Live RDAP lookup for one domain…"` | shown by wallets and the checkout modal |
| `mimeType` | `"application/json"` | what the 200 will be |
| `payTo` | `0x40252CF…` / `WwwuGbqH…` | receive address for that rail |
| `maxTimeoutSeconds` | `60` | how long the authorisation stays valid |
| `asset` | USDC address / SPL mint | the token you pay in |
| `extra` | `{ name, version }` / `{ name, decimals, feePayer }` | EIP-712 domain on EVM; the fee sponsor on Solana |

### The receipt

Successful responses set `X-PAYMENT-RESPONSE` to base64 JSON, and repeat it as `receipt`:

```json
{
  "success": true,
  "rail": "evm",
  "network": "base-sepolia",
  "transaction": "0xabc…",
  "payer": "0xYourWallet",
  "amount": "1000",
  "asset": "USDC"
}
```

### 402 reasons

| `error` | meaning |
|---|---|
| `X-PAYMENT header is required` | first, unpaid attempt — normal |
| `invalid X-PAYMENT header: …` | not base64, or not an x402 payload |
| `unsupported rail: this endpoint does not accept exact on <network>` | you signed on a rail this server does not take |
| `insufficient_funds`, `payment_expired`, `invalid_exact_evm_payload_signature`, … | the facilitator's `invalidReason`, passed through verbatim |
| — | a facilitator outage answers `502 facilitator_unreachable` / `502 settlement_error` instead of 402 |
