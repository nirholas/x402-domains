/**
 * RDAP domain intelligence service.
 *
 * RDAP (Registration Data Access Protocol, RFC 9082/9083) is the IANA-standard
 * successor to WHOIS. It is keyless and live. We resolve the authoritative RDAP
 * server for a TLD via the IANA bootstrap registry (https://data.iana.org/rdap/dns.json)
 * and fall back to the rdap.org aggregator when a TLD has no bootstrap entry.
 */

const IANA_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const RDAP_ORG_BASE = "https://rdap.org";
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000; // refresh IANA bootstrap daily
const USER_AGENT = "x402-domains/0.1.0 (+https://github.com/nirholas/x402-domains)";

interface IanaBootstrap {
  services: [string[], string[]][];
}

let bootstrapCache: { map: Map<string, string>; fetchedAt: number } | null = null;

export interface DomainCheck {
  domain: string;
  status: "registered" | "available" | "unknown";
  /** true = no registration found (likely available); false = registered; null = could not determine */
  available: boolean | null;
  registrar: string | null;
  registrarIanaId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  nameservers: string[];
  statusFlags: string[];
  dnssecSigned: boolean | null;
  rdapServer: string | null;
  source: "rdap";
  note?: string;
  checkedAt: string;
}

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function normalizeDomain(raw: string): string {
  const d = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!DOMAIN_RE.test(d)) {
    throw new DomainError("INVALID_DOMAIN", `"${raw}" is not a valid domain name`);
  }
  return d;
}

async function fetchJson(url: string, timeoutMs = 10_000): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/rdap+json, application/json", "user-agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function getBootstrapMap(): Promise<Map<string, string>> {
  if (bootstrapCache && Date.now() - bootstrapCache.fetchedAt < BOOTSTRAP_TTL_MS) {
    return bootstrapCache.map;
  }
  const { status, body } = await fetchJson(IANA_BOOTSTRAP_URL, 15_000);
  if (status !== 200 || !body || typeof body !== "object") {
    if (bootstrapCache) return bootstrapCache.map; // serve stale on refresh failure
    return new Map();
  }
  const map = new Map<string, string>();
  for (const [tlds, urls] of (body as IanaBootstrap).services ?? []) {
    const base = urls.find((u) => u.startsWith("https://")) ?? urls[0];
    if (!base) continue;
    for (const tld of tlds) map.set(tld.toLowerCase(), base.replace(/\/$/, ""));
  }
  bootstrapCache = { map, fetchedAt: Date.now() };
  return map;
}

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}
interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, [string, Record<string, unknown>, string, unknown][]];
  publicIds?: { type?: string; identifier?: string }[];
  entities?: RdapEntity[];
}
interface RdapDomain {
  ldhName?: string;
  status?: string[];
  events?: RdapEvent[];
  entities?: RdapEntity[];
  nameservers?: { ldhName?: string }[];
  secureDNS?: { delegationSigned?: boolean };
}

function eventDate(events: RdapEvent[] | undefined, action: string): string | null {
  return events?.find((e) => e.eventAction === action)?.eventDate ?? null;
}

function findRegistrar(entities: RdapEntity[] | undefined): { name: string | null; ianaId: string | null } {
  for (const e of entities ?? []) {
    if (e.roles?.includes("registrar")) {
      let name: string | null = null;
      const vcard = e.vcardArray?.[1];
      if (Array.isArray(vcard)) {
        const fn = vcard.find((entry) => entry[0] === "fn");
        if (fn && typeof fn[3] === "string") name = fn[3];
      }
      const ianaId =
        e.publicIds?.find((p) => (p.type ?? "").toLowerCase().includes("iana"))?.identifier ?? null;
      return { name, ianaId };
    }
    const nested = findRegistrar(e.entities);
    if (nested.name || nested.ianaId) return nested;
  }
  return { name: null, ianaId: null };
}

