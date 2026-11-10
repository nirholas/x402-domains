---
name: x402-domains
description: Call the x402-domains HTTP service for a live RDAP lookup of one domain or up to 50 at once: availability, registrar, creation and expiry dates, nameservers and DNSSEC. Use when an agent needs authoritative domain registration data.
---

# x402-domains

x402-domains is an Express service that resolves domains against each TLD's own RDAP server through the IANA bootstrap registry, live on every call. No upstream API key is needed; callers pay per lookup in USDC over x402.

## Run it

No package is published and there is no hosted instance, so run it from a clone: `git clone https://github.com/nirholas/x402-domains && cd x402-domains`, then `npm install`, `cp .env.example .env`, and `npm run dev` (tsx `src/server.ts`). It listens on `PORT`, default 4026. For production use `npm run build` then `npm start`.

Key env vars: `PORT`, `PUBLIC_BASE_URL`, `PAY_TO_ADDRESS`, `SOLANA_PAY_TO_ADDRESS`, `NETWORK`, `SOLANA_NETWORK`, `SOLANA_RPC_URL`, `FACILITATOR_URL`, `SOLANA_FACILITATOR_URL`.

## Endpoints

- `GET /check/:domain` ($0.001). One live RDAP lookup. `domain` is a registrable domain such as `example.com`; internationalized names must be punycode (`xn--...`). The 200 body includes `domain`, `status` (`registered`, `available` or `unknown`), `available`, `registrar`, `registrarIanaId`, `createdAt`, `updatedAt`, `expiresAt`, plus a `receipt`.
- `POST /bulk` ($0.005). Body `{"domains": ["example.com", "example.org"]}` with 1 to 50 entries. Returns `count`, `registered`, `available`, `unknown`, `results[]`, `checkedAt` and `receipt`.
- `GET /health`, `GET /.well-known/x402`, `GET /skill.md`, `GET /openapi.json` (free).

Errors: 400 `BAD_REQUEST` for a malformed bulk body or a `DomainError` code for an invalid domain, 502 `RDAP_UPSTREAM_ERROR` when the TLD's RDAP server fails.

Example: `GET {BASE_URL}/check/example.com` first returns 402; after payment it returns the record. Use `/bulk` when checking more than one name, since it costs less than repeated single lookups.

## Paying

Every paid route answers an unpaid request with HTTP 402 and a body whose `accepts` array lists two rails: USDC on Base (`base-sepolia` by default, `base` via `NETWORK`) and USDC on Solana (`solana` by default, `solana-devnet` via `SOLANA_NETWORK`). Pick the entry your wallet can sign, sign the USDC payment (EIP-3009 on Base, SPL `transferChecked` on Solana), and retry with the base64 `X-PAYMENT` header. The artifact is in the 200 body and the settlement receipt is in the `X-PAYMENT-RESPONSE` header. On the EVM rail `x402-fetch` with `viem` does this for you; `npm run client` runs `examples/agent-client.ts`, which reads `BASE_URL` and `PRIVATE_KEY`.

Discovery: `GET /.well-known/x402` lists routes, prices and rails, and `GET /skill.md` serves the repo's own reference. Paying moves real USDC on the configured network, so show the user the route, amount and rail first and wait for a yes before any paid call. Use a throwaway wallet on `base-sepolia` or `solana-devnet` for testing.
