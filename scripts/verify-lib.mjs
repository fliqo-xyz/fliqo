// Checks behind scripts/verify-deployment.mjs, free of I/O so they can be tested with a fake chain.
//
// How it decides that an address runs this repository's FliqoWatchBook:
//   - Runtime code is compared byte for byte with src/lib/contracts/artifacts.json
//     (`npm run contracts:artifacts -- --check` proves that file is a fresh forge build).
//     FliqoWatchBook has no immutables and no constructor arguments, so its code must be identical.
//   - The creation transaction is required (no tx => FAIL, never MATCH). It must have succeeded, created exactly the address checked, have no
//     recipient, and its input must be exactly this build's creation code (nothing appended).
// Every check fails closed: an RPC error, an empty or malformed answer is a FAIL, never a skip.

export const CHAIN_ID = 4663;

const isAddr = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const isHex = (v) => typeof v === "string" && /^0x([0-9a-fA-F]{2})*$/.test(v);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** True when `code` is exactly this build's runtime for `kind` (contracts without immutables only). */
export function match(ART, kind, code) {
  const a = ART[kind];
  if (!a || a.immutables.length) return false;
  return String(code).toLowerCase() === a.runtime;
}

/** input: { book?, bookTx?, rpc, ART }. rpc(method, params) -> result (may throw). Returns { ok, lines }. */
export async function verifyDeployment({ book, bookTx, rpc, ART }) {
  const encodedArgs = ""; // FliqoWatchBook has no constructor arguments
  const lines = [];
  let failed = false;
  const ok = (m) => lines.push(`OK   ${m}`);
  const fail = (m) => {
    failed = true;
    lines.push(`FAIL ${m}`);
  };
  const done = () => ({ ok: !failed, lines });

  try {
    const id = await rpc("eth_chainId", []);
    if (Number(BigInt(id)) !== CHAIN_ID) {
      fail(`chain id ${id}, expected ${CHAIN_ID}`);
      return done();
    }
    ok(`chain id ${CHAIN_ID} (Robinhood Chain)`);
  } catch (e) {
    fail(`chain id unreadable: ${e.message}`);
    return done();
  }
  if (!book) {
    fail("give --book");
    return done();
  }
  if (!isAddr(book)) {
    fail("--book is not an address");
    return done();
  }
  try {
    const c = await rpc("eth_getCode", [book, "latest"]);
    if (!isHex(c) || c.length <= 2) throw new Error(`no code at ${book}`);
    if (match(ART, "FliqoWatchBook", c)) ok(`FliqoWatchBook at ${book}: runtime matches this build (no owner, no immutables)`);
    else fail(`FliqoWatchBook at ${book}: runtime differs from this build`);
  } catch (e) {
    fail(`FliqoWatchBook: ${e.message}`);
  }
  // Runtime code alone cannot show who deployed it or with what input: without the creation tx the
  // answer is never MATCH.
  if (!bookTx) {
    fail("FliqoWatchBook: no creation tx given (pass --book-tx); runtime alone is not a full match");
    return done();
  }
  if (typeof bookTx !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(bookTx)) {
    fail("FliqoWatchBook: --book-tx is not a 32-byte transaction hash");
    return done();
  }
  try {
    const [tx, rc] = await Promise.all([rpc("eth_getTransactionByHash", [bookTx]), rpc("eth_getTransactionReceipt", [bookTx])]);
    if (!tx || !rc) fail(`FliqoWatchBook: creation tx ${bookTx} not found`);
    else if (rc.status !== "0x1") fail("FliqoWatchBook: creation tx failed");
    else if (!same(rc.contractAddress, book)) fail(`FliqoWatchBook: tx created ${rc.contractAddress}, not ${book}`);
    else if (tx.to) fail("FliqoWatchBook: tx has a recipient, not a deployment");
    // Creation code plus ABI-encoded constructor arguments; this contract takes none, so nothing may follow.
    else if (String(tx.input).toLowerCase() === ART.FliqoWatchBook.creation + encodedArgs) ok("FliqoWatchBook: creation input is exactly this build (no constructor arguments)");
    else fail("FliqoWatchBook: creation input differs from this build");
  } catch (e) {
    fail(`FliqoWatchBook: creation tx unreadable: ${e.message}`);
  }
  return done();
}
