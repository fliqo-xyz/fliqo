/**
 * Reads a fetch Response body as text, stopping as soon as it passes `max` bytes (declared or
 * streamed). Returns null when too large; the caller aborts the request.
 */
export async function readCappedResponse(res: Response, max: number): Promise<string | null> {
  if (Number(res.headers.get("content-length") ?? 0) > max) return null;
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
