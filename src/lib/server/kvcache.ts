import "server-only";
import { memo } from "@/lib/server/memo";
import { getStore } from "@/lib/server/store";

/*
 * Answers of slow chain reads (sell checks, token locks) shared by every instance: memory first (single flight per
 * key), then the store (keys fliqo:<key>, plain GET and SET … EX), then the read itself. Without a store, or when it
 * fails or is slow, it is memory only. Errors are never cached.
 */

const TIMEOUT_MS = 1500;

function within<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("store timeout")), TIMEOUT_MS)))]).finally(() => clearTimeout(timer));
}

export async function sharedCache<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<{ value: T; at: number }> {
  const r = await memo(`kv:${key}`, ttlSec * 1000, async () => {
    const store = getStore();
    if (store) {
      try {
        const raw = await within(store.get(key));
        const hit = raw ? (JSON.parse(raw) as { at?: number; value?: T }) : null;
        if (hit && typeof hit.at === "number" && Date.now() - hit.at < ttlSec * 1000 && hit.value !== undefined) return { at: hit.at, value: hit.value };
      } catch {
        // Store down or slow: read it ourselves.
      }
    }
    const value = await fn();
    const entry = { at: Date.now(), value };
    if (store) await within(store.setEx(key, JSON.stringify(entry), ttlSec)).catch(() => undefined);
    return entry;
  });
  return r.value;
}
