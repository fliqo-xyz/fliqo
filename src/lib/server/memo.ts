import "server-only";

/*
 * Small in-process cache for chain reads behind public GET routes: one upstream read per key and TTL however
 * many visitors ask (single flight), a capped number of keys, and errors that are never cached.
 */
type Slot = { at: number; value: unknown };
const MAX_KEYS = 500;
const values = new Map<string, Slot>();
const running = new Map<string, Promise<unknown>>();

export async function memo<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<{ value: T; at: number }> {
  const hit = values.get(key);
  if (hit && Date.now() - hit.at < ttl) return { value: hit.value as T, at: hit.at };
  let job = running.get(key) as Promise<T> | undefined;
  if (!job) {
    job = fn()
      .then((v) => {
        values.delete(key);
        values.set(key, { at: Date.now(), value: v });
        while (values.size > MAX_KEYS) {
          const first = values.keys().next().value;
          if (first === undefined) break;
          values.delete(first);
        }
        return v;
      })
      .finally(() => running.delete(key));
    running.set(key, job);
  }
  const value = await job;
  return { value, at: values.get(key)?.at ?? Date.now() };
}
