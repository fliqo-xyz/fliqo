"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Slot<T> = { url: string | null; data: T | null; error: string | null; loading: boolean };

/** Fetches JSON from one of the site's routes; null url = idle. Errors carry the route's own message. */
export function useJson<T>(url: string | null, refreshMs = 0) {
  const [slot, setSlot] = useState<Slot<T>>({ url: null, data: null, error: null, loading: false });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    await Promise.resolve();
    setSlot((s) => (s.url === url ? { ...s, loading: true } : { url, data: null, error: null, loading: true }));
    try {
      const r = await fetch(url, { cache: "no-store" });
      const body = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
      if (n !== seq.current) return;
      if (!r.ok || !body || (body as { error?: string }).error) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${r.status}).`);
      setSlot({ url, data: body, error: null, loading: false });
    } catch (e) {
      if (n === seq.current) setSlot((s) => ({ url, data: s.url === url ? s.data : null, error: e instanceof Error ? e.message : "Request failed.", loading: false }));
    }
  }, [url]);
  useEffect(() => {
    if (!url) return;
    void load();
    if (!refreshMs) return;
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), refreshMs);
    return () => window.clearInterval(t);
  }, [url, refreshMs, load]);
  // A slot that belongs to an older url reads as empty and loading, never as stale data for the new one.
  const current = slot.url === url;
  return { data: current ? slot.data : null, error: current ? slot.error : null, loading: url ? (current ? slot.loading : true) : false, reload: load };
}
