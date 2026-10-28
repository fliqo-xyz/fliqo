"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * A localStorage-backed value read through `useSyncExternalStore`, so every
 * component reading the same key stays in step without copying into state.
 * Blocked or private storage simply reads as empty.
 */

const listeners = new Set<() => void>();
const snapshots = new Map<string, string | null>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = () => {
    snapshots.clear();
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function read(key: string) {
  if (snapshots.has(key)) return snapshots.get(key) ?? null;
  let value: string | null = null;
  try {
    value = window.localStorage.getItem(key);
  } catch {
    value = null;
  }
  snapshots.set(key, value);
  return value;
}

export function useLocalStore<T>(key: string, fallback: T) {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );

  // Parse once per stored string. Re-parsing on every render would hand
  // effects a new object each time and re-run them in a loop.
  const value = useMemo(() => {
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
    // `fallback` is a literal at every call site; the string is the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  const write = useCallback(
    (input: T | null | ((previous: T) => T | null)) => {
      let next: T | null;
      if (typeof input === "function") {
        const current = read(key);
        let previous = fallback;
        try {
          if (current !== null) previous = JSON.parse(current) as T;
        } catch {
          // unreadable value: start from the fallback
        }
        next = (input as (previous: T) => T | null)(previous);
      } else next = input;
      try {
        if (next === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Losing persistence is survivable; the snapshot still updates.
      }
      snapshots.set(key, next === null ? null : JSON.stringify(next));
      emit();
    },
    // `fallback` is a literal at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  return [value, write] as const;
}
