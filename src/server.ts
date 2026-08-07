import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  paywall,
  activeRails,
  usingSuiteDefaultPayTo,
  paymentReceipt,
  type RoutePrices,
} from "./payments.js";
import { ROUTE_SCHEMAS } from "./schemas.js";
import { checkDomain, checkBulk, DomainError } from "./service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 4026);

const PAID_ROUTES: RoutePrices = {
  "GET /check/:domain": "$0.001",
  "POST /bulk": "$0.005",
};

const DESCRIPTIONS: Record<string, string> = {
  "GET /check/:domain":
    "Live RDAP lookup for one domain: availability, registrar, creation/expiry dates, nameservers, DNSSEC",
  "POST /bulk": "Live RDAP lookup for up to 50 domains in one paid call",
};

const PRICE_TABLE = [
  { route: "GET /check/:domain", price: "$0.001" },
  { route: "POST /bulk", price: "$0.005" },
];

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

// ---- free routes (not in the paywall map) ----
app.get("/", (_req, res) => {
  res.json({
    name: "x402-domains",
    description:
      "Authoritative domain availability and expiry intel via RDAP — keyless, live, per lookup",
    docs: "https://nirholas.github.io/x402-domains/",
    skill: "/skill.md",
    manifest: "/.well-known/x402",
    openapi: "/openapi.json",
    payment: {
      protocol: "x402",
      note: "Pay in USDC on Base or Solana — your client picks the rail.",
      rails: activeRails(),
    },
    endpoints: PRICE_TABLE,
  });
});

app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.get("/.well-known/x402", (_req, res) =>
  res.type("application/json").sendFile(path.join(ROOT, "public", ".well-known", "x402")),
);
app.get("/skill.md", (_req, res) => res.type("text/markdown").sendFile(path.join(ROOT, "skill.md")));
app.get("/openapi.json", (_req, res) => res.sendFile(path.join(ROOT, "openapi.json")));
app.use(express.static(path.join(ROOT, "public")));

// ---- paywall: everything below this line costs USDC ----
app.use(paywall(PAID_ROUTES, { service: "x402-domains", descriptions: DESCRIPTIONS, schemas: ROUTE_SCHEMAS }));

app.get("/check/:domain", async (req, res) => {
  try {
    const result = await checkDomain(req.params.domain);
    res.json({ ...result, receipt: paymentReceipt(res) });
  } catch (err) {
    if (err instanceof DomainError) {
      res.status(400).json({ error: err.code, message: err.message });
    } else {
      res.status(502).json({ error: "RDAP_UPSTREAM_ERROR", message: String(err) });
    }
  }
});

app.post("/bulk", async (req, res) => {
  try {
    const domains: unknown = req.body?.domains;
    if (!Array.isArray(domains)) {
      res.status(400).json({
        error: "BAD_REQUEST",
        message: 'Body must be {"domains": ["example.com", ...]} with 1-50 entries',
      });
      return;
    }
    const results = await checkBulk(domains.map(String));
    res.json({
      count: results.length,
      registered: results.filter((r) => r.status === "registered").length,
      available: results.filter((r) => r.status === "available").length,
      unknown: results.filter((r) => r.status === "unknown").length,
      results,
      checkedAt: new Date().toISOString(),
      receipt: paymentReceipt(res),
    });
  } catch (err) {
    if (err instanceof DomainError) {
      res.status(400).json({ error: err.code, message: err.message });
    } else {
      res.status(502).json({ error: "RDAP_UPSTREAM_ERROR", message: String(err) });
    }
  }
});

app.listen(PORT, () => {
  console.log(`\nx402-domains listening on http://localhost:${PORT}`);
  console.log("Payment rails (USDC — the client picks):");
  for (const r of activeRails()) {
    console.log(`  ${r.rail.padEnd(7)} ${r.network.padEnd(14)} → ${r.payTo}  via ${r.facilitator}`);
  }
  if (usingSuiteDefaultPayTo()) {
    console.log(
      "  note: using suite default payTo — set PAY_TO_ADDRESS / SOLANA_PAY_TO_ADDRESS to receive funds yourself",
    );
  }
  console.log("Paid routes:");
  for (const r of PRICE_TABLE) console.log(`  ${r.route.padEnd(24)} ${r.price}`);
  console.log(
    "Free routes: GET /  GET /health  GET /skill.md  GET /.well-known/x402  GET /openapi.json\n",
  );
});
