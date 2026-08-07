/**
 * examples/agent-client.ts — the full paid flow, end to end.
 *
 *   PRIVATE_KEY=0x… npm run client
 *
 * `wrapFetchWithPayment` intercepts the 402, picks the EVM requirement out of
 * the dual-rail `accepts` array, signs an EIP-3009 authorisation for the exact
 * amount, and retries with the `X-PAYMENT` header. You just call fetch.
 *
 * The Solana rail is shown further down — same challenge, different signer.
 */
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4021";
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;

async function showChallenge(): Promise<void> {
  console.log(`\n① Unpaid request → expect a dual-rail 402\n   GET ${BASE_URL}/check/example.com`);
  const res = await fetch(`${BASE_URL}/check/example.com`);
  const body = await res.json();
  console.log(`   HTTP ${res.status}`);
  for (const a of body.accepts ?? []) {
    console.log(
      `   accepts: ${String(a.network).padEnd(14)} ${a.maxAmountRequired} base units USDC → ${a.payTo}`,
    );
  }
}

async function main(): Promise<void> {
  await showChallenge();

  if (!PRIVATE_KEY) {
    console.log(
      "\nSet PRIVATE_KEY to a funded Base Sepolia wallet to complete the purchase." +
        "\nTestnet USDC faucet: https://faucet.circle.com\n",
    );
    return;
  }

  const chain = process.env.NETWORK === "base" ? base : baseSepolia;
  const account = privateKeyToAccount(PRIVATE_KEY);
  const wallet = createWalletClient({ account, chain, transport: http() }).extend(publicActions);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pay = wrapFetchWithPayment(fetch, wallet as any);

  console.log(`\n② Paying from ${account.address} on ${chain.name} …`);

  // --- $0.001: one domain -------------------------------------------------
  const one = await pay(`${BASE_URL}/check/example.com`);
  const domain = await one.json();
  console.log(`\n③ 200 — the artifact:`);
  console.log(JSON.stringify(domain, null, 2));

  const receiptHeader = one.headers.get("x-payment-response");
  if (receiptHeader) {
    console.log(`\n   X-PAYMENT-RESPONSE:`, decodeXPaymentResponse(receiptHeader));
  }

  // --- $0.005: up to 50 domains -------------------------------------------
  const bulk = await pay(`${BASE_URL}/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domains: ["example.com", "openai.com", "zz-free-9f2a1c.dev"] }),
  });
  const report = await bulk.json();
  console.log(
    `\n④ /bulk 200 — ${report.count} checked: ${report.registered} registered, ` +
      `${report.available} available, ${report.unknown} unknown`,
  );
  for (const r of report.results ?? []) {
    console.log(`   ${String(r.domain).padEnd(24)} ${r.status.padEnd(11)} ${r.expiresAt ?? ""}`);
  }
}

main().catch((err) => {
  console.error("\nfailed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

/* ---------------------------------------------------------------------------
 * Paying on the SOLANA rail instead
 * ---------------------------------------------------------------------------
 * The same 402 body carries a `solana` entry. Pick it instead of the EVM one,
 * build an SPL `transferChecked` to `payTo` for `maxAmountRequired` base units
 * of the USDC mint, sign it, and base64 the x402 envelope into `X-PAYMENT`.
 *
 *   import {
 *     prepareSolanaCheckout,
 *     encodeX402Payment,
 *   } from "@three-ws/x402-payment-modal/server";
 *
 *   const challenge = await (await fetch(`${BASE_URL}/check/example.com`)).json();
 *   const accept    = challenge.accepts.find((a: any) => a.network.startsWith("solana"));
 *
 *   // Build the partially-signed transaction (fee payer = accept.extra.feePayer,
 *   // so the buyer spends USDC only and needs no SOL):
 *   const { tx_base64 } = await prepareSolanaCheckout({
 *     accept,
 *     buyer: myPhantomPublicKey,
 *     rpcUrl: process.env.SOLANA_RPC_URL,
 *   });
 *
 *   const signedTxBase64 = await signWithWallet(tx_base64);   // Phantom, Solflare, a keypair…
 *
 *   const { x_payment } = encodeX402Payment({
 *     accept,
 *     signedTxBase64,
 *     resourceUrl: `${BASE_URL}/check/example.com`,
 *   });
 *
 *   const res  = await fetch(`${BASE_URL}/check/example.com`, { headers: { "X-PAYMENT": x_payment } });
 *   const data = await res.json();   // same artifact, Solana receipt
 *
 * ---------------------------------------------------------------------------
 * The raw dual-rail 402, for reference
 * ---------------------------------------------------------------------------
 *   $ curl -s http://localhost:4021/check/example.com | jq '.accepts[] | {network, payTo, maxAmountRequired}'
 *   { "network": "base-sepolia", "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402", "maxAmountRequired": "1000" }
 *   { "network": "solana",       "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW", "maxAmountRequired": "1000" }
 */