/** Check a single domain against its authoritative RDAP server (live). */
export async function checkDomain(raw: string): Promise<DomainCheck> {
  const domain = normalizeDomain(raw);
  const tld = domain.split(".").pop()!;
  const checkedAt = new Date().toISOString();

  const bootstrap = await getBootstrapMap();
  const base = bootstrap.get(tld) ?? RDAP_ORG_BASE;
  const rdapServer = `${base}/domain/${domain}`;

  let status: number;
  let body: unknown;
  try {
    ({ status, body } = await fetchJson(rdapServer));
  } catch {
    return {
      domain,
      status: "unknown",
      available: null,
      registrar: null,
      registrarIanaId: null,
      createdAt: null,
      updatedAt: null,
      expiresAt: null,
      nameservers: [],
      statusFlags: [],
      dnssecSigned: null,
      rdapServer,
      source: "rdap",
      note: "RDAP server unreachable or timed out",
      checkedAt,
    };
  }

  if (status === 404) {
    return {
      domain,
      status: "available",
      available: true,
      registrar: null,
      registrarIanaId: null,
      createdAt: null,
      updatedAt: null,
      expiresAt: null,
      nameservers: [],
      statusFlags: [],
      dnssecSigned: null,
      rdapServer,
      source: "rdap",
      note: "No registration found in the authoritative RDAP registry — the domain is likely available (registry-level reservations may still apply).",
      checkedAt,
    };
  }

  if (status !== 200 || !body || typeof body !== "object") {
    return {
      domain,
      status: "unknown",
      available: null,
      registrar: null,
      registrarIanaId: null,
      createdAt: null,
      updatedAt: null,
      expiresAt: null,
      nameservers: [],
      statusFlags: [],
      dnssecSigned: null,
      rdapServer,
      source: "rdap",
      note: `RDAP query returned HTTP ${status} — this TLD may not support RDAP or rate limits applied`,
      checkedAt,
    };
  }

  const d = body as RdapDomain;
  const registrar = findRegistrar(d.entities);
  return {
    domain,
    status: "registered",
    available: false,
    registrar: registrar.name,
    registrarIanaId: registrar.ianaId,
    createdAt: eventDate(d.events, "registration"),
    updatedAt: eventDate(d.events, "last changed") ?? eventDate(d.events, "last update of RDAP database"),
    expiresAt: eventDate(d.events, "expiration"),
    nameservers: (d.nameservers ?? [])
      .map((n) => (n.ldhName ?? "").toLowerCase())
      .filter(Boolean),
    statusFlags: d.status ?? [],
    dnssecSigned: d.secureDNS?.delegationSigned ?? null,
    rdapServer,
    source: "rdap",
    checkedAt,
  };
}

/** Check up to `max` domains with bounded concurrency. */
export async function checkBulk(domains: string[], max = 50): Promise<DomainCheck[]> {
  if (!Array.isArray(domains) || domains.length === 0) {
    throw new DomainError("EMPTY_LIST", "Provide a non-empty array of domains");
  }
  if (domains.length > max) {
    throw new DomainError("TOO_MANY_DOMAINS", `Maximum ${max} domains per bulk request (got ${domains.length})`);
  }
  const unique = [...new Set(domains.map((d) => String(d)))];
  const results: DomainCheck[] = new Array(unique.length);
  const CONCURRENCY = 8;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < unique.length) {
      const i = next++;
      try {
        results[i] = await checkDomain(unique[i]);
      } catch (err) {
        results[i] = {
          domain: unique[i],
          status: "unknown",
          available: null,
          registrar: null,
          registrarIanaId: null,
          createdAt: null,
          updatedAt: null,
          expiresAt: null,
          nameservers: [],
          statusFlags: [],
          dnssecSigned: null,
          rdapServer: null,
          source: "rdap",
          note: err instanceof DomainError ? err.message : "lookup failed",
          checkedAt: new Date().toISOString(),
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  return results;
}
