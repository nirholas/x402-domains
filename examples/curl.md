# The raw 402 → pay → 200 walkthrough

No SDK, no wrapper — just HTTP, so you can see exactly what the protocol does.

Start the server first:

```bash
npm install && npm run dev     # http://localhost:4021
```

## 0. Discover the service for free

```bash
curl -s http://localhost:4021/ | jq
curl -s http://localhost:4021/.well-known/x402 | jq '.resources[] | {resource, price}'
```

```
{ "resource": "GET /check/:domain", "price": "$0.001" }
{ "resource": "POST /bulk",         "price": "$0.005" }
```

## 1. Ask without paying → 402 with **both** rails

```bash
curl -i -s http://localhost:4021/check/example.com
```

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
```

```jsonc
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "1000",                 // 1000 base units = $0.001 USDC (6 dp)
      "resource": "http://localhost:4021/check/example.com",
      "description": "Live RDAP lookup for one domain: …",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "maxTimeoutSeconds": 60,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "1000",
      "resource": "http://localhost:4021/check/example.com",
      "description": "Live RDAP lookup for one domain: …",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "maxTimeoutSeconds": 60,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USD Coin", "decimals": 6, "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" }
    }
  ]
}
```

Just the rails:

```bash
curl -s http://localhost:4021/check/example.com \
  | jq '.accepts[] | {network, asset, payTo, maxAmountRequired}'
```

## 2. Build the payment

`X-PAYMENT` is base64 of a JSON payload that proves you authorised the exact amount to
`payTo` on the rail you chose.

**EVM rail** — an EIP-3009 `transferWithAuthorization` signature over
`{ from, to: payTo, value: maxAmountRequired, validAfter, validBefore, nonce }`, signed for
the USDC contract in `asset`:

```jsonc
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "base-sepolia",
  "payload": {
    "signature": "0x…",
    "authorization": {
      "from": "0xYourWallet",
      "to": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "value": "1000",
      "validAfter": "0",
      "validBefore": "1791234567",
      "nonce": "0x…"
    }
  }
}
```

**Solana rail** — a signed SPL `transferChecked` transaction, base64, wrapped in the same
envelope. `@three-ws/x402-payment-modal/server` builds and encodes it for you
(`prepareSolanaCheckout` → sign → `encodeX402Payment`).

Then:

```bash
X_PAYMENT=$(printf '%s' "$PAYLOAD_JSON" | base64 -w0)
```

Doing this by hand is educational once. After that use a client:

```bash
PRIVATE_KEY=0xyourTestnetKey npm run client
```

## 3. Retry with the header → 200 + the artifact

```bash
curl -i -s http://localhost:4021/check/example.com -H "X-PAYMENT: $X_PAYMENT"
```

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJyYWlsIjoiZXZtIiwi…
```

```json
{
  "domain": "example.com",
  "status": "registered",
  "available": false,
  "registrar": "RESERVED-Internet Assigned Numbers Authority",
  "expiresAt": "2025-08-13T04:00:00Z",
  "nameservers": ["a.iana-servers.net", "b.iana-servers.net"],
  "dnssecSigned": true,
  "source": "rdap",
  "checkedAt": "2026-08-07T12:00:00.000Z",
  "receipt": { "success": true, "rail": "evm", "network": "base-sepolia", "transaction": "0x…" }
}
```

Decode the receipt header:

```bash
echo "$RESPONSE_HEADER" | base64 -d | jq
```

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

## 4. Bulk

```bash
curl -s -X POST http://localhost:4021/bulk \
  -H "content-type: application/json" \
  -H "X-PAYMENT: $X_PAYMENT_5000" \
  -d '{"domains":["example.com","openai.com","zz-free-9f2a1c.dev"]}' | jq '{count,registered,available,unknown}'
```

Note the price is different ($0.005 → `maxAmountRequired: "5000"`), so this needs its own
payment — get the challenge from an unpaid `POST /bulk` first.

## Errors you may hit

| what you sent | you get |
|---|---|
| no header | 402, `error: "X-PAYMENT header is required"` |
| garbage header | 402, `error: "invalid X-PAYMENT header: …"` |
| a rail we don't take | 402, `error: "unsupported rail: …"` |
| an expired or short-paid authorisation | 402, `error:` the facilitator's `invalidReason` |
| `/check/not a domain` | 400, `INVALID_DOMAIN` |
| `/bulk` with 51 domains | 400, `TOO_MANY_DOMAINS` |
