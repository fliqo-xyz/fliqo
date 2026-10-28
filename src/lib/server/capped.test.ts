import { test } from "node:test";
import assert from "node:assert/strict";
import { readCappedResponse } from "./capped";

const streamed = (chunks: number, size: number) => {
  let sent = 0;
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled++;
      if (sent++ >= chunks) return c.close();
      c.enqueue(new Uint8Array(size).fill(0x61));
    },
  });
  return { res: new Response(body), pulled: () => pulled };
};

test("small answers are read whole", async () => {
  assert.equal(await readCappedResponse(new Response('{"ok":1}'), 100), '{"ok":1}');
});

test("a declared length over the cap is refused without reading", async () => {
  const res = new Response("x".repeat(50), { headers: { "content-length": "5000000" } });
  assert.equal(await readCappedResponse(res, 2_000_000), null);
});

test("a streamed answer is cut off as soon as it passes the cap", async () => {
  const s = streamed(1_000, 64 * 1024); // would be 64 MB
  assert.equal(await readCappedResponse(s.res, 2_000_000), null);
  assert.ok(s.pulled() < 40, `read ${s.pulled()} chunks`);
});
