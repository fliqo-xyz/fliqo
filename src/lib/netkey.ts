/*
 * Typed rate-limit keys. Every key says what it is, so a value from one place
 * can never be read as a more privileged key from another:
 *   n4:<ipv4>            one IPv4 address
 *   n6:<a:b:c:d>/64      one IPv6 /64
 *   unparsed             a header value that was present but not an address
 *   direct               every caller, when forwarded headers are not trusted
 *   a4:<a.b.c>.0/24      IPv4 aggregate
 *   a6:<a:b:c>/48        IPv6 aggregate
 *   a:unparsed           aggregate of everything unparsable
 *   w:<0x…>              a wallet proven by its signature
 */

export const DIRECT = "direct";
export const UNPARSED = "unparsed";

const v4 = (s: string) => {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((x, i) => x <= 255 && String(x) === m[i + 1]) ? o : null;
};

function v6Groups(s: string): number[] | null {
  if (!/^[0-9a-f:]+$/.test(s) || (s.match(/::/g) ?? []).length > 1) return null;
  const [head, tail] = s.includes("::") ? s.split("::") : [s, null];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  if ([...left, ...right].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const fill = tail === null ? 0 : 8 - left.length - right.length;
  if (tail === null ? left.length !== 8 : fill < 1) return null;
  return [...left, ...Array(fill).fill("0"), ...right].map((g) => parseInt(g, 16));
}

/** Network key for an address string, or null when it is not a valid IPv4 / IPv6 address. */
export function networkKey(ip: string): string | null {
  const addr = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const four = v4(addr);
  if (four) return `n4:${four.join(".")}`;
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4(mapped[1]) ? `n4:${v4(mapped[1])!.join(".")}` : null;
  const g = v6Groups(addr);
  if (!g) return null;
  return `n6:${g.slice(0, 4).map((x) => x.toString(16)).join(":")}/64`;
}

/** The aggregate a network key rolls up to. Never null for n4/n6/unparsed; null for direct and wallet keys. */
export function aggregateKey(key: string): string | null {
  if (key.startsWith("n4:")) return `a4:${key.slice(3).split(".").slice(0, 3).join(".")}.0/24`;
  if (key.startsWith("n6:")) return `a6:${key.slice(3).split(":").slice(0, 3).join(":")}/48`;
  if (key === UNPARSED) return "a:unparsed";
  return null;
}

export const isAggregate = (key: string) => /^a[46]?:/.test(key) || key === DIRECT;

/** A wallet already proven by its signature. */
export const walletKey = (address: string) => `w:${address.toLowerCase()}`;

/** Forwarded headers are only believed on Vercel (its edge overwrites them) or with TRUST_PROXY_HEADERS=1. */
export const trustsProxyHeaders = () => Boolean(process.env.VERCEL) || process.env.TRUST_PROXY_HEADERS === "1";

const firstHop = (v: string | null) => (v ? v.split(",")[0].trim() : "");

/**
 * Rate-limit key for a request.
 *   - Vercel: x-vercel-forwarded-for, then x-forwarded-for (its edge writes both).
 *   - TRUST_PROXY_HEADERS=1: only the x-forwarded-for hop the proxy appended,
 *     the rightmost (or TRUSTED_PROXY_HOPS from the right). CLIENT_IP_HEADER
 *     names a header to read instead, for proxies that overwrite it. x-real-ip
 *     is not read by default: a proxy that only appends XFF passes a
 *     client-sent x-real-ip straight through.
 *   - Otherwise: one shared key for everyone.
 */
export function clientIp(request: Request): string {
  if (!trustsProxyHeaders()) return DIRECT;
  let raw = "";
  if (process.env.VERCEL) {
    raw = firstHop(request.headers.get("x-vercel-forwarded-for")) || firstHop(request.headers.get("x-forwarded-for"));
  } else if (process.env.CLIENT_IP_HEADER) {
    raw = firstHop(request.headers.get(process.env.CLIENT_IP_HEADER));
  } else {
    const hops = Math.max(1, Math.floor(Number(process.env.TRUSTED_PROXY_HOPS) || 1));
    const list = (request.headers.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    raw = list.length >= hops ? list[list.length - hops] : "";
  }
  return networkKey(raw.slice(0, 64)) ?? UNPARSED;
}
